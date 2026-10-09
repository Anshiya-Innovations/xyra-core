// Creates (or resets the password of) a xyra-admin platform operator.
// Usage: node scripts/create-platform-admin.js <email> <password> [name]

const cds = require('@sap/cds')
const { hashPassword } = require('../lib/auth/password')
const { normEmail } = require('../lib/auth/identity')

async function main() {
  const [emailArg, password, name] = process.argv.slice(2)
  if (!emailArg || !password) throw new Error('Usage: node scripts/create-platform-admin.js <email> <password> [name]')
  if (password.length < 12) throw new Error('Use a password of at least 12 characters.')

  cds.model = cds.linked(cds.compile.for.nodejs(await cds.load('db')))
  await cds.connect.to('db')
  const { PlatformAdmins } = cds.entities('xyra.master')

  const email = normEmail(emailArg)
  const passwordHash = await hashPassword(password)
  const existing = await SELECT.one.from(PlatformAdmins).where({ email })
  if (existing) {
    await UPDATE(PlatformAdmins).set({ passwordHash, status: 'ACTIVE', ...(name && { name }) }).where({ ID: existing.ID })
    console.log(`Updated platform admin ${email}`)
  } else {
    await INSERT.into(PlatformAdmins).entries({ ID: cds.utils.uuid(), email, name: name || null, passwordHash, status: 'ACTIVE' })
    console.log(`Created platform admin ${email}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
