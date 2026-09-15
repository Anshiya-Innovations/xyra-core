const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')
const { notify } = require('../notification_engine')
const { logAudit } = require('../audit')
const { addBusinessDays } = require('./businessDays')
const { DEFAULT_SLA_SETTINGS } = require('./slaDefaults')
const { createIssue } = require('../ticketing/jira')

// review_engine: the 2-level deviation review/approval chain, matching
// SOP-8865 section 6.3.1 exactly - Control Exception Reviewer ("Reviewer1" in
// tool views) then Manager Exception Reviewer ("Reviewer2"), both REVIEWER
// role accounts. Reject at EITHER level creates a ticket immediately and ends
// the chain; approve at level 1 forwards to level 2; approve at level 2 is
// final closure - the SOP has no third review gate. One shared module - same
// "engine, not a service" split as control_engine/notification_engine. Wired
// in from control_engine.runControl (creates one Review per new deviation)
// and srv/review/review-service.js (Reviewer1/Reviewer2's queue/history reads
// and approve/reject writes).
//
// No reviewer-pool/assignment model exists (reviewer1@ and reviewer2@ share
// the exact same REVIEWER role - see lib/provisioning/seed.js's own comment),
// so this deliberately does not route reviews to specific named people.
// Level 1/2 are pure status-based shared queues: whoever opens that persona's
// page sees whatever's currently sitting at that stage, same as every other
// list in this app (no per-user row filtering exists anywhere).
// reviewer1By/reviewer2By record who actually acted, for audit only, not
// access control.

// ponytail: no real ticketing system integrated - this is a local placeholder,
// not a fake claim of a real integration. Swap this one function for a real
// API call (e.g. ServiceNow) later; every caller only ever reads
// {ticketNumber} back from it, so nothing else changes.
function generateTicketNumber() {
  return 'TCK-' + cds.utils.uuid().slice(0, 8).toUpperCase()
}

// AlertItems/Alerts.severity is CRITICAL/MEDIUM in this app (see
// control_engine) - mapped onto Jira Cloud's default priority scheme
// (Highest/High/Medium/Low/Lowest), present on every plan including Free
// unless a site has customized it away.
function severityToPriority(severity) {
  if (severity === 'CRITICAL') return 'Highest'
  if (severity === 'HIGH') return 'High'
  if (severity === 'LOW') return 'Low'
  return 'Medium'
}

// SOP 6.3.1.5/6.3.1.8: a REMEDIATE decision creates a ticket immediately.
// Real Jira issue when the deviation's Organization has JiraSettings
// configured and enabled; falls back to the local STUB number otherwise, or
// if the Jira call itself fails - a ticketing outage never blocks the
// reviewer's decision, same best-effort stance as notify().
async function createRemediationTicket(tx, entities, review, level, comment) {
  const { AlertItems, Alerts, Systems, Controls, JiraSettings } = entities
  const item = await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
  const alert = item ? await tx.run(SELECT.one.from(Alerts).where({ ID: item.alert_ID })) : null
  const system = alert ? await tx.run(SELECT.one.from(Systems).where({ ID: alert.system_ID })) : null
  const control = alert ? await tx.run(SELECT.one.from(Controls).where({ ID: alert.control_ID })) : null

  const jiraSettings = system && system.organization_ID
    ? await tx.run(SELECT.one.from(JiraSettings).where({ organization_ID: system.organization_ID }))
    : null

  if (jiraSettings && jiraSettings.enabled) {
    const controlId = control ? control.code : ''
    const systemId = system ? system.systemId : ''
    const severity = (item && item.severity) || (alert && alert.severity)
    const result = await createIssue({
      siteUrl: jiraSettings.siteUrl,
      email: jiraSettings.email,
      apiToken: jiraSettings.apiToken,
      projectKey: jiraSettings.projectKey,
      issueType: jiraSettings.issueType,
      summary: `Deviation rejected: ${controlId} on ${systemId}`,
      description: `Level ${level} review rejected this deviation.\n\nControl: ${controlId}\nSystem: ${systemId}\nParameter: ${item ? item.parameter : ''}\nExpected: ${item ? item.expectedValue : ''}\nActual: ${item ? item.actualValue : ''}\n\nReviewer comment: ${comment}`,
      priority: severityToPriority(severity),
      labels: ['xyra-deviation', controlId].filter(Boolean)
    }).catch((err) => ({ success: false, message: err.message }))

    if (result.success) {
      return { ticketNumber: result.key, ticketSystem: 'JIRA', ticketUrl: result.url }
    }
    console.error(`createRemediationTicket: Jira issue creation failed (${result.message}) - falling back to stub ticket.`)
  }

  return { ticketNumber: generateTicketNumber(), ticketSystem: 'STUB', ticketUrl: null }
}

