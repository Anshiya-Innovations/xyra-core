const assert = require('assert')
const { isTerminal, generateTicketNumber } = require('./index')

// isTerminal - truth table (2-level chain per SOP-8865 6.3.1)
assert.strictEqual(isTerminal({ reviewer1Status: 'NEW', reviewer2Status: 'NEW' }), false, 'fresh review is not terminal')
assert.strictEqual(isTerminal({ reviewer1Status: 'REMEDIATE', reviewer2Status: 'NEW' }), true, 'rejected at level 1 is terminal')
assert.strictEqual(isTerminal({ reviewer1Status: 'APPROVE', reviewer2Status: 'NEW' }), false, 'awaiting level 2 is not terminal')
assert.strictEqual(isTerminal({ reviewer1Status: 'APPROVE', reviewer2Status: 'REMEDIATE' }), true, 'rejected at level 2 is terminal')
assert.strictEqual(isTerminal({ reviewer1Status: 'APPROVE', reviewer2Status: 'APPROVE' }), true, 'approved at level 2 is terminal (final sign-off)')

// generateTicketNumber - format and uniqueness (stub, no real ticketing system)
const t1 = generateTicketNumber()
const t2 = generateTicketNumber()
assert.match(t1, /^TCK-[0-9A-F]{8}$/, 'ticket number matches the stub format')
assert.notStrictEqual(t1, t2, 'consecutive calls produce different ticket numbers')

console.log('review_engine/index.test.js: all checks passed')
