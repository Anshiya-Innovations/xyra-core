const cds = require('@sap/cds')
const express = require('express')
const { runProvisioning, getProvisioningStatus } = require('./handlers/provisioning')
const { sign, verify, bearer } = require('./lib/auth/token')
const { verifyPassword } = require('./lib/auth/password')
const { issuePlatformToken, normEmail } = require('./lib/auth/identity')

// Fail at boot, not on the first login, if the signing secret is missing.
sign({}, 1)

// Path-parameterized REST routes (POST/GET /api/provisioning/:tenantId, POST .../retry)
// can't be expressed as CDS actions — those are fixed-name, no dynamic URL segments —
// so they're wired up here via CAP's documented server.js bootstrap hook instead.
// This fires before cds mounts any OData services, so there's no route collision risk.
// DEV_MODE=true (see .env) opens CORS to any origin — needed to test xyra-web from
// localhost (a different origin/port than this server). Leave it false/unset for
// anything resembling production; a real deployment should serve frontend+backend
// same-origin (e.g. behind one reverse proxy) rather than relying on open CORS.
const DEV_MODE = process.env.DEV_MODE === 'true'

cds.on('bootstrap', (app) => {
  // Opt-in latency tracing (PERF_TRACE=true) — must be the first middleware so
  // "request received" is really the start. See lib/perf/trace.js.
  const perf = require('./lib/perf/trace')
  if (perf.ENABLED) app.use(perf.install(cds.env.requires.db.credentials.database))

  // xyra-web is a separate server/module (different origin), so every call it makes
  // here is cross-origin. CAP's built-in cds.server.cors handler doesn't set
  // Access-Control-Allow-Headers, so a JSON POST (application/json isn't a CORS
  // "simple" content-type) would pass its own preflight check but still get blocked
  // by the browser on the actual request — this replaces it with a complete handler.
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (!DEV_MODE || !origin) return next()
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
    res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  // Platform-admin sign-in (xyra-admin): email + password against
  // xyra.master.PlatformAdmins, returns a token with the platformAdmin claim.
  // Create admins with scripts/create-platform-admin.js.
  app.post('/api/platform-auth/login', express.json(), async (req, res) => {
    try {
      const { PlatformAdmins } = cds.entities('xyra.master')
      const admin = await SELECT.one.from(PlatformAdmins).where({ email: normEmail(req.body?.email), status: 'ACTIVE' })
      if (!admin || !(await verifyPassword(String(req.body?.password || ''), admin.passwordHash))) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' })
      }
      res.json({ success: true, token: issuePlatformToken(admin), email: admin.email, name: admin.name })
    } catch (err) {
      console.error('platform-auth/login failed:', err)
      res.status(500).json({ success: false, message: 'Sign-in failed. Please try again.' })
    }
  })

  // Every platform route needs a platform-admin token. The CAP services behind
  // these paths also declare @requires: 'platform-admin'; this gate is what
  // covers the plain express provisioning routes below.
  app.use(['/api/platform', '/api/onboarding', '/api/provisioning', '/odata/v4/platform'], (req, res, next) => {
    const claims = verify(bearer(req))
    if (!claims || !claims.platformAdmin) return res.status(401).json({ success: false, message: 'Platform admin sign-in required.' })
    req.platformAdmin = claims
    next()
  })

  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req.params.tenantId, req.platformAdmin.email))
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }

  app.post('/api/provisioning/:tenantId', wrap(runProvisioning))
  app.get('/api/provisioning/:tenantId', wrap(getProvisioningStatus))
  app.post('/api/provisioning/:tenantId/retry', wrap(runProvisioning))
})

// 'served', not 'bootstrap' - the master DB connection and cds.entities('xyra.master')
// aren't guaranteed to exist yet at bootstrap time.
cds.on('served', () => {
  require('./lib/tenant/TenantDirectory').start()
  require('./lib/control_scheduler').start()
  require('./lib/sla_reminder').start()
  require('./lib/ticketing/jiraSync').start()
})

module.exports = cds.server
