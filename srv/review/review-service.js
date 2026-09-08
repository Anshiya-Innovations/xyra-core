const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const reviewEngine = require('../../lib/review_engine')

module.exports = function (srv) {
  function wireQueue(action, fn) {
    srv.on(action, async (req) => {
      const fail = (message) => ({ success: false, message, reviews: [] })
      const subdomain = (req.data.subdomain || '').trim()
      if (!subdomain) return fail('subdomain is required.')

      const resolved = await resolveTenantBySubdomain(req, subdomain)
      if (!resolved) return fail('Tenant not found.')

      const reviews = await fn(resolved.tenant.ID, resolved.databaseName)
      return { success: true, message: 'OK', reviews }
    })
  }

  wireQueue('listLevel1Queue', reviewEngine.listLevel1Queue)
  wireQueue('listLevel2Queue', reviewEngine.listLevel2Queue)
  wireQueue('listLevel1History', reviewEngine.listLevel1History)
  wireQueue('listLevel2History', reviewEngine.listLevel2History)

  srv.on('getReviewDetail', async (req) => {
    const fail = (message) => ({ success: false, message, review: null })
    const subdomain = (req.data.subdomain || '').trim()
    const reviewId = (req.data.reviewId || '').trim()
    if (!subdomain || !reviewId) return fail('reviewId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const review = await reviewEngine.getReviewDetail(resolved.tenant.ID, resolved.databaseName, reviewId)
    if (!review) return fail('Review not found.')
    return { success: true, message: 'OK', review }
  })

  function wireDecide(action, fn) {
    srv.on(action, async (req) => {
      const fail = (message) => ({ success: false, message, ticketNumber: null })
      const subdomain = (req.data.subdomain || '').trim()
      const reviewId = (req.data.reviewId || '').trim()
      if (!subdomain || !reviewId) return fail('reviewId is required.')

      const resolved = await resolveTenantBySubdomain(req, subdomain)
      if (!resolved) return fail('Tenant not found.')

      return fn(resolved.tenant.ID, resolved.databaseName, {
        reviewId,
        decision: req.data.decision,
        comment: req.data.comment,
        actingUserId: req.data.actingUserId
      })
    })
  }

  wireDecide('decideLevel1', reviewEngine.decideLevel1)
  wireDecide('decideLevel2', reviewEngine.decideLevel2)
}
