const assert = require('assert')
const { buildBaseUrl, buildAuthHeader } = require('./index')

// buildBaseUrl
assert.strictEqual(buildBaseUrl({ endpoint: 'https://s4.example.com/api/' }), 'https://s4.example.com/api', 'endpoint wins and trailing slash is trimmed')
assert.strictEqual(buildBaseUrl({ hostName: 's4.example.com', port: 44300 }), 'https://s4.example.com:44300', 'composed from hostName+port when no endpoint')
assert.strictEqual(buildBaseUrl({ hostName: 's4.example.com' }), 'https://s4.example.com:443', 'defaults to 443 when port missing')
assert.strictEqual(buildBaseUrl({}), null, 'no hostName or endpoint -> null')

// buildAuthHeader
assert.deepStrictEqual(buildAuthHeader({ jwtToken: 'abc123' }), { Authorization: 'Bearer abc123' }, 'jwtToken wins when present')
assert.deepStrictEqual(
  buildAuthHeader({ jwtToken: 'abc123', userId: 'u', passwordHash: 'h' }),
  { Authorization: 'Bearer abc123' },
  'jwtToken takes priority over userId/passwordHash'
)
assert.deepStrictEqual(
  buildAuthHeader({ userId: 'u1', passwordHash: 'h1' }),
  { Authorization: `Basic ${Buffer.from('u1:h1').toString('base64')}` },
  'falls back to Basic auth shape when only userId/passwordHash is present'
)
assert.deepStrictEqual(buildAuthHeader(null), {}, 'no credentials -> no auth header')
assert.deepStrictEqual(buildAuthHeader({}), {}, 'empty credentials -> no auth header')

console.log('connection_engine/index.test.js: all checks passed')
