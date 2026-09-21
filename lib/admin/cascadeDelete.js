// Deletes everything that hangs off one System, in FK-safe (children-first)
// order: SystemCredentials/ControlSystemConfig/ControlRunHistory/ControlRunLogs
// are direct children; Alerts fans out through AlertItems -> Reviews ->
// ReviewStatusHistory. Shared by system-config-service.js (single system) and
// organization-service.js (every system under a deleted Organization) so this
// chain is defined once, not duplicated per caller.
//
// AuditLogs is deliberately left alone - it's compliance evidence of what was
// done (including this deletion, logged by the caller right after), not
// operational data that should disappear with the thing it describes.
async function deleteSystemCascade(tx, entities, systemId) {
  const {
    SystemCredentials, ControlSystemConfig, ControlRunHistory, ControlRunLogs,
    Alerts, AlertItems, Reviews, ReviewStatusHistory
  } = entities

  const alerts = await tx.run(SELECT.from(Alerts).columns('ID').where({ system_ID: systemId }))
  const alertIds = alerts.map((a) => a.ID)

  if (alertIds.length) {
    const alertItems = await tx.run(SELECT.from(AlertItems).columns('ID').where({ alert_ID: { in: alertIds } }))
    const alertItemIds = alertItems.map((ai) => ai.ID)

    if (alertItemIds.length) {
      const reviews = await tx.run(SELECT.from(Reviews).columns('ID').where({ alertItem_ID: { in: alertItemIds } }))
      const reviewIds = reviews.map((r) => r.ID)

      if (reviewIds.length) {
        await tx.run(DELETE.from(ReviewStatusHistory).where({ review_ID: { in: reviewIds } }))
        await tx.run(DELETE.from(Reviews).where({ ID: { in: reviewIds } }))
      }

      await tx.run(DELETE.from(AlertItems).where({ ID: { in: alertItemIds } }))
    }

    await tx.run(DELETE.from(Alerts).where({ ID: { in: alertIds } }))
  }

  await tx.run(DELETE.from(ControlRunLogs).where({ system_ID: systemId }))
  await tx.run(DELETE.from(ControlRunHistory).where({ system_ID: systemId }))
  await tx.run(DELETE.from(ControlSystemConfig).where({ system_ID: systemId }))
  await tx.run(DELETE.from(SystemCredentials).where({ system_ID: systemId }))
}

module.exports = { deleteSystemCascade }