// Pure and separately testable: a Review is done (no further action possible)
// once either level rejects it (REMEDIATE - ticketed and closed) or level 2
// approves it (final sign-off per SOP 6.3.1.9).
function isTerminal(review) {
  return review.reviewer1Status === 'REMEDIATE'
    || review.reviewer2Status === 'REMEDIATE'
    || review.reviewer2Status === 'APPROVE'
}

async function createReviewsForAlertItems(tx, Reviews, alertItemIds) {
  for (const alertItemId of alertItemIds) {
    await tx.run(INSERT.into(Reviews).entries({
      ID: cds.utils.uuid(),
      alertItem_ID: alertItemId,
      reviewer1Status: 'NEW',
      reviewer2Status: 'NEW'
    }))
  }
}

// Self-healing backfill: AlertItems created before this Review chain existed
// (or from any gap where the create-hook didn't run) would otherwise never
// appear in any queue, since every queue/history read is Reviews-driven, not
// AlertItems-driven. Cheap on this dataset size (same "small per-tenant
// dataset" reasoning as listByPredicate below) - runs on every queue read
// rather than a one-off migration script, so it also heals itself in any
// future gap, not just this one.
async function backfillMissingReviews(tx, entities) {
  const { AlertItems, Reviews } = entities
  const items = await tx.run(SELECT.from(AlertItems).columns('ID'))
  const reviews = await tx.run(SELECT.from(Reviews).columns('alertItem_ID'))
  const covered = new Set(reviews.map((r) => r.alertItem_ID))
  const missing = items.map((i) => i.ID).filter((id) => !covered.has(id))
  if (missing.length) await createReviewsForAlertItems(tx, Reviews, missing)
}

// Per-tenant business-day SLA (one universal Reviewer1/Reviewer2 pair - this
// app's review chain has no per-control-type split, unlike SOP-8865's
// Security/Basis distinction; see slaDefaults.js/SlaSettings, admin-editable).
// Active-stage only: a review sitting at Level 1 (reviewer1Status=NEW) clocks
// from createdAt; one that's passed Level 1 and awaiting Level 2 clocks from
// reviewer1At (stamped in decideLevel1 exactly when Level 1 approves). A
// terminal review (either level REMEDIATE, or Level 2 APPROVE) has no active
// clock left to report. Escalation Manager has no decision gate of its own
// (see EscalationManager.controller.js's header comment) - escalationDue just
// flags a Level 2 item that's overdue by more than the tenant's configured
// escalation delay, for that persona's oversight view.
function computeSla(review, settings) {
  let stage = null
  let clockStart = null
  if (review.reviewer1Status === 'NEW') {
    stage = 1; clockStart = review.createdAt
  } else if (review.reviewer1Status === 'APPROVE' && review.reviewer2Status === 'NEW') {
    stage = 2; clockStart = review.reviewer1At
  }
  if (!stage || !clockStart) return { slaDeadline: null, daysPending: null, isOverdue: false, escalationDue: false }

  const days = stage === 1 ? settings.reviewer1Days : settings.reviewer2Days
  const deadline = addBusinessDays(clockStart, days)
  const now = new Date()
  const daysPending = Math.floor((now - new Date(clockStart)) / (24 * 60 * 60 * 1000))
  const isOverdue = now > deadline

  let escalationDue = false
  if (stage === 2 && isOverdue) {
    const escalationDeadline = addBusinessDays(deadline, settings.escalationDelayDays)
    escalationDue = now > escalationDeadline
  }

  return { slaDeadline: deadline.toISOString(), daysPending, isOverdue, escalationDue }
}

