// One-off migration: adds the new AuditLogs table (db/tenant/audit.cds) to
// tenant_xyrademo. lib/provisioning/capDeploy.js's cds.deploy(...) only runs
// for brand-new tenants at onboarding - it won't retroactively add this table
// to a tenant provisioned before this change. Plain `pg` DDL, same pattern as
// scripts/migrate-control-engine-xyrademo.js, used there specifically because
// `cds deploy` operates on the whole model and risks touching unrelated
// tables that already hold data - CREATE TABLE IF NOT EXISTS here is
// non-destructive by construction, no existing table is touched.
//
// If there are other already-provisioned tenants beyond xyrademo, run this
// same script again with `database` pointed at each of them.
const { Client } = require('pg')

const DDL = `
CREATE TABLE IF NOT EXISTS xyra_tenant_auditlogs (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  action VARCHAR(30) NOT NULL,
  module VARCHAR(50) NOT NULL,
  objecttype VARCHAR(30),
  objectid VARCHAR(100),
  objectlabel VARCHAR(200),
  description VARCHAR(1000) NOT NULL,
  previousvalue VARCHAR(2000),
  newvalue VARCHAR(2000),
  result VARCHAR(10) DEFAULT 'SUCCESS',
  systemid VARCHAR(50),
  controlid VARCHAR(50),
  performedby VARCHAR(100) NOT NULL,
  performedbyrole VARCHAR(30)
);
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
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'xyra_tenant_auditlogs'
    `)
    console.log('Table present after migration:', check.rows.map((r) => r.table_name))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
