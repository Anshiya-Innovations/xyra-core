// One-off migration: adds the new xyra_tenant_organizations table (see
// db/tenant/organizations.cds) and the new xyra_tenant_systems.organization_id
// FK column to tenant_xyrademo, which was provisioned before this feature
// existed. Seeds one "Default Organization" and backfills every existing
// System onto it, so nothing already on file becomes orphaned/unassigned
// once Organization is required.
const { Client } = require('pg')
const crypto = require('crypto')

const DDL = `
CREATE TABLE IF NOT EXISTS xyra_tenant_organizations (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  orgcode VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  industry VARCHAR(100),
  region VARCHAR(50),
  country VARCHAR(100),
  primarycontact VARCHAR(150),
  email VARCHAR(150),
  phone VARCHAR(50),
  status VARCHAR(20) DEFAULT 'Active'
);

ALTER TABLE xyra_tenant_systems ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
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

    let defaultOrgId
    const existing = await client.query("SELECT id FROM xyra_tenant_organizations WHERE orgcode = 'DEFAULT'")
    if (existing.rows.length) {
      defaultOrgId = existing.rows[0].id
    } else {
      defaultOrgId = crypto.randomUUID()
      await client.query(
        'INSERT INTO xyra_tenant_organizations (id, orgcode, name, status) VALUES ($1, $2, $3, $4)',
        [defaultOrgId, 'DEFAULT', 'Default Organization', 'Active']
      )
    }

    const backfill = await client.query(
      'UPDATE xyra_tenant_systems SET organization_id = $1 WHERE organization_id IS NULL',
      [defaultOrgId]
    )
    console.log('Default Organization id:', defaultOrgId, '- backfilled', backfill.rowCount, 'system(s).')

    const check = await client.query('SELECT id, sysid, organization_id FROM xyra_tenant_systems')
    console.log('Systems after backfill:', check.rows)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
