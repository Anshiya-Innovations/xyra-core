// node --test test/deviationTicket.test.js
const test = require('node:test')
const assert = require('node:assert')
const { buildTicket } = require('../lib/ticketing/deviationTicket')

const item = { ID: 'i1', sapObject: 'SAP*', parameter: 'Password Changed', operator: 'EQUALS', expectedValue: 'No', actualValue: 'Yes', severity: 'MEDIUM', message: "Expected 'No', got 'Yes'.", createdAt: '2026-09-23T10:53:34.795Z' }
const ctx = {
  item,
  alert: { severity: 'MEDIUM' },
  alertId: 'a1',
  alertItems: [item, { ID: 'i2', sapObject: 'DDIC', parameter: 'User Type', expectedValue: 'B', actualValue: null }],
  control: { description: 'Password Changes', controlType: 'SECURITY', severity: 'MEDIUM', frequency: 'DAILY' },
  controlCode: 'XYRA-01',
  rules: [{ sapObject: 'SAP*', parameter: 'Password Changed', operator: 'EQUALS', expectedValue: 'No' }, { sapObject: 'DDIC', parameter: 'User Type', operator: 'EQUALS', expectedValue: 'B' }],
  system: { systemId: 'S4D', client: '100', platform: 'USROTC', region: '', sector: null },
  organizationName: '',
  review: { ID: 'r1', reviewer1Status: 'APPROVE', reviewer1Comment: '', reviewer1At: null, reviewer2Status: 'REMEDIATE', reviewer2Comment: 'fix it', reviewer2At: '2026-09-28T11:21:46Z' },
  reviewerNames: { 1: 'Reviewer One', 2: '' },
  level: 2,
  history: { total: 16, failed: 16, firstAt: '2026-09-20T00:00:00Z', lastPassAt: null },
  logs: [{ level: 'WARNING', message: "Rule 1 (SAP*/Password Changed): DEVIATION - expected 'No', got 'Yes'.", createdAt: '2026-09-23T10:53:34Z' }],
  appUrl: 'http://localhost:5173/'
}

function walk(node, visit) {
  visit(node)
  ;(node.content || []).forEach((c) => walk(c, visit))
}

test('buildTicket produces a specific, valid Jira ticket', () => {
  const t = buildTicket(ctx)
  assert.strictEqual(t.summary, "[XYRA-01] SAP* / Password Changed deviates on S4D/100 - expected equals 'No', found 'Yes'")
  assert.strictEqual(t.priority, 'Medium')
  assert.deepStrictEqual(t.labels, ['xyra-deviation', 'XYRA-01', 'S4D-100', 'rejected-level-2'])

  // ADF: paragraphs/headings hold inline nodes only (text), never block nodes.
  walk(t.description, (n) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      ;(n.content || []).forEach((c) => assert.strictEqual(c.type, 'text', `${n.type} may only contain text, got ${c.type}`))
    }
  })

  const texts = []
  walk(t.description, (n) => {
    if (n.type === 'text') {
      assert.ok(n.text.length > 0, 'ADF rejects empty text nodes')
      texts.push(n.text)
    }
  })
  const all = texts.join('\n')
  assert.match(all, /It has never passed/)
  assert.match(all, /<< this ticket/) // rule marked in the control's rule set
  assert.match(all, />> this ticket/) // row marked among the run's deviations
  assert.match(all, /\(not found\)/) // the other deviation's missing value
  assert.match(all, />> .*SAP\*\/Password Changed/) // log line for this rule marked
  let hasLink = false
  walk(t.description, (n) => {
    if (n.marks && n.marks.some((m) => m.type === 'link' && m.attrs.href === 'http://localhost:5173/deviation-report/a1')) hasLink = true
  })
  assert.ok(hasLink, 'Open in Xyra link uses XYRA_APP_URL without a double slash')
})
