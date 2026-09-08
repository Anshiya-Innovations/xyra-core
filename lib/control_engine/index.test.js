const assert = require('assert')
const { evaluateOperator, escapeODataLiteral } = require('./index')

// EQUALS / NOT_EQUALS
assert.strictEqual(evaluateOperator('EQUALS', 'Yes', 'Yes'), true)
assert.strictEqual(evaluateOperator('EQUALS', 'Yes', 'No'), false)
assert.strictEqual(evaluateOperator('EQUALS', ' Yes ', 'Yes'), true, 'trims whitespace')
assert.strictEqual(evaluateOperator('NOT_EQUALS', 'Yes', 'No'), true)
assert.strictEqual(evaluateOperator('NOT_EQUALS', 'Yes', 'Yes'), false)

// CONTAINS / NOT_CONTAINS
assert.strictEqual(evaluateOperator('CONTAINS', 'Z_FI_AP_CLERK,Z_FI_AP_APPROVER', 'Z_FI_AP_APPROVER'), true)
assert.strictEqual(evaluateOperator('CONTAINS', 'Z_SD_ORDER_CLERK', 'SAP_ALL'), false)
assert.strictEqual(evaluateOperator('NOT_CONTAINS', 'Z_SD_ORDER_CLERK', 'SAP_ALL'), true)

// EXISTS / NOT_EXISTS - the only operators where a missing actual value is meaningful
assert.strictEqual(evaluateOperator('EXISTS', null, null), false)
assert.strictEqual(evaluateOperator('EXISTS', '', null), false)
assert.strictEqual(evaluateOperator('EXISTS', 'JDOE', null), true)
assert.strictEqual(evaluateOperator('NOT_EXISTS', null, null), true)
assert.strictEqual(evaluateOperator('NOT_EXISTS', 'JDOE', null), false)

// numeric operators
assert.strictEqual(evaluateOperator('GT', '5', '3'), true)
assert.strictEqual(evaluateOperator('GT', '2', '3'), false)
assert.strictEqual(evaluateOperator('LT', '2', '3'), true)
assert.strictEqual(evaluateOperator('GTE', '3', '3'), true)
assert.strictEqual(evaluateOperator('LTE', '3', '3'), true)
assert.strictEqual(evaluateOperator('GT', 'not-a-number', '3'), false, 'non-numeric actual fails closed')

// fail-closed: every operator except EXISTS/NOT_EXISTS fails on a missing actual value
assert.strictEqual(evaluateOperator('EQUALS', null, 'Yes'), false)
assert.strictEqual(evaluateOperator('CONTAINS', undefined, 'Yes'), false)
assert.strictEqual(evaluateOperator('GT', '', '3'), false)

// unknown operator fails closed
assert.strictEqual(evaluateOperator('BOGUS', 'Yes', 'Yes'), false)

// OData V2 literal escaping (doubling embedded single quotes) - needed since
// sapObject/parameter can be free-text Rule Builder overrides interpolated
// into a $filter expression (see fetchObjectParameter).
assert.strictEqual(escapeODataLiteral('SAP*'), 'SAP*', 'no quotes -> unchanged')
assert.strictEqual(escapeODataLiteral("Manager's Approval"), "Manager''s Approval", 'single quote doubled')
assert.strictEqual(escapeODataLiteral("a'b'c"), "a''b''c", 'multiple quotes all doubled')
assert.strictEqual(escapeODataLiteral(1000), '1000', 'non-string input coerced to string')

console.log('control_engine/index.test.js: all checks passed')
