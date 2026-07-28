const cds = require('@sap/cds')
const { runProvisioning, getProvisioningStatus } = require('./handlers/provisioning')

// Path-parameterized REST routes (POST/GET /api/provisioning/:tenantId, POST .../retry)
// can't be expressed as CDS actions — those are fixed-name, no dynamic URL segments —
// so they're wired up here via CAP's documented server.js bootstrap hook instead.
// This fires before cds mounts any OData services, so there's no route collision risk.
cds.on('bootstrap', (app) => {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req.params.tenantId))
    } catch (err) {
      res.status(500).json({ success: false, message: err.message })
    }
  }

  app.post('/api/provisioning/:tenantId', wrap(runProvisioning))
  app.get('/api/provisioning/:tenantId', wrap(getProvisioningStatus))
  app.post('/api/provisioning/:tenantId/retry', wrap(runProvisioning))
})

module.exports = cds.server
