const { controlCodeOf } = require('../control_engine/controlCode')

// deviationTicket: turns one rejected deviation (a Review of one AlertItem)
// into a self-contained remediation ticket - what deviated, what to change,
// the control and its full rule set, the system, the review decisions, the
// evidence history, the run's execution log, and how to verify the fix.
// Split into a loader (DB reads) and a pure builder so the ticket content is
// testable without a tenant DB or a Jira site (see test/deviationTicket.test.js).

const FREQUENCY_TEXT = {
  DAILY: 'Runs daily', WEEKLY: 'Runs weekly', MONTHLY: 'Runs monthly', QUARTERLY: 'Runs quarterly',
  ANNUAL: 'Runs annually', REALTIME: 'Runs continuously', CRON: 'Runs on a custom schedule'
}
const OPERATOR_TEXT = {
  EQUALS: 'equals', NOT_EQUALS: 'does not equal', CONTAINS: 'contains', NOT_CONTAINS: 'does not contain',
  EXISTS: 'exists', NOT_EXISTS: 'does not exist', GT: 'is greater than', LT: 'is less than',
  GTE: 'is at least', LTE: 'is at most'
}
const DECISION_TEXT = { APPROVE: 'Approved', REMEDIATE: 'Rejected - remediate', NEW: 'Pending' }

function severityToPriority(severity) {
  if (severity === 'CRITICAL') return 'Highest'
  if (severity === 'HIGH') return 'High'
  if (severity === 'LOW') return 'Low'
  return 'Medium'
}

const titleCase = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '')

function fmtDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

// Jira labels can't contain spaces.
const label = (s) => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

// ---- Minimal Atlassian Document Format builders. ADF rejects empty text
// nodes, so every text() falls back to a dash.
const text = (t, marks) => {
  const node = { type: 'text', text: t === null || t === undefined || t === '' ? '-' : String(t) }
  if (marks && marks.length) node.marks = marks
  return node
}
const strong = (t) => text(t, [{ type: 'strong' }])
const code = (t) => text(t, [{ type: 'code' }])
const em = (t) => text(t, [{ type: 'em' }])
const link = (t, href) => text(t, [{ type: 'link', attrs: { href } }])
const p = (...inline) => ({ type: 'paragraph', content: inline })
const heading = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] })
// A cell value is either plain text or an already-built paragraph node (for
// formatted cells) - never wrap a paragraph in another paragraph, ADF rejects it.
const cell = (type, value) => ({ type, content: [value && typeof value === 'object' ? value : p(text(value))] })
const table = (headers, rows) => ({
  type: 'table',
  attrs: { isNumberColumnEnabled: false, layout: 'default' },
  content: [
    { type: 'tableRow', content: headers.map((h) => cell('tableHeader', h)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) }))
  ]
})
const panel = (panelType, ...content) => ({ type: 'panel', attrs: { panelType }, content })
const codeBlock = (t) => ({ type: 'codeBlock', attrs: { language: 'text' }, content: [text(t)] })
const orderedList = (items) => ({ type: 'orderedList', content: items.map((inline) => ({ type: 'listItem', content: [p(...inline)] })) })

function describeExpectation(item) {
  if (item.operator === 'EXISTS' || item.operator === 'NOT_EXISTS') return OPERATOR_TEXT[item.operator]
  return `${OPERATOR_TEXT[item.operator] || item.operator.toLowerCase()} '${item.expectedValue}'`
}

