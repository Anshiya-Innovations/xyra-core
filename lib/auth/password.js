const crypto = require('crypto')
const { promisify } = require('util')
const scrypt = promisify(crypto.scrypt)

const KEYLEN = 64

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = (await scrypt(plain, salt, KEYLEN)).toString('hex')
  return `scrypt:${salt}:${hash}`
}

async function verifyPassword(plain, stored) {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = (await scrypt(plain, salt, KEYLEN)).toString('hex')
  const a = Buffer.from(candidate, 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ponytail: readable temp password (excludes visually-ambiguous chars: 0/O, 1/l/I) —
// admin is expected to change it after first login, once that flow exists.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
function generateTempPassword(length = 12) {
  return Array.from(crypto.randomFillSync(new Uint8Array(length)))
    .map(b => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length])
    .join('')
}

module.exports = { hashPassword, verifyPassword, generateTempPassword }
