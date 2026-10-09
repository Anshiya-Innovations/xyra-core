const cds = require('@sap/cds')
const { verify, bearer } = require('./token')
const { activeTenant } = require('../tenant/TenantDirectory')
const perf = require('../perf/trace')

// CAP custom auth (cds.requires.auth.impl) — the one place request identity is
// established. Verifies the bearer token locally, checks the tenant against the
// in-process TenantDirectory (no master DB query), and sets req.user:
//
//   tenant token   -> roles ['tenant-user', <persona>]
//                     attr  { tenantId, databaseName, tenantUserId, email, persona }
//   platform token -> roles ['platform-admin'], attr { email }
//
// Services declare @requires: 'tenant-user' / 'ADMIN' / 'platform-admin', so a
// missing/invalid token is a 401 before any handler runs, and a platform token
// can never reach a tenant service (or vice versa). Handlers read tenant and
// actor ONLY from req.user — never from req.data.
module.exports = function tokenAuth(req, res, next) {
  authenticate(req, res, next).catch(next) // express 4 doesn't catch async rejections
}

async function authenticate(req, res, next) {
  perf.mark('authStart')
  const token = bearer(req)
  if (!token) return next() // anonymous; @requires turns this into a 401

  const claims = perf.timed('jwtVerify', () => verify(token))
  if (!claims) return res.status(401).json({ error: { code: '401', message: 'Session expired or invalid. Please sign in again.' } })

  let user
  if (claims.platformAdmin) {
    user = new cds.User({ id: claims.sub, roles: ['platform-admin'], attr: { email: claims.email } })
  } else {
    const tenant = await perf.timed('tenantLookup', () => activeTenant(claims.tenantId))
    if (!tenant) return res.status(401).json({ error: { code: '401', message: 'This workspace is not available.' } })
    user = new cds.User({
      id: claims.sub,
      roles: ['tenant-user', claims.persona],
      attr: {
        tenantId: claims.tenantId,
        databaseName: tenant.databaseName,
        tenantUserId: claims.tenantUserId,
        email: claims.email,
        persona: claims.persona
      }
    })
  }

  cds.context.user = req.user = user
  perf.mark('authEnd')
  next()
}
