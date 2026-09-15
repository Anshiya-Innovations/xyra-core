// One-off: full reset of tenant_xyrademo for a from-scratch demo recording.
// Keeps: the single existing Organization (orgcode DEFAULT), Users, Roles,
// Permissions, reference lookups (Regions/Platforms/Sectors/ReasonCodes),
// SlaSettings, DashboardSettings - none of that is "config" being demoed,
// it's login/dropdown plumbing the demo still needs to function.
// Deletes everything else: Systems (+ credentials), Controls (+ rules +
// per-system config), all run/alert/review data, Notifications, AuditLogs,
// and JiraSettings (org keeps existing, but its ticketing config is wiped
// so it's configured fresh on camera). No FK constraints exist at the DB
// level (checked information_schema - CAP doesn't emit them here), so this
// is plain ordered DELETEs, most-dependent tables first for readability.
const { Client } = require('pg')

async function main() {
  const client = new Client({
    host: 'database-1.cwpka6uuuujw.us-east-1.rds.amazonaws.com',
    port: 5432,
    user: 'root',
    password: 'Anshiya2026',
    database: 'tenant_xyrademo',
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()
  try {
    await client.query('BEGIN')

    const tables = [
      'xyra_tenant_reviewstatushistory',
      'xyra_tenant_reviews',
      'xyra_tenant_alertitems',
      'xyra_tenant_alerts',
      'xyra_tenant_controlrunhistory',
      'xyra_tenant_controlrunlogs',
      'xyra_tenant_controlsystemconfig',
      'xyra_tenant_controlrules',
      'xyra_tenant_controls',
      'xyra_tenant_systemcredentials',
      'xyra_tenant_systems',
      'xyra_tenant_jirasettings',
      'xyra_tenant_notifications',
      'xyra_tenant_auditlogs'
    ]
    for (const t of tables) {
      const r = await client.query(`DELETE FROM ${t}`)
      console.log(`${t}: deleted ${r.rowCount} row(s)`)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Wipe failed:', err)
  process.exitCode = 1
})