async function nameOf(tx, Users, userId) {
  if (!userId) return ''
  const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
  return user ? user.name : ''
}

// Joins a Review up through AlertItems -> Alerts -> Controls/Systems, plus a
// Users lookup per level's "by" field, into one flat entry. Sequential
// SELECT.one calls - fine for a single row (getReviewDetail), but NEVER call
// this in a loop: see loadLookups/buildReviewEntry below for the batch path
// listByPredicate uses instead (this was originally called once per row in a
// for-loop there too, which turned into a real N+1 - 25 Reviews rows meant
// ~150 sequential round trips, ~30s+ against a non-local Postgres instance).
async function loadReviewEntry(tx, entities, review) {
  const { AlertItems, Alerts, Controls, Systems, Users, SlaSettings } = entities
  const item = await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
  const alert = item ? await tx.run(SELECT.one.from(Alerts).where({ ID: item.alert_ID })) : null
  const control = alert ? await tx.run(SELECT.one.from(Controls).where({ ID: alert.control_ID })) : null
  const system = alert ? await tx.run(SELECT.one.from(Systems).where({ ID: alert.system_ID })) : null
  const slaRow = await tx.run(SELECT.one.from(SlaSettings))

  return {
    id: review.ID,
    alertItemId: review.alertItem_ID,
    alertId: alert ? alert.ID : '',
    controlId: control ? control.code : '',
    controlDescription: control ? control.description : '',
    systemId: system ? system.systemId : '',
    client: system ? system.client : '',
    sapObject: item ? item.sapObject : '',
    parameter: item ? item.parameter : '',
    operator: item ? item.operator : '',
    actualValue: item ? item.actualValue : '',
    expectedValue: item ? item.expectedValue : '',
    message: item ? item.message : '',
    severity: (item && item.severity) || (alert && alert.severity) || '',
    generatedDate: (alert && alert.incidentCreatedAt) || review.createdAt,

    reviewer1Status: review.reviewer1Status,
    reviewer1Comment: review.reviewer1Comment || '',
    reviewer1ByName: await nameOf(tx, Users, review.reviewer1By_ID),
    reviewer1At: review.reviewer1At,

    reviewer2Status: review.reviewer2Status,
    reviewer2Comment: review.reviewer2Comment || '',
    reviewer2ByName: await nameOf(tx, Users, review.reviewer2By_ID),
    reviewer2At: review.reviewer2At,

    ticketNumber: review.ticketNumber || '',
    ticketLevel: review.ticketLevel || null,
    ticketCreatedAt: review.ticketCreatedAt || null,
    ticketUrl: review.ticketUrl || null,
    ticketStatus: review.ticketStatus || '',
    ticketResolved: !!review.ticketResolved,
    ...computeSla(review, slaRow || DEFAULT_SLA_SETTINGS)
  }
}

// Batch version of loadReviewEntry for listByPredicate: 5 full-table SELECTs
// total (same "small per-tenant dataset, fetch once" pattern already used
// throughout this codebase - control-service.js/deviation-service.js do the
// same), then O(1) Map lookups per row instead of ~6 awaited queries per row.
async function loadLookups(tx, entities) {
  const { AlertItems, Alerts, Controls, Systems, Users, SlaSettings } = entities
  const [items, alerts, controls, systems, users, slaRow] = await Promise.all([
    tx.run(SELECT.from(AlertItems)),
    tx.run(SELECT.from(Alerts)),
    tx.run(SELECT.from(Controls)),
    tx.run(SELECT.from(Systems)),
    tx.run(SELECT.from(Users)),
    tx.run(SELECT.one.from(SlaSettings))
  ])
  const byId = (rows) => new Map(rows.map((r) => [r.ID, r]))
  return {
    itemById: byId(items), alertById: byId(alerts), controlById: byId(controls),
    systemById: byId(systems), userById: byId(users),
    slaSettings: slaRow || DEFAULT_SLA_SETTINGS
  }
}

