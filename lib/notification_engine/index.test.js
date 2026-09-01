const assert = require('assert')
const { buildNotificationRow } = require('./index')

// buildNotificationRow
assert.throws(() => buildNotificationRow('id1', {}), /requires both title and message/, 'missing title/message throws')
assert.throws(() => buildNotificationRow('id1', { title: 'x' }), /requires both title and message/, 'message alone is not enough')

assert.deepStrictEqual(
  buildNotificationRow('id1', { title: 'System Added', message: 'S4D was added.' }),
  {
    ID: 'id1',
    title: 'System Added',
    message: 'S4D was added.',
    category: 'TASK',
    priority: 'MEDIUM',
    targetPage: null,
    targetRecord: null,
    icon: 'sap-icon://bell',
    iconClass: 'xyraNotifyIconBlue',
    read: false
  },
  'applies defaults when only title/message are given'
)

assert.deepStrictEqual(
  buildNotificationRow('id2', {
    title: 'System Offline', message: 'Ping failed.', category: 'REMINDER', priority: 'HIGH',
    targetPage: 'SystemHealth', targetRecord: 'S4D', icon: 'sap-icon://sys-cancel-2', iconClass: 'xyraNotifyIconRed'
  }),
  {
    ID: 'id2',
    title: 'System Offline',
    message: 'Ping failed.',
    category: 'REMINDER',
    priority: 'HIGH',
    targetPage: 'SystemHealth',
    targetRecord: 'S4D',
    icon: 'sap-icon://sys-cancel-2',
    iconClass: 'xyraNotifyIconRed',
    read: false
  },
  'passes through explicit values unchanged'
)

console.log('notification_engine/index.test.js: all checks passed')
