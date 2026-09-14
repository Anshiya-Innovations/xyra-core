// One-off: wipes all control-EXECUTION data in tenant_xyrademo so the user
// can run controls fresh and test - Controls/ControlRules/Systems/
// Organizations/Users are untouched, only what a control RUN produces.
// Delete order respects FK dependencies (child rows before parents):
// ReviewStatusHistory -> Reviews -> AlertItems -> Alerts, then the two
// independent run-history/log tables. Notifications intentionally left
// alone (user's call). Controls.lastRunAt/lastRunStatus/nextRunAt reset to
// NULL so Control Management shows a clean "Never Run" state.
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
      'xyra_tenant_controlrunlogs'
    ]
    for (const t of tables) {
      const r = await client.query(`DELETE FROM ${t}`)
      console.log(`${t}: deleted ${r.rowCount} row(s)`)
    }

    const r2 = await client.query(
      'UPDATE xyra_tenant_controls SET lastrunat = NULL, lastrunstatus = NULL, nextrunat = NULL'
    )
    console.log(`xyra_tenant_controls: reset run-status on ${r2.rowCount} row(s)`)

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