function buildReviewEntry(review, lookups) {
  const item = lookups.itemById.get(review.alertItem_ID)
  const alert = item ? lookups.alertById.get(item.alert_ID) : null
  const control = alert ? lookups.controlById.get(alert.control_ID) : null
  const system = alert ? lookups.systemById.get(alert.system_ID) : null
  const nameOfCached = (userId) => {
    if (!userId) return ''
    const user = lookups.userById.get(userId)
    return user ? user.name : ''
  }

  return {
    id: review.ID,
    alertItemId: review.alertItem_ID,
    alertId: alert ? alert.ID : '',
    controlId: control ? control.code : '',
    controlDescription: control ? control.description : '',
    systemId: system ? system.systemId : '',
    client: system ? system.client : '',
    sapObject: item ? item.sapObject : '',
    parameter: item ? item.parameter : '',
    operator: item ? item.operator : '',
    actualValue: item ? item.actualValue : '',
    expectedValue: item ? item.expectedValue : '',
    message: item ? item.message : '',
    severity: (item && item.severity) || (alert && alert.severity) || '',
    generatedDate: (alert && alert.incidentCreatedAt) || review.createdAt,

    reviewer1Status: review.reviewer1Status,
    reviewer1Comment: review.reviewer1Comment || '',
    reviewer1ByName: nameOfCached(review.reviewer1By_ID),
    reviewer1At: review.reviewer1At,

    reviewer2Status: review.reviewer2Status,
    reviewer2Comment: review.reviewer2Comment || '',
    reviewer2ByName: nameOfCached(review.reviewer2By_ID),
    reviewer2At: review.reviewer2At,

    ticketNumber: review.ticketNumber || '',
    ticketLevel: review.ticketLevel || null,
    ticketCreatedAt: review.ticketCreatedAt || null,
    ticketUrl: review.ticketUrl || null,
    ticketStatus: review.ticketStatus || '',
    ticketResolved: !!review.ticketResolved,
    ...computeSla(review, lookups.slaSettings)
  }
}

async function withTx(tenantId, databaseName) {
  const tenantDb = await getPool(tenantId, databaseName)
  return { tx: tenantDb.tx(), entities: await tenantEntities() }
}

// Small per-tenant dataset - one SELECT.from(Reviews), filter in JS, then one
// batch of lookups (loadLookups) instead of a per-row loop. Deliberately not
// a CQN inequality/OR where-shape: this pinned @cap-js/postgres version has
// already shown real quirks with less-common query shapes (see
// notification_engine.clearAll's own comment) - plain equality .where() or
// full-table-then-filter-in-JS are the two proven-safe patterns here.
async function listByPredicate(tenantId, databaseName, predicate, sortKey) {
  const { tx, entities } = await withTx(tenantId, databaseName)
  try {
    await backfillMissingReviews(tx, entities)
    const rows = (await tx.run(SELECT.from(entities.Reviews))).filter(predicate)
    rows.sort((a, b) => new Date(a[sortKey] || a.createdAt) - new Date(b[sortKey] || b.createdAt))
    if (!rows.length) return []
    const lookups = await loadLookups(tx, entities)
    return rows.map((row) => buildReviewEntry(row, lookups))
  } finally {
    await tx.commit()
  }
}

const listLevel1Queue = (tenantId, databaseName) =>
  listByPredicate(tenantId, databaseName, (r) => r.reviewer1Status === 'NEW', 'createdAt')

