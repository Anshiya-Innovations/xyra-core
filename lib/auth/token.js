const crypto = require('crypto')

// Minimal HS256 JWT on Node's own crypto — the one algorithm we issue and
// accept, so no library/alg-negotiation surface. Verification is local (no DB):
// this is what keeps the master DB off the normal request path.

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')

function secret() {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ chars).')
  return s
}

const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url')

function sign(claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds })).toString('base64url')
  return `${HEADER}.${payload}.${hmac(`${HEADER}.${payload}`)}`
}

// Returns the claims, or null for anything malformed, forged or expired.
function verify(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== HEADER) return null
  const expected = Buffer.from(hmac(`${parts[0]}.${parts[1]}`))
  const given = Buffer.from(parts[2])
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  let claims
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return null
  }
  if (!claims || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) return null
  return claims
}

const bearer = (req) => {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

module.exports = { sign, verify, bearer }
