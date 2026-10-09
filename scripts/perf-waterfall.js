// Latency waterfall for warm authenticated tenant requests.
//
// 1. Start the server with tracing on, logging to a file:
//      PERF_TRACE=true PORT=4011 npx cds serve all > perf.log 2>&1
// 2. node scripts/perf-waterfall.js <perf.log> [baseUrl] [warmRuns]
//
// Logs in (DEV_MODE subdomain), fires one warm-up + N tagged runs per endpoint,
// then reads the server's `[perf]` lines for those X-Request-Ids and prints the
// median of every phase. Also measures raw network RTT to the tenant DB
// (SELECT 1 on an open connection) as the floor any SQL round trip can't beat.

const fs = require('fs')
const crypto = require('crypto')
const cds = require('@sap/cds')
const { Client } = require('pg')

const [logFile, baseUrl = 'http://localhost:4011', runsArg = '20'] = process.argv.slice(2)
const RUNS = Number(runsArg)
const RTT_SAMPLES = 50
const CONNECT_SAMPLES = 5
const ENDPOINTS = [
  'control/listControls',
  'review/listLevel1Queue',
  'deviation/listDeviations',
  'notifications/listNotifications',
  'profile/getProfile',
  'audit-log/listAuditLogs'
]

const pct = (xs, p) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  return v.length ? +v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))].toFixed(1) : null
}
const median = (xs) => pct(xs, 0.5)
const dist = (xs) => ({ n: xs.length, min: pct(xs, 0), p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) })

// Floor for any SQL round trip from this host: SELECT 1 on an open connection,
// plus the cost of opening a brand-new connection (TCP + TLS + auth).
async function rttBaseline(database) {
  const cr = cds.env.requires.db.credentials
  const connects = []
  for (let i = 0; i < CONNECT_SAMPLES; i++) {
    const c = new Client({ ...cr, database })
    const t = performance.now()
    await c.connect()
    connects.push(performance.now() - t)
    await c.end()
  }
  const c = new Client({ ...cr, database })
  await c.connect()
  const rtts = []
  for (let i = 0; i < RTT_SAMPLES; i++) {
    const t = performance.now()
    await c.query('SELECT 1')
    rtts.push(performance.now() - t)
  }
  await c.end()
  return { selectOneMs: dist(rtts), connectMs: dist(connects) }
}

async function main() {
  if (!logFile) throw new Error('Usage: node scripts/perf-waterfall.js <server-log> [baseUrl] [warmRuns]')
  const login = await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain: 'xyrademo', email: 'admin@xyrademo.test', persona: 'ADMIN' })
  })).json()
  if (!login.token) throw new Error(`login failed: ${login.message}`)

  const ids = {}
  const clientMs = {}
  for (const ep of ENDPOINTS) {
    ids[ep] = []
    clientMs[ep] = []
    for (let i = 0; i <= RUNS; i++) {
      const id = `pw-${crypto.randomUUID().slice(0, 8)}`
      const t = performance.now()
      const res = await fetch(`${baseUrl}/api/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}`, 'X-Request-Id': id },
        body: '{}'
      })
      await res.text()
      if (i === 0) continue // warm-up (may open connections)
      ids[ep].push(id)
      clientMs[ep].push(performance.now() - t)
    }
  }

  await new Promise((r) => setTimeout(r, 500))
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/)
  const byId = new Map()
  for (const l of lines) {
    const i = l.indexOf('{"perf":')
    if (i >= 0) { const j = JSON.parse(l.slice(i)); byId.set(j.perf, j) }
  }

  const rows = []
  const samples = {}
  for (const ep of ENDPOINTS) {
    const traces = ids[ep].map((id) => byId.get(id)).filter(Boolean)
    samples[ep] = traces[traces.length - 1]
    const w = (k) => median(traces.map((t) => t.waterfall[k]))
    const c = (k) => Math.max(...traces.map((t) => t.counts[k]))
    rows.push({
      endpoint: ep,
      n: traces.length,
      clientP50: median(clientMs[ep]),
      p50: median(traces.map((t) => t.totalMs)),
      p95: pct(traces.map((t) => t.totalMs), 0.95),
      auth: +((w('jwtVerifyMs') || 0) + (w('tenantLookupMs') || 0)).toFixed(2),
      pool: w('poolLookupMs'),
      txBegin: w('txBeginMs'),
      acquire: w('connAcquireMs'),
      newConn: w('newConnectionMs'),
      dbWait: w('dbWallMs'),
      capSel: w('capSelectMs'),
      handlerJs: w('handlerNonDbMs'),
      serialize: w('serializeMs'),
      sql: c('sqlStatements'),
      serialRT: c('sqlRoundTripsSerial'),
      master: c('masterQueries'),
      newPg: c('newPgConnections')
    })
  }
  const host = new URL(`postgres://${cds.env.requires.db.credentials.host}`).hostname
  const addr = await require('dns').promises.lookup(host).catch(() => ({ address: '?' }))
  console.log(`Host: ${require('os').hostname()}  ->  RDS ${host} (${addr.address})  runs/endpoint: ${RUNS}`)
  console.table(rows)

  console.log('\nRaw network baseline (this host -> RDS):')
  console.log(JSON.stringify(await rttBaseline('tenant_xyrademo'), null, 2))

  const out = logFile.replace(/\.[^.]*$/, '') + '-samples.json'
  fs.writeFileSync(out, JSON.stringify(samples, null, 2))
  console.log(`\nOne full trace per endpoint (incl. every SQL statement): ${out}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
