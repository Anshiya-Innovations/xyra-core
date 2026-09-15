// One-off migration: adds the 3 new status-mapping columns (see
// db/tenant/jira-settings.cds) to tenant_xyrademo's jirasettings table.
// Purely additive.
const { Client } = require('pg')

const DDL = `
ALTER TABLE xyra_tenant_jirasettings ADD COLUMN IF NOT EXISTS statuscreated VARCHAR(100);
ALTER TABLE xyra_tenant_jirasettings ADD COLUMN IF NOT EXISTS statusinprogress VARCHAR(100);
ALTER TABLE xyra_tenant_jirasettings ADD COLUMN IF NOT EXISTS statusresolved VARCHAR(100);
`

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
      WHERE table_name = 'xyra_tenant_jirasettings' AND column_name IN ('statuscreated', 'statusinprogress', 'statusresolved')
    `)
    console.log('columns present:', check.rows.map((r) => r.column_name))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