const listLevel2Queue = (tenantId, databaseName) =>
  listByPredicate(tenantId, databaseName, (r) => r.reviewer1Status === 'APPROVE' && r.reviewer2Status === 'NEW', 'reviewer1At')

const listLevel1History = (tenantId, databaseName) =>
  listByPredicate(tenantId, databaseName, (r) => r.reviewer1Status !== 'NEW', 'reviewer1At')

const listLevel2History = (tenantId, databaseName) =>
  listByPredicate(tenantId, databaseName, (r) => r.reviewer2Status !== 'NEW', 'reviewer2At')

async function getReviewDetail(tenantId, databaseName, reviewId) {
  const { tx, entities } = await withTx(tenantId, databaseName)
  try {
    const review = await tx.run(SELECT.one.from(entities.Reviews).where({ ID: reviewId }))
    if (!review) return null
    return loadReviewEntry(tx, entities, review)
  } finally {
    await tx.commit()
  }
}

// Bumps the parent Alert's status once its items have decisions: NEW ->
// IN_PROCESS the first time anything under it is decided, -> RESOLVED once
// every AlertItem under it is terminal. Single-row UPDATEs only - the pinned
// @cap-js/postgres version throws on a multi-row UPDATE with a boolean SET
// (see notification_engine.clearAll), and incidentStatus changes here are
// always exactly one Alerts row at a time anyway.
async function rollUpAlertStatus(tx, entities, alertId) {
  const { Alerts, AlertItems, Reviews } = entities
  const alert = await tx.run(SELECT.one.from(Alerts).where({ ID: alertId }))
  if (!alert) return

  if (alert.incidentStatus === 'NEW') {
    await tx.run(UPDATE(Alerts).set({ incidentStatus: 'IN_PROCESS' }).where({ ID: alertId }))
  }

  const items = await tx.run(SELECT.from(AlertItems).columns('ID').where({ alert_ID: alertId }))
  const reviews = []
  for (const item of items) {
    reviews.push(await tx.run(SELECT.one.from(Reviews).where({ alertItem_ID: item.ID })))
  }
  if (reviews.length && reviews.every((r) => r && isTerminal(r))) {
    await tx.run(UPDATE(Alerts).set({ incidentStatus: 'RESOLVED', incidentChangedAt: new Date() }).where({ ID: alertId }))
  }
}

