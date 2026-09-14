// One-off migration: the SlaSettings columns changed shape (Security/Basis/GxP
// x L1/L2 -> a single universal Reviewer1/Reviewer2/EscalationDelay, per how
// this SaaS's review chain actually works - see db/tenant/sla-settings.cds).
// tenant_xyrademo already has the old-shape table from the first cut of this
// feature (added by add-sla-settings-table-xyrademo.js earlier today, zero
// real usage yet) - safe to just drop and recreate rather than migrate column
// values.
const { Client } = require('pg')
const crypto = require('crypto')

const DDL = `
DROP TABLE IF EXISTS xyra_tenant_slasettings;

CREATE TABLE xyra_tenant_slasettings (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  reviewer1days INTEGER DEFAULT 10,
  reviewer2days INTEGER DEFAULT 5,
  escalationdelaydays INTEGER DEFAULT 3,
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
    await client.query(
      'INSERT INTO xyra_tenant_slasettings (id, reviewer1days, reviewer2days, escalationdelaydays) VALUES ($1, 10, 5, 3)',
      [crypto.randomUUID()]
    )
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
