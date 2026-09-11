const cds = require('@sap/cds')

// Inserts one AuditLogs row inside the caller's own already-open tx - this
// never commits, callers own their own tx/commit. Called right before a
// handler's real tx.commit() so the log and the action it describes are
// atomic (same transaction, both happen or neither does).
async function logAudit(tx, entities, {
  action, module, objectType, objectId, objectLabel, description,
  previousValue, newValue, result, systemId, controlId, performedBy, performedByRole
}) {
  const { AuditLogs } = entities
  await tx.run(INSERT.into(AuditLogs).entries({
    ID: cds.utils.uuid(),
    action,
    module,
    objectType: objectType || null,
    objectId: objectId || null,
    objectLabel: objectLabel || null,
    description,
    previousValue: previousValue || null,
    newValue: newValue || null,
    result: result || 'SUCCESS',
    systemId: systemId || null,
    controlId: controlId || null,
    performedBy: performedBy || 'system',
    performedByRole: performedByRole || null
  }))
}

module.exports = { logAudit }