// SOP-8865 6.3.1.4/6.3.1.5/6.3.1.6: Control Exception Reviewer must document
// root cause analysis for either decision (comment mandatory both ways) and
// their Electronic Signature - the signature is a pure client-side submit
// gate (see Reviewer1.view.xml's confirmation checkbox), never sent here:
// there's no real crypto/signature verification in this system, so persisting
// a fake "signed" boolean would misrepresent what actually happened.
async function decideLevel1(tenantId, databaseName, { reviewId, decision, comment, actingUserId }) {
  const fail = (message) => ({ success: false, message, ticketNumber: null })
  if (!['APPROVE', 'REMEDIATE'].includes(decision)) return fail('decision must be APPROVE or REMEDIATE.')
  if (!comment || !comment.trim()) return fail('A review comment is required.')

  const { tx, entities } = await withTx(tenantId, databaseName)
  try {
    const { Reviews, ReviewStatusHistory, AlertItems } = entities
    const review = await tx.run(SELECT.one.from(Reviews).where({ ID: reviewId }))
    if (!review) return fail('Review not found.')
    if (review.reviewer1Status !== 'NEW') return fail('This item has already been decided at Level 1.')

    const now = new Date()
    let ticketNumber = null

    await tx.run(UPDATE(Reviews).set({
      reviewer1Status: decision, reviewer1Comment: comment, reviewer1By_ID: actingUserId || null, reviewer1At: now
    }).where({ ID: reviewId }))
    await tx.run(INSERT.into(ReviewStatusHistory).entries({
      ID: cds.utils.uuid(), review_ID: reviewId, reviewLevel: 1, status: decision, comment, changedBy_ID: actingUserId || null, changedAt: now
    }))

    // SOP 6.3.1.5: rejected records trigger a ticket immediately.
    if (decision === 'REMEDIATE') {
      const ticket = await createRemediationTicket(tx, entities, review, 1, comment)
      ticketNumber = ticket.ticketNumber
      await tx.run(UPDATE(Reviews).set({
        ticketNumber: ticket.ticketNumber, ticketLevel: 1, ticketCreatedAt: now,
        ticketSystem: ticket.ticketSystem, ticketUrl: ticket.ticketUrl
      }).where({ ID: reviewId }))
    }

    const item = await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
    if (item) await rollUpAlertStatus(tx, entities, item.alert_ID)

    // SOP 6.3.1.6: approved records trigger the next level of decision.
    notify(tenantId, databaseName, {
      title: decision === 'APPROVE' ? 'Deviation forwarded to Reviewer 2' : 'Remediation ticket created',
      message: decision === 'APPROVE'
        ? 'A deviation was approved at Level 1 and is now awaiting Level 2 review.'
        : `Remediation ticket ${ticketNumber} created at Level 1.`,
      category: decision === 'APPROVE' ? 'TASK' : 'TICKET', priority: decision === 'APPROVE' ? 'MEDIUM' : 'HIGH',
      targetPage: decision === 'APPROVE' ? 'Reviewer2' : 'Reviewer1', targetRecord: reviewId,
      icon: decision === 'APPROVE' ? 'sap-icon://forward' : 'sap-icon://alert',
      iconClass: decision === 'APPROVE' ? 'xyraNotifyIconBlue' : 'xyraNotifyIconRed'
    }).catch((err) => console.error('notify(decideLevel1) failed:', err))

    const entry = await loadReviewEntry(tx, entities, review)
    const reviewerName = await nameOf(tx, entities.Users, actingUserId)
    await logAudit(tx, entities, {
      action: decision === 'APPROVE' ? 'REVIEW_APPROVE' : 'REVIEW_REJECT',
      module: 'Review',
      objectType: 'Review',
      objectId: reviewId,
      objectLabel: entry.controlId,
      description: decision === 'APPROVE'
        ? `Approved Level 1 review for '${entry.controlId}' on ${entry.systemId} - forwarded to Level 2.`
        : `Rejected Level 1 review for '${entry.controlId}' on ${entry.systemId}: ${comment}`,
      systemId: entry.systemId,
      controlId: entry.controlId,
      performedBy: reviewerName || 'system'
    })
    if (ticketNumber) {
      await logAudit(tx, entities, {
        action: 'TICKET_CREATED',
        module: 'Review',
        objectType: 'Ticket',
        objectId: ticketNumber,
        objectLabel: ticketNumber,
        description: `Remediation ticket ${ticketNumber} created for review of '${entry.controlId}' on ${entry.systemId} (Level 1 rejection).`,
        systemId: entry.systemId,
        controlId: entry.controlId,
        performedBy: reviewerName || 'system'
      })
    }

    return { success: true, message: 'Decision recorded.', ticketNumber }
  } finally {
    await tx.commit()
  }
}

