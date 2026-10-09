const reviewEngine = require('../../lib/review_engine')

module.exports = function (srv) {
  function wireQueue(action, fn) {
    srv.on(action, async (req) => {
      const fail = (message) => ({ success: false, message, reviews: [] })

      const { tenantId, databaseName } = req.user.attr

      const reviews = await fn(tenantId, databaseName)
      return { success: true, message: 'OK', reviews }
    })
  }

  wireQueue('listLevel1Queue', reviewEngine.listLevel1Queue)
  wireQueue('listLevel2Queue', reviewEngine.listLevel2Queue)
  wireQueue('listLevel1History', reviewEngine.listLevel1History)
  wireQueue('listLevel2History', reviewEngine.listLevel2History)

  srv.on('getReviewDetail', async (req) => {
    const fail = (message) => ({ success: false, message, review: null })
    const reviewId = (req.data.reviewId || '').trim()
    if (!reviewId) return fail('reviewId is required.')

    const { tenantId, databaseName } = req.user.attr

    const review = await reviewEngine.getReviewDetail(tenantId, databaseName, reviewId)
    if (!review) return fail('Review not found.')
    return { success: true, message: 'OK', review }
  })

  function wireDecide(action, fn) {
    srv.on(action, async (req) => {
      const fail = (message) => ({ success: false, message, ticketNumber: null })
      const reviewId = (req.data.reviewId || '').trim()
      if (!reviewId) return fail('reviewId is required.')

      const { tenantId, databaseName } = req.user.attr

      return fn(tenantId, databaseName, {
        reviewId,
        decision: req.data.decision,
        comment: req.data.comment,
        actingUserId: req.user.attr.tenantUserId
      })
    })
  }

  wireDecide('decideLevel1', reviewEngine.decideLevel1)
  wireDecide('decideLevel2', reviewEngine.decideLevel2)
}
