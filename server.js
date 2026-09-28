const cds = require('@sap/cds')
const { runProvisioning, getProvisioningStatus } = require('./handlers/provisioning')

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

  // Platform-admin routes (xyra-admin) — email-only sign-in, same interim trust
  // model as tenant AuthService.login (pending real SSO): the x-platform-admin
  // header must carry an email listed in PLATFORM_ADMIN_EMAILS (comma-separated).
  // Unset = these routes are off entirely, never open.
  // ponytail: an email alone is guessable — swap for an SSO-issued token when
  // tenant SSO lands; this guard is the one place to change.
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  app.use(['/api/platform', '/api/onboarding', '/api/provisioning', '/odata/v4/platform'], (req, res, next) => {
    if (!adminEmails.length) return res.status(503).json({ success: false, message: 'Platform admin is disabled (PLATFORM_ADMIN_EMAILS not set).' })
    if (!adminEmails.includes(String(req.headers['x-platform-admin'] || '').trim().toLowerCase())) {
      return res.status(401).json({ success: false, message: 'This email is not a platform admin.' })
    }
    next()
  })

  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req.params.tenantId, req.headers['x-platform-admin']))
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
  require('./lib/control_scheduler').start()
  require('./lib/sla_reminder').start()
  require('./lib/ticketing/jiraSync').start()
})

module.exports = cds.server