// SOP-8865 6.3.1.7/6.3.1.8/6.3.1.9: Manager Exception Reviewer is the final
// (second) level - reject tickets and ends the chain, approve is final
// closure with no further gate.
async function decideLevel2(tenantId, databaseName, { reviewId, decision, comment, actingUserId }) {
  const fail = (message) => ({ success: false, message, ticketNumber: null })
  if (!['APPROVE', 'REMEDIATE'].includes(decision)) return fail('decision must be APPROVE or REMEDIATE.')
  if (!comment || !comment.trim()) return fail('A review comment is required.')

  const { tx, entities } = await withTx(tenantId, databaseName)
  try {
    const { Reviews, ReviewStatusHistory, AlertItems } = entities
    const review = await tx.run(SELECT.one.from(Reviews).where({ ID: reviewId }))
    if (!review) return fail('Review not found.')
    if (review.reviewer1Status !== 'APPROVE' || review.reviewer2Status !== 'NEW') {
      return fail('This item is not awaiting Level 2 review.')
    }

    const now = new Date()
    let ticketNumber = null

    await tx.run(UPDATE(Reviews).set({
      reviewer2Status: decision, reviewer2Comment: comment, reviewer2By_ID: actingUserId || null, reviewer2At: now
    }).where({ ID: reviewId }))
    await tx.run(INSERT.into(ReviewStatusHistory).entries({
      ID: cds.utils.uuid(), review_ID: reviewId, reviewLevel: 2, status: decision, comment, changedBy_ID: actingUserId || null, changedAt: now
    }))

    // SOP 6.3.1.8: rejected records trigger a ticket immediately.
    if (decision === 'REMEDIATE') {
      const ticket = await createRemediationTicket(tx, entities, review, 2, comment)
      ticketNumber = ticket.ticketNumber
      await tx.run(UPDATE(Reviews).set({
        ticketNumber: ticket.ticketNumber, ticketLevel: 2, ticketCreatedAt: now,
        ticketSystem: ticket.ticketSystem, ticketUrl: ticket.ticketUrl
      }).where({ ID: reviewId }))
    }

    const item = await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
    if (item) await rollUpAlertStatus(tx, entities, item.alert_ID)

    // SOP 6.3.1.9: approved records are final - the tool documents the
    // decision with proper approval, no third review gate.
    notify(tenantId, databaseName, {
      title: decision === 'APPROVE' ? 'Deviation closed - final approval' : 'Remediation ticket created',
      message: decision === 'APPROVE'
        ? 'A deviation received final approval at Level 2 and is now closed.'
        : `Remediation ticket ${ticketNumber} created at Level 2.`,
      category: decision === 'APPROVE' ? 'TASK' : 'TICKET', priority: decision === 'APPROVE' ? 'LOW' : 'HIGH',
      targetPage: 'Reviewer2', targetRecord: reviewId,
      icon: decision === 'APPROVE' ? 'sap-icon://accept' : 'sap-icon://alert',
      iconClass: decision === 'APPROVE' ? 'xyraNotifyIconGreen' : 'xyraNotifyIconRed'
    }).catch((err) => console.error('notify(decideLevel2) failed:', err))

    const entry = await loadReviewEntry(tx, entities, review)
    const reviewerName = await nameOf(tx, entities.Users, actingUserId)
    await logAudit(tx, entities, {
      action: decision === 'APPROVE' ? 'REVIEW_APPROVE' : 'REVIEW_REJECT',
      module: 'Review',
      objectType: 'Review',
      objectId: reviewId,
      objectLabel: entry.controlId,
      description: decision === 'APPROVE'
        ? `Approved Level 2 review for '${entry.controlId}' on ${entry.systemId} - final closure.`
        : `Rejected Level 2 review for '${entry.controlId}' on ${entry.systemId}: ${comment}`,
      systemId: entry.systemId,
      controlId: entry.controlId,
      performedBy: reviewerName || 'system'
    })
    if (ticketNumber) {
      await logAudit(tx, entities, {
        action: 'TICKET_CREATED',
        module: 'Review',
        objectType: 'Ticket',
        objectId: ticketNumber,
        objectLabel: ticketNumber,
        description: `Remediation ticket ${ticketNumber} created for review of '${entry.controlId}' on ${entry.systemId} (Level 2 rejection).`,
        systemId: entry.systemId,
        controlId: entry.controlId,
        performedBy: reviewerName || 'system'
      })
    }

    return { success: true, message: 'Decision recorded.', ticketNumber }
  } finally {
    await tx.commit()
  }
}

module.exports = {
  createReviewsForAlertItems,
  listLevel1Queue, listLevel2Queue,
  listLevel1History, listLevel2History,
  getReviewDetail,
  decideLevel1, decideLevel2,
  isTerminal, generateTicketNumber
}