// Pure: context -> { summary, priority, labels, description (ADF) }.
function buildTicket(ctx) {
  const { item, alertItems, control, controlCode, rules, system, organizationName, review, reviewerNames, level, history, logs, appUrl, alertId } = ctx
  const sys = system ? `${system.systemId}/${system.client}` : 'unknown system'
  const found = item.actualValue === null || item.actualValue === undefined ? 'nothing (value not found)' : `'${item.actualValue}'`
  const isThisRule = (r) => r.sapObject === item.sapObject && r.parameter === item.parameter

  const summary = `[${controlCode}] ${item.sapObject} / ${item.parameter} deviates on ${sys} - expected ${describeExpectation(item)}, found ${found}`.slice(0, 255)

  const content = []

  content.push(panel('warning',
    p(strong('Action required: '), text(`On ${system ? system.systemId : 'the system'}, client ${system ? system.client : '-'}, change `),
      strong(`${item.sapObject} > ${item.parameter}`), text(' so that it '), strong(describeExpectation(item)),
      text('. It is currently '), strong(found), text('.')),
    p(text(`This ticket is fixed when the next run of ${controlCode} reports this check as passed.`))
  ))

  // 1. What deviated
  content.push(heading(3, '1. What deviated'))
  content.push(table(
    ['SAP Object', 'Parameter', 'Rule', 'Expected', 'Actual', 'Severity'],
    [[item.sapObject, item.parameter, item.operator, item.expectedValue, p(strong(item.actualValue === null || item.actualValue === undefined ? '(not found)' : item.actualValue)), titleCase(item.severity)]]
  ))
  content.push(p(text(`Detected ${fmtDate(item.createdAt)}. Engine message: `), em(item.message || '-')))
  if (alertItems.length > 1) {
    content.push(p(text(`This run found ${alertItems.length} deviations on ${sys}; each has its own ticket. This ticket covers the marked row:`)))
    content.push(table(
      ['', 'SAP Object', 'Parameter', 'Expected', 'Actual'],
      alertItems.map((a) => [a.ID === item.ID ? '>> this ticket' : '', a.sapObject, a.parameter, a.expectedValue, a.actualValue === null || a.actualValue === undefined ? '(not found)' : a.actualValue])
    ))
  } else {
    content.push(p(text('This was the only deviation in that run.')))
  }

  // 2. Control
  content.push(heading(3, '2. Control'))
  content.push(p(
    strong(`${controlCode}${control ? ` - ${control.description}` : ' (control since deleted)'}`),
    text(control ? ` · ${titleCase(control.controlType) || 'Security'} control · Severity ${titleCase(control.severity) || 'Medium'} · ${FREQUENCY_TEXT[control.frequency] || control.frequency || '-'}` : '')
  ))
  if (rules.length) {
    content.push(table(
      ['#', 'SAP Object', 'Parameter', 'Rule', 'Expected', ''],
      rules.map((r, i) => [String(i + 1), r.sapObject, r.parameter, r.operator, r.expectedValue, isThisRule(r) ? '<< this ticket' : ''])
    ))
  }

  // 3. System
  content.push(heading(3, '3. System'))
  content.push(p(text(system
    ? [`${sys}`, system.platform && `Platform ${system.platform}`, system.region && `Region ${system.region}`, system.sector && `Sector ${system.sector}`, organizationName && `Organization ${organizationName}`].filter(Boolean).join(' · ')
    : 'System no longer exists in Xyra.')))

  // 4. Evidence history
  content.push(heading(3, '4. Evidence history'))
  content.push(p(history.total
    ? text(`This check has failed ${history.failed} of ${history.total} times it has run on ${sys} since ${fmtDate(history.firstAt)}.${history.failed === history.total ? ' It has never passed.' : ` Last passed ${fmtDate(history.lastPassAt)}.`}`)
    : text('No earlier run history for this check.')))

  // 5. Review decisions
  content.push(heading(3, '5. Review decisions'))
  const reviewRows = [
    ['1 - Control Exception Reviewer', DECISION_TEXT[review.reviewer1Status] || review.reviewer1Status, reviewerNames[1] || '-', fmtDate(review.reviewer1At), review.reviewer1Comment || '-']
  ]
  if (level === 2 || review.reviewer2Status !== 'NEW') {
    reviewRows.push(['2 - Manager Exception Reviewer', DECISION_TEXT[review.reviewer2Status] || review.reviewer2Status, reviewerNames[2] || '-', fmtDate(review.reviewer2At), review.reviewer2Comment || '-'])
  }
  content.push(table(['Level', 'Decision', 'By', 'Date', 'Root cause analysis'], reviewRows))

  // 6. Execution log
  content.push(heading(3, '6. Execution log (from this run)'))
  content.push(logs.length
    ? codeBlock(logs.map((l) => `${l.message.includes(`(${item.sapObject}/${item.parameter})`) ? '>> ' : '   '}${fmtDate(l.createdAt)}  ${l.level.padEnd(7)}  ${l.message}`).join('\n'))
    : p(text('No execution log lines were recorded for this run.')))

  // 7. How to fix and verify
  content.push(heading(3, '7. How to fix and verify'))
  content.push(orderedList([
    [text(`In ${sys}, set `), code(`${item.sapObject} > ${item.parameter}`), text(` so it ${describeExpectation(item)}.`)],
    [text(`In Xyra, open System Control Config > ${controlCode} on ${sys} > `), strong('Run Now'), text(` (or wait for the next scheduled run).`)],
    [text('Confirm the run log shows '), code(`(${item.sapObject}/${item.parameter}): OK`), text(', then move this ticket to Done. Xyra\'s Jira sync marks the review resolved automatically.')]
  ]))

  content.push(p(
    em(`Xyra reference: alert ${alertId}, review ${review.ID}, alert item ${item.ID}`),
    ...(appUrl ? [text(' · '), link('Open in Xyra', `${appUrl.replace(/\/$/, '')}/deviation-report/${alertId}`)] : [])
  ))

  return {
    summary,
    priority: severityToPriority(item.severity || (ctx.alert && ctx.alert.severity)),
    labels: ['xyra-deviation', label(controlCode), system && label(`${system.systemId}-${system.client}`), `rejected-level-${level}`].filter(Boolean),
    description: { type: 'doc', version: 1, content }
  }
}

