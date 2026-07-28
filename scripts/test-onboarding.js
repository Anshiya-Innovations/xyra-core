// Exercises the full flow end to end against a running server: register a
// throwaway tenant, provision it for real, then log in as the generated admin.
//
// Usage:
//   cds watch   (in another terminal)
//   node scripts/test-onboarding.js [baseUrl]
//
// Prints the admin's one-time temporary password along the way — nothing else
// surfaces it (it's hashed in the DB, never stored in plaintext).

const baseUrl = process.argv[2] || 'http://localhost:4004'

async function postJSON(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.json()
}

async function main() {
  const suffix = Date.now().toString(36)
  const companyName = `Test Co ${suffix}`
  const subdomain = `test${suffix}`
  const adminEmail = `admin-${suffix}@example.com`

  console.log(`\n1) Registering "${companyName}" (${subdomain})...`)
  const reg = await postJSON('/api/onboarding/register', {
    companyName, subdomain, adminName: 'Test Admin', adminEmail, plan: 'TRIAL'
  })
  console.log(reg)
  if (!reg.success) throw new Error(`Registration failed: ${reg.message}`)

  console.log(`\n2) Provisioning tenant ${reg.tenantId} (this creates a real tenant_${subdomain} database)...`)
  const prov = await postJSON(`/api/provisioning/${reg.tenantId}`, {})
  console.log(prov)
  if (!prov.success) throw new Error(`Provisioning failed: ${prov.message}`)

  console.log('\n3) Logging in as the generated admin...')
  const login = await postJSON('/api/auth/login', {
    subdomain, email: adminEmail, password: prov.adminTemporaryPassword
  })
  console.log(login)
  if (!login.success) throw new Error(`Login failed: ${login.message}`)

  console.log(`\n✅ Full flow OK — ${login.name} (role: ${login.role}) can log in to "${subdomain}".`)
  console.log(`   tenantId: ${reg.tenantId}`)
  console.log(`   admin email: ${adminEmail}`)
  console.log(`   admin temp password: ${prov.adminTemporaryPassword}`)
  console.log('\n   (This tenant and its database were NOT cleaned up — this script leaves them in place for further testing.)')
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
