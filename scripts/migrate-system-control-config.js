// One-off migration: adds the severity field to Controls (replacing the old
// boolean `critical` flag with a LOW/MEDIUM/HIGH string, see db/tenant/
// controls.cds) and adds run-tracking columns to ControlSystemConfig for the
// new System Control Config page (deactivatedAt/lastRunAt/lastRunStatus/
// runCount). Same "plain pg DDL against tenant_xyrademo, not `cds deploy`"
// pattern as migrate-control-engine-xyrademo.js.
const { Client } = require('pg')

const DDL = `
-- Controls.critical (Boolean) -> Controls.severity (LOW/MEDIUM/HIGH)
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS severity VARCHAR(10) DEFAULT 'MEDIUM';
UPDATE xyra_tenant_controls SET severity = CASE WHEN critical THEN 'HIGH' ELSE 'MEDIUM' END WHERE severity IS NULL OR severity = 'MEDIUM';
ALTER TABLE xyra_tenant_controls DROP COLUMN IF EXISTS critical;

-- ControlSystemConfig: per-mapping lifecycle + run stats for the System Control Config page.
ALTER TABLE xyra_tenant_controlsystemconfig ADD COLUMN IF NOT EXISTS deactivatedat TIMESTAMP;
ALTER TABLE xyra_tenant_controlsystemconfig ADD COLUMN IF NOT EXISTS lastrunat TIMESTAMP;
ALTER TABLE xyra_tenant_controlsystemconfig ADD COLUMN IF NOT EXISTS lastrunstatus VARCHAR(10);
ALTER TABLE xyra_tenant_controlsystemconfig ADD COLUMN IF NOT EXISTS runcount INTEGER DEFAULT 0;
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
      WHERE table_name = 'xyra_tenant_controls' AND column_name IN ('severity', 'critical')
      UNION ALL
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'xyra_tenant_controlsystemconfig' AND column_name IN ('deactivatedat', 'lastrunat', 'lastrunstatus', 'runcount')
    `)
    console.log('Columns present after migration:', check.rows.map((r) => r.column_name))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