// Reads everything buildTicket needs, inside the caller's tx (so the review's
// just-written decision is visible).
async function loadTicketContext(tx, entities, reviewId, level) {
  const { Reviews, AlertItems, Alerts, Systems, Controls, ControlRules, ControlRunHistory, ControlRunLogs, Users, Organizations } = entities
  const review = await tx.run(SELECT.one.from(Reviews).where({ ID: reviewId }))
  const item = review && await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
  if (!item) return null
  const alert = await tx.run(SELECT.one.from(Alerts).where({ ID: item.alert_ID }))
  if (!alert) return null

  // Sequential, not Promise.all: these share one tx (one pg client), and pg
  // deprecates overlapping queries on a single client.
  const alertItems = await tx.run(SELECT.from(AlertItems).where({ alert_ID: alert.ID }).orderBy('createdAt'))
  const control = await tx.run(SELECT.one.from(Controls).where({ ID: alert.control_ID }))
  const rules = await tx.run(SELECT.from(ControlRules).where({ control_ID: alert.control_ID }).orderBy('sortOrder'))
  const system = await tx.run(SELECT.one.from(Systems)
    .columns('ID', 'systemId', 'client', 'organization_ID', 'platform.code as platform', 'region.code as region', 'sector.code as sector')
    .where({ ID: alert.system_ID }))
  const logs = await tx.run(SELECT.from(ControlRunLogs).where({ alert_ID: alert.ID }).orderBy('createdAt'))
  const historyRows = await tx.run(SELECT.from(ControlRunHistory).columns('deviationFlag', 'createdAt')
    .where({ control_ID: alert.control_ID, system_ID: alert.system_ID, sapObject: item.sapObject, parameter: item.parameter })
    .orderBy('createdAt'))

  const org = system && system.organization_ID && Organizations
    ? await tx.run(SELECT.one.from(Organizations).columns('name').where({ ID: system.organization_ID }))
    : null
  const nameOf = async (id) => {
    if (!id) return ''
    const u = await tx.run(SELECT.one.from(Users).columns('name').where({ ID: id }))
    return u ? u.name : ''
  }
  const passes = historyRows.filter((h) => !h.deviationFlag)

  return {
    item, alert, alertId: alert.ID, alertItems, control, controlCode: controlCodeOf(control, alert), rules, system,
    organizationName: org ? org.name : '',
    review, level,
    reviewerNames: { 1: await nameOf(review.reviewer1By_ID), 2: await nameOf(review.reviewer2By_ID) },
    history: {
      total: historyRows.length,
      failed: historyRows.length - passes.length,
      firstAt: historyRows.length ? historyRows[0].createdAt : null,
      lastPassAt: passes.length ? passes[passes.length - 1].createdAt : null
    },
    logs,
    appUrl: '' // tenant-specific - filled in by the caller via lib/platform tenantAppUrl()
  }
}

module.exports = { buildTicket, loadTicketContext, severityToPriority }
