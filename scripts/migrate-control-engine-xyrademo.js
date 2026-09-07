// One-off migration: replaces the empty Rules/RuleParameters/RuleSystemConfig/
// SchedulerJobs/Alerts/AlertItems/ControlRunHistory tables in tenant_xyrademo
// with the new Controls/ControlRules/ControlSystemConfig/Alerts/AlertItems/
// ControlRunHistory/ControlRunLogs shape (see db/tenant/controls.cds,
// alerts.cds, history.cds, runlogs.cds).
//
// Confirmed via a read-only check before writing this: all 7 affected tables
// have zero rows in tenant_xyrademo — this is a schema replace, not a data
// migration. Not run via `cds deploy` (which operates on the whole model and
// risks touching unrelated tables like Users/Systems that DO have data) -
// plain `pg` DDL instead, same pattern as the two additive migrations already
// done this session.
const { Client } = require('pg')

const DDL = `
-- SchedulerJobs: unreferenced skeleton, folded into Controls.lastRunAt/nextRunAt.
DROP TABLE IF EXISTS xyra_tenant_schedulerjobs;

-- RuleParameters: replaced entirely by ControlRules (different shape - the old
-- tier/parameterId/exceptionValue fields never matched the Rule Builder UI).
DROP TABLE IF EXISTS xyra_tenant_ruleparameters;

-- Rules -> Controls
ALTER TABLE xyra_tenant_rules RENAME TO xyra_tenant_controls;
ALTER TABLE xyra_tenant_controls RENAME COLUMN name TO description;
ALTER TABLE xyra_tenant_controls ALTER COLUMN description TYPE VARCHAR(500);
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS category VARCHAR(20);
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS cronexpression VARCHAR(100);
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS lastrunat TIMESTAMP;
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS lastrunstatus VARCHAR(10);
ALTER TABLE xyra_tenant_controls ADD COLUMN IF NOT EXISTS nextrunat TIMESTAMP;
ALTER TABLE xyra_tenant_controls ALTER COLUMN frequency SET DEFAULT 'DAILY';

-- RuleSystemConfig -> ControlSystemConfig
ALTER TABLE xyra_tenant_rulesystemconfig RENAME TO xyra_tenant_controlsystemconfig;
ALTER TABLE xyra_tenant_controlsystemconfig RENAME COLUMN rule_id TO control_id;

-- ControlRules: fresh table, no prior analog.
CREATE TABLE IF NOT EXISTS xyra_tenant_controlrules (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  control_id VARCHAR(36) NOT NULL,
  sortorder INTEGER NOT NULL DEFAULT 1,
  sapobject VARCHAR(50) NOT NULL,
  client VARCHAR(30) NOT NULL,
  parametertype VARCHAR(20) DEFAULT 'GENERAL',
  parameter VARCHAR(100) NOT NULL,
  operator VARCHAR(20) NOT NULL,
  expectedvalue VARCHAR(300) NOT NULL
);

-- Alerts: rule -> control, + severity/description
ALTER TABLE xyra_tenant_alerts RENAME COLUMN rule_id TO control_id;
ALTER TABLE xyra_tenant_alerts ADD COLUMN IF NOT EXISTS severity VARCHAR(10);
ALTER TABLE xyra_tenant_alerts ADD COLUMN IF NOT EXISTS description VARCHAR(500);

-- AlertItems: parameterId->parameter, parameterValue->actualValue, + sapObject/operator/severity
ALTER TABLE xyra_tenant_alertitems RENAME COLUMN parameterid TO parameter;
ALTER TABLE xyra_tenant_alertitems ALTER COLUMN parameter TYPE VARCHAR(100);
ALTER TABLE xyra_tenant_alertitems RENAME COLUMN parametervalue TO actualvalue;
ALTER TABLE xyra_tenant_alertitems ALTER COLUMN actualvalue TYPE VARCHAR(300);
ALTER TABLE xyra_tenant_alertitems ALTER COLUMN expectedvalue TYPE VARCHAR(300);
ALTER TABLE xyra_tenant_alertitems ADD COLUMN IF NOT EXISTS sapobject VARCHAR(50);
ALTER TABLE xyra_tenant_alertitems ADD COLUMN IF NOT EXISTS operator VARCHAR(20);
ALTER TABLE xyra_tenant_alertitems ADD COLUMN IF NOT EXISTS severity VARCHAR(10) DEFAULT 'MEDIUM';
ALTER TABLE xyra_tenant_alertitems ALTER COLUMN sapobject SET NOT NULL;
ALTER TABLE xyra_tenant_alertitems ALTER COLUMN operator SET NOT NULL;

-- ControlRunHistory: same treatment as AlertItems, + rule->control
ALTER TABLE xyra_tenant_controlrunhistory RENAME COLUMN rule_id TO control_id;
ALTER TABLE xyra_tenant_controlrunhistory RENAME COLUMN parameterid TO parameter;
ALTER TABLE xyra_tenant_controlrunhistory ALTER COLUMN parameter TYPE VARCHAR(100);
ALTER TABLE xyra_tenant_controlrunhistory RENAME COLUMN parametervalue TO actualvalue;
ALTER TABLE xyra_tenant_controlrunhistory ALTER COLUMN actualvalue TYPE VARCHAR(300);
ALTER TABLE xyra_tenant_controlrunhistory ALTER COLUMN expectedvalue TYPE VARCHAR(300);
ALTER TABLE xyra_tenant_controlrunhistory ADD COLUMN IF NOT EXISTS sapobject VARCHAR(50);
ALTER TABLE xyra_tenant_controlrunhistory ADD COLUMN IF NOT EXISTS operator VARCHAR(20);
ALTER TABLE xyra_tenant_controlrunhistory ALTER COLUMN sapobject SET NOT NULL;
ALTER TABLE xyra_tenant_controlrunhistory ALTER COLUMN operator SET NOT NULL;

-- ControlRunLogs: fresh table, no prior analog.
CREATE TABLE IF NOT EXISTS xyra_tenant_controlrunlogs (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP,
  createdby VARCHAR(255),
  modifiedat TIMESTAMP,
  modifiedby VARCHAR(255),
  control_id VARCHAR(36) NOT NULL,
  system_id VARCHAR(36),
  alert_id VARCHAR(36),
  level VARCHAR(10) DEFAULT 'INFO',
  message VARCHAR(500) NOT NULL
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
      WHERE table_schema = 'public' AND table_name IN (
        'xyra_tenant_controls', 'xyra_tenant_controlrules', 'xyra_tenant_controlsystemconfig',
        'xyra_tenant_controlrunlogs', 'xyra_tenant_alerts', 'xyra_tenant_alertitems',
        'xyra_tenant_controlrunhistory'
      )
      ORDER BY table_name
    `)
    console.log('Tables present after migration:', check.rows.map((r) => r.table_name))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
