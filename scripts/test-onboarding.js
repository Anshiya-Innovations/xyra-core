// Exercises the full flow end to end against a running server: register a
// throwaway tenant, provision it for real, then log in as the generated admin.
//
// Usage:
//   cds watch   (in another terminal)
//   node scripts/test-onboarding.js [baseUrl]
//   (env PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD: an admin created with
//    scripts/create-platform-admin.js)

const baseUrl = process.argv[2] || 'http://localhost:4004'
let platformToken = null

async function postJSON(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(platformToken && { Authorization: `Bearer ${platformToken}` }) },
    body: JSON.stringify(body)
  })
  return res.json()
}

async function main() {
  const suffix = Date.now().toString(36)
  const companyName = `Test Co ${suffix}`
  const subdomain = `test${suffix}`
  const adminEmail = `admin-${suffix}@example.com`

  const auth = await postJSON('/api/platform-auth/login', { email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD })
  if (!auth.success) throw new Error(`Platform admin sign-in failed: ${auth.message}`)
  platformToken = auth.token

  console.log(`\n1) Registering "${companyName}" (${subdomain})...`)
  const reg = await postJSON('/api/onboarding/register', {
    companyName, subdomain, adminName: 'Test Admin', adminEmail, plan: 'TRIAL'
  })
  console.log(reg)
  if (!reg.success) throw new Error(`Registration failed: ${reg.message}`)

  console.log(`\n2) Provisioning tenant ${reg.tenantId} (this creates a real tenant database)...`)
  const prov = await postJSON(`/api/provisioning/${reg.tenantId}`, {})
  console.log(prov)
  if (!prov.success) throw new Error(`Provisioning failed: ${prov.message}`)

  console.log('\n3) Logging in as the generated admin...')
  platformToken = null // tenant login is its own session
  const login = await postJSON('/api/auth/login', { subdomain, email: adminEmail, persona: 'ADMIN' })
  console.log(login)
  if (!login.success || !login.token) throw new Error(`Login failed: ${login.message}`)

  console.log(`\n✅ Full flow OK — ${login.name} (role: ${login.role}) can log in to "${subdomain}".`)
  console.log(`   tenantId: ${reg.tenantId}`)
  console.log(`   admin email: ${adminEmail}`)
  console.log('\n   (This tenant and its database were NOT cleaned up — this script leaves them in place for further testing.)')
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
