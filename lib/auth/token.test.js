const assert = require('assert')
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long'
const { sign, verify, bearer } = require('./token')

const claims = { sub: 'u1', tenantId: 't1', tenantUserId: 'tu1', persona: 'REVIEWER', email: 'a@b.c' }
const token = sign(claims, 60)

// round trip
const back = verify(token)
assert.strictEqual(back.tenantId, 't1')
assert.strictEqual(back.persona, 'REVIEWER')

// tampered payload (client swaps tenant) is rejected
const [h, , s] = token.split('.')
const forged = Buffer.from(JSON.stringify({ ...back, tenantId: 't2' })).toString('base64url')
assert.strictEqual(verify(`${h}.${forged}.${s}`), null, 'forged tenantId rejected')

// alg:none / foreign header is rejected
const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
assert.strictEqual(verify(`${none}.${token.split('.')[1]}.`), null, 'alg none rejected')

// expired, garbage, empty
assert.strictEqual(verify(sign(claims, -1)), null, 'expired rejected')
assert.strictEqual(verify('a.b.c'), null)
assert.strictEqual(verify(''), null)
assert.strictEqual(verify(undefined), null)

// a different secret doesn't verify
process.env.JWT_SECRET = 'another-secret-that-is-at-least-32-characters'
assert.strictEqual(verify(token), null, 'wrong secret rejected')

assert.strictEqual(bearer({ headers: { authorization: 'Bearer abc' } }), 'abc')
assert.strictEqual(bearer({ headers: {} }), null)

console.log('token.test.js: all assertions passed')
