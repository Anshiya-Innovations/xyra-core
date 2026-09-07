const assert = require('assert')
const { computeNextRunAt, computeNextCron } = require('./cronNext')

const from = new Date('2026-08-15T10:30:00Z') // a Saturday

assert.strictEqual(computeNextRunAt('DAILY', null, from).toISOString(), '2026-08-16T00:00:00.000Z', 'DAILY -> next UTC midnight')
assert.strictEqual(computeNextRunAt('WEEKLY', null, from).toISOString(), '2026-08-17T00:00:00.000Z', 'WEEKLY -> next Monday midnight')
assert.strictEqual(computeNextRunAt('MONTHLY', null, from).toISOString(), '2026-08-31T00:00:00.000Z', 'MONTHLY -> last day of this month')
assert.strictEqual(computeNextRunAt('MONTHLY', null, new Date('2026-08-31T00:00:00Z')).toISOString(), '2026-09-30T00:00:00.000Z', 'MONTHLY on the last day itself -> rolls to next month')
assert.strictEqual(computeNextRunAt('QUARTERLY', null, from).toISOString(), '2026-10-01T00:00:00.000Z', 'QUARTERLY -> next quarter start')
assert.strictEqual(computeNextRunAt('ANNUAL', null, from).toISOString(), '2027-01-01T00:00:00.000Z', 'ANNUAL -> next Jan 1')
assert.strictEqual(computeNextRunAt('REALTIME', null, from).getTime(), from.getTime() + 60000, 'REALTIME -> +60s')
assert.strictEqual(computeNextRunAt('UNKNOWN', null, from).toISOString(), '2026-08-16T00:00:00.000Z', 'unknown frequency falls back to DAILY')

// cron: '0 0 1 * *' -> 1st of next month, midnight
assert.strictEqual(computeNextCron('0 0 1 * *', from).toISOString(), '2026-09-01T00:00:00.000Z', 'monthly-1st cron')
// cron: every day at 09:00
assert.strictEqual(computeNextCron('0 9 * * *', from).toISOString(), '2026-08-16T09:00:00.000Z', 'daily-at-9am cron')
// cron: every Monday at 08:00
assert.strictEqual(computeNextCron('0 8 * * MON', from).toISOString(), '2026-08-17T08:00:00.000Z', 'weekly Monday cron by name')
// cron: every 15 minutes
assert.strictEqual(computeNextCron('*/15 * * * *', from).toISOString(), '2026-08-15T10:45:00.000Z', 'every-15-minutes cron')
// malformed cron falls back to +1 day
assert.strictEqual(computeNextCron('not a cron', from).toISOString(), '2026-08-16T10:30:00.000Z', 'malformed cron falls back to +1 day')

console.log('control_scheduler/cronNext.test.js: all checks passed')
