const { AsyncLocalStorage } = require('async_hooks')
const crypto = require('crypto')

// Opt-in request latency tracer (PERF_TRACE=true). Measurement only — it
// wraps timing around existing calls and never changes what they do. Off (the
// default), install() is never called and mark()/timed() are no-ops.
//
// One JSON line per request, keyed by a correlation id (X-Request-Id, echoed
// back on the response), with every phase from "request received" to "response
// finished" plus every SQL statement that request sent over the wire.

const ENABLED = process.env.PERF_TRACE === 'true'
const als = new AsyncLocalStorage()
const now = () => performance.now()

const store = () => als.getStore()

// Record a named instant (ms since request start).
function mark(name) {
  const s = store()
  if (s) s.marks[name] = +(now() - s.t0).toFixed(2)
}

// Time a sync or async call under `name` (accumulates if called repeatedly).
function timed(name, fn) {
  const s = store()
  if (!s) return fn()
  const start = now()
  const done = (v) => {
    s.phases[name] = +((s.phases[name] || 0) + now() - start).toFixed(2)
    return v
  }
  const out = fn()
  return out && typeof out.then === 'function' ? out.then(done, (e) => { done(); throw e }) : done(out)
}

function note(key, value) {
  const s = store()
  if (s) s.info[key] = value
}

// Union of [start,end] intervals — wall time the request spent waiting on the
// DB, correct even when queries run in parallel (Promise.all).
function unionMs(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0, curS = null, curE = null
  for (const [s, e] of sorted) {
    if (curE === null || s > curE) { if (curE !== null) total += curE - curS; curS = s; curE = e }
    else curE = Math.max(curE, e)
  }
  if (curE !== null) total += curE - curS
  return total
}

function summarize(s, res) {
  const total = now() - s.t0
  const sql = s.sql
  const inHandler = sql.filter((q) => s.handlerStart != null && q.start >= s.handlerStart && q.start <= (s.handlerEnd ?? Infinity))
  const handlerMs = s.handlerEnd != null ? s.handlerEnd - s.handlerStart : null
  const dbWallInHandler = unionMs(inHandler.map((q) => [q.start, q.end]))
  const r = (n) => (n == null ? null : +n.toFixed(2))
  return {
    perf: s.id,
    method: s.method,
    path: s.path,
    status: res.statusCode,
    totalMs: r(total),
    waterfall: {
      toAuthStartMs: s.marks.authStart ?? null,
      jwtVerifyMs: s.phases.jwtVerify ?? null,
      tenantLookupMs: s.phases.tenantLookup ?? null,
      authToHandlerMs: s.handlerStart != null && s.marks.authEnd != null ? r(s.handlerStart - s.marks.authEnd) : null,
      poolLookupMs: s.phases.poolLookup ?? null,
      txBeginMs: s.phases.txBegin ?? null, // acquire + set_config + BEGIN
      connAcquireMs: s.phases.connAcquire ?? null, // waiting on CAP's connection pool
      newConnectionMs: s.phases.pgConnect ?? null, // TCP+TLS+auth, only if a physical connection was opened
      dbWallMs: r(dbWallInHandler), // time the handler spent waiting on SQL (network + execution)
      capSelectMs: s.phases.capSelect ?? null, // CAP onSELECT incl. SQL; minus its SQL = compile + row processing
      handlerMs: r(handlerMs),
      handlerNonDbMs: handlerMs != null ? r(handlerMs - dbWallInHandler) : null, // JS: CAP overhead + mapping, not waiting on DB
      serializeMs: s.handlerEnd != null ? r(total - s.handlerEnd) : null // handler return -> response flushed
    },
    counts: {
      sqlStatements: sql.length,
      sqlRoundTripsSerial: countSerial(sql),
      masterQueries: sql.filter((q) => q.db === s.masterDb).length,
      tenantQueries: sql.filter((q) => q.db !== s.masterDb).length,
      newPgConnections: s.info.newPgConnections || 0,
      poolHit: s.info.poolHit ?? null,
      tenantDirectoryMiss: s.info.tenantDirectoryMiss || false
    },
    sql: sql.map((q) => ({ at: r(q.start), ms: r(q.end - q.start), db: q.db, rows: q.rows, text: q.text, values: q.values }))
  }
}

// How many "waves" of SQL ran one after another (overlapping queries = 1 wave).
function countSerial(sql) {
  let waves = 0, end = -1
  for (const q of [...sql].sort((a, b) => a.start - b.start)) {
    if (q.start >= end) waves++
    end = Math.max(end, q.end)
  }
  return waves
}

function install(masterDb) {
  const pg = require('pg')
  const cds = require('@sap/cds')

  const origQuery = pg.Client.prototype.query
  pg.Client.prototype.query = function (config, values, cb) {
    const s = store()
    if (!s || typeof values === 'function' || typeof cb === 'function') return origQuery.apply(this, arguments)
    const text = typeof config === 'string' ? config : config && config.text
    const vals = (config && config.values) || values
    const entry = { start: now() - s.t0, db: this.database, text: String(text || '').replace(/\s+/g, ' ').slice(0, 4000), values: vals ? JSON.stringify(vals).slice(0, 500) : undefined }
    s.sql.push(entry)
    const p = origQuery.apply(this, arguments)
    if (!p || typeof p.then !== 'function') return p // streaming query objects
    return p.then((res) => { entry.end = now() - s.t0; entry.rows = res && res.rowCount; return res }, (err) => { entry.end = now() - s.t0; entry.error = err.message; throw err })
  }

  const origConnect = pg.Client.prototype.connect
  pg.Client.prototype.connect = function () {
    const s = store()
    if (s) s.info.newPgConnections = (s.info.newPgConnections || 0) + 1
    return timed('pgConnect', () => origConnect.apply(this, arguments))
  }

  const DatabaseService = require('@cap-js/db-service/lib/common/DatabaseService')
  const DBS = DatabaseService.prototype || DatabaseService.default?.prototype
  const origBegin = DBS.begin
  DBS.begin = function () { return timed('txBegin', () => origBegin.apply(this, arguments)) }
  const origAcquire = DBS.acquire
  DBS.acquire = function () { return timed('connAcquire', () => origAcquire.apply(this, arguments)) }

  const SQLService = require('@cap-js/db-service/lib/SQLService')
  const SQS = SQLService.prototype
  const origOnSelect = SQS.onSELECT
  SQS.onSELECT = function () { return timed('capSelect', () => origOnSelect.apply(this, arguments)) }

  // Handler start/end for every served (non-DB) service.
  cds.on('serving', (srv) => {
    srv.prepend(() => {
      srv.before('*', () => { const s = store(); if (s && s.handlerStart == null) s.handlerStart = now() - s.t0 })
    })
    srv.after('*', () => { const s = store(); if (s) s.handlerEnd = now() - s.t0 })
  })

  const LOG = cds.log('perf')
  return function perfMiddleware(req, res, next) {
    const id = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 64)
    res.setHeader('X-Request-Id', id)
    const s = { id, t0: now(), method: req.method, path: req.originalUrl, marks: {}, phases: {}, info: {}, sql: [], masterDb }
    res.on('finish', () => LOG.info(JSON.stringify(summarize(s, res))))
    als.run(s, next)
  }
}

module.exports = { ENABLED, install, mark, timed, note }
