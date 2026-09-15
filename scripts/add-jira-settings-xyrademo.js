// One-off migration: adds the new xyra_tenant_jirasettings table (see
// db/tenant/jira-settings.cds) and the new xyra_tenant_reviews.ticketurl
// column to tenant_xyrademo, which was provisioned before this feature
// existed. Purely additive.
const { Client } = require('pg')

const DDL = `
CREATE TABLE IF NOT EXISTS xyra_tenant_jirasettings (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  organization_id VARCHAR(36) NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT FALSE,
  siteurl VARCHAR(255),
  email VARCHAR(150),
  apitoken TEXT,
  projectkey VARCHAR(20),
  issuetype VARCHAR(50) DEFAULT 'Task'
);

ALTER TABLE xyra_tenant_reviews ADD COLUMN IF NOT EXISTS ticketurl VARCHAR(500);
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
      WHERE table_schema = 'public' AND table_name = 'xyra_tenant_jirasettings'
    `)
    console.log('jirasettings table present:', check.rows.length > 0)
    const col = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'xyra_tenant_reviews' AND column_name = 'ticketurl'
    `)
    console.log('reviews.ticketurl column present:', col.rows.length > 0)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
