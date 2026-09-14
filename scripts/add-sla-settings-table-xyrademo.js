// One-off migration: adds the new xyra_tenant_slasettings table (see
// db/tenant/sla-settings.cds) to tenant_xyrademo, which was provisioned
// before this feature existed. Purely additive - creates one new table and
// seeds its one default row, touches nothing else. Same "plain pg DDL,
// not cds deploy" reasoning as migrate-control-engine-xyrademo.js (cds
// deploy operates on the whole model and risks touching unrelated tables
// that DO have data).
const { Client } = require('pg')
const crypto = require('crypto')

const DDL = `
CREATE TABLE IF NOT EXISTS xyra_tenant_slasettings (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  securitylevel1days INTEGER DEFAULT 10,
  securitylevel2days INTEGER DEFAULT 5,
  basislevel1days INTEGER DEFAULT 15,
  basislevel2days INTEGER DEFAULT 7,
  gxplevel1days INTEGER DEFAULT 10,
  gxplevel2days INTEGER DEFAULT 5,
  lastremindersentat TIMESTAMP
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
    const existing = await client.query('SELECT id FROM xyra_tenant_slasettings LIMIT 1')
    if (!existing.rows.length) {
      await client.query(
        'INSERT INTO xyra_tenant_slasettings (id, securitylevel1days, securitylevel2days, basislevel1days, basislevel2days, gxplevel1days, gxplevel2days) VALUES ($1, 10, 5, 15, 7, 10, 5)',
        [crypto.randomUUID()]
      )
    }
    const check = await client.query('SELECT * FROM xyra_tenant_slasettings')
    console.log('xyra_tenant_slasettings rows:', check.rows)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
