// One-off migration: drops ControlRules.client (db/tenant/controls.cds) from
// tenant_xyrademo. Per-rule client is being removed everywhere - client is
// purely System-based now (control_engine no longer skips a rule based on
// it, see lib/control_engine/index.js). Plain `pg` DDL, same pattern as
// scripts/migrate-add-audit-log.js, for the same reason: `cds deploy`
// operates on the whole model and risks touching unrelated tables.
//
// If there are other already-provisioned tenants beyond xyrademo, run this
// same script again with `database` pointed at each of them.
const { Client } = require('pg')

const DDL = `ALTER TABLE xyra_tenant_controlrules DROP COLUMN IF EXISTS client;`

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
    await client.query(DDL)
    const check = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'xyra_tenant_controlrules'
      ORDER BY ordinal_position
    `)
    console.log('xyra_tenant_controlrules columns after migration:', check.rows.map((r) => r.column_name))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
