const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')
const { buildBaseUrl, buildAuthHeader } = require('../connection_engine')
const { notify } = require('../notification_engine')
const { computeNextRunAt } = require('../control_scheduler/cronNext')

// control_engine: runs one Control — pulls the current value of each of its
// Rules from every system it's configured against, compares it to the
// expected value, and records the outcome. One shared module — same
// "engine, not a service" split as connection_engine/notification_engine.
// Wired in from srv/control/control-service.js (manual "Run Now") and
// lib/control_scheduler (the automatic poller).

const FETCH_TIMEOUT_MS = 8000

// Pure and separately testable: whether a rule passed, given its operator and
// the actual/expected values. A missing actual value (null/undefined/'') only
// ever "passes" for EXISTS/NOT_EXISTS — every other operator fails closed,
// since there's nothing to compare (an unreachable system or a parameter that
// was never found can't prove compliance).
function evaluateOperator(operator, actualValue, expectedValue) {
  const hasActual = actualValue !== null && actualValue !== undefined && actualValue !== ''

  if (operator === 'EXISTS') return hasActual
  if (operator === 'NOT_EXISTS') return !hasActual
  if (!hasActual) return false

  const actual = String(actualValue).trim()
  const expected = String(expectedValue).trim()

  switch (operator) {
    case 'EQUALS': return actual === expected
    case 'NOT_EQUALS': return actual !== expected
    case 'CONTAINS': return actual.includes(expected)
    case 'NOT_CONTAINS': return !actual.includes(expected)
    case 'GT':
    case 'LT':
    case 'GTE':
    case 'LTE': {
      const a = Number(actualValue)
      const e = Number(expectedValue)
      if (Number.isNaN(a) || Number.isNaN(e)) return false // non-numeric -> fail closed
      if (operator === 'GT') return a > e
      if (operator === 'LT') return a < e
      if (operator === 'GTE') return a >= e
      return a <= e
    }
    default: return false // unknown operator -> fail closed
  }
}

// Pulls one parameter's current value from a system's fake/real SAP endpoint.
// Same connection contract as connection_engine.testConnection (endpoint/
// credentials, sap-client query param, Basic/Bearer auth) against xyra-s4's
// ObjectParameters lookup. A real customer SAP system would need an
// equivalent custom OData/RFC-exposed service - that's a known integration
// requirement, not solved generically here.
async function fetchObjectParameter(system, credentials, { sapObject, parameterType, parameter }) {
  const baseUrl = buildBaseUrl(system)
  if (!baseUrl) return { found: false, value: null, error: 'System has no host name or endpoint configured.' }

  const params = new URLSearchParams({
    'sap-client': system.client || '',
    objectName: sapObject,
    parameterType: parameterType || 'GENERAL',
    parameterId: parameter
  })
  const url = `${baseUrl}/sap/opu/odata/xyra/CCM_SRV/ObjectParameters?${params.toString()}`
  const headers = buildAuthHeader(credentials)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) return { found: false, value: null, error: `HTTP ${response.status}` }
    const body = await response.json()
    const row = Array.isArray(body.value) ? body.value[0] : null
    return row ? { found: true, value: row.parameter_value } : { found: false, value: null }
  } catch (err) {
    return { found: false, value: null, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

async function loadSystemAndCredentials(tx, Systems, SystemCredentials, systemId) {
  const system = await tx.run(SELECT.one.from(Systems).where({ ID: systemId }))
  if (!system) return { system: null, credentials: null }
  const credentials = await tx.run(SELECT.one.from(SystemCredentials).where({ system_ID: systemId }))
  return { system, credentials }
}

// One full run of one Control: for every enabled target system, evaluate
// every rule (in order), always recording a ControlRunHistory row (compliance
// evidence, deviation or not), and raising one Alerts+AlertItems+notification
// per system that had >=1 deviation.
async function runControl(tenantId, databaseName, controlId) {
  const tenantDb = await getPool(tenantId, databaseName)
  const {
    Controls, ControlRules, ControlSystemConfig, Systems, SystemCredentials,
    ControlRunHistory, Alerts, AlertItems, ControlRunLogs
  } = await tenantEntities()

  const tx = tenantDb.tx()
  try {
    const control = await tx.run(SELECT.one.from(Controls).where({ ID: controlId }))
    if (!control) return { success: false, message: `No control on file for id ${controlId}.` }
    if (!control.enabled) return { success: false, message: `Control ${control.code} is disabled.` }

    const now = new Date()
    const rules = await tx.run(SELECT.from(ControlRules).where({ control_ID: controlId }).orderBy('sortOrder'))
    const configs = await tx.run(SELECT.from(ControlSystemConfig).where({ control_ID: controlId, enabled: true }))

    await tx.run(INSERT.into(ControlRunLogs).entries({
      ID: cds.utils.uuid(), control_ID: controlId, level: 'INFO', message: `Starting run for ${control.code}.`
    }))

    if (!configs.length) {
      const nextRunAt = computeNextRunAt(control.frequency, control.cronExpression, now)
      await tx.run(INSERT.into(ControlRunLogs).entries({
        ID: cds.utils.uuid(), control_ID: controlId, level: 'WARNING', message: 'No enabled systems configured for this control.'
      }))
      await tx.run(UPDATE(Controls).set({ lastRunAt: now, lastRunStatus: 'ERROR', nextRunAt }).where({ ID: controlId }))
      return { success: false, message: 'No enabled systems configured for this Control.' }
    }

    let totalDeviations = 0
    let alertsCreated = 0

    for (const config of configs) {
      const { system, credentials } = await loadSystemAndCredentials(tx, Systems, SystemCredentials, config.system_ID)
      if (!system) {
        await tx.run(INSERT.into(ControlRunLogs).entries({
          ID: cds.utils.uuid(), control_ID: controlId, level: 'ERROR', message: `System ${config.system_ID} not found - skipped.`
        }))
        continue
      }

      const deviations = []
      const logLines = []

      for (const rule of rules) {
        if (rule.client !== 'All' && rule.client !== system.client) {
          logLines.push({ level: 'INFO', message: `Rule ${rule.sortOrder} skipped: client ${rule.client} does not match system client ${system.client}.` })
          continue
        }

        const { found, value, error } = await fetchObjectParameter(system, credentials, {
          sapObject: rule.sapObject, parameterType: rule.parameterType, parameter: rule.parameter
        })

        let actualValue, passed, message
        if (error) {
          // fail-closed: an unreachable/erroring system can't prove compliance
          actualValue = null
          passed = false
          message = `Unable to retrieve value: ${error}`
          logLines.push({ level: 'ERROR', message: `Rule ${rule.sortOrder} (${rule.sapObject}/${rule.parameter}): ${message}` })
        } else {
          actualValue = found ? value : null
          passed = evaluateOperator(rule.operator, actualValue, rule.expectedValue)
          message = passed ? null : `Expected '${rule.expectedValue}', got '${actualValue}'.`
          logLines.push({
            level: passed ? 'INFO' : 'WARNING',
            message: `Rule ${rule.sortOrder} (${rule.sapObject}/${rule.parameter}): ${passed ? 'OK' : 'DEVIATION'} - expected '${rule.expectedValue}', got '${actualValue}'.`
          })
        }

        const deviationFlag = !passed
        await tx.run(INSERT.into(ControlRunHistory).entries({
          ID: cds.utils.uuid(), control_ID: controlId, system_ID: system.ID,
          sapObject: rule.sapObject, parameter: rule.parameter, operator: rule.operator,
          actualValue, expectedValue: rule.expectedValue, deviationFlag, message
        }))

        if (deviationFlag) {
          totalDeviations++
          deviations.push({ sapObject: rule.sapObject, parameter: rule.parameter, operator: rule.operator, actualValue, expectedValue: rule.expectedValue, message })
        }
      }

      if (deviations.length) {
        const severity = control.critical ? 'CRITICAL' : 'MEDIUM'
        const description = `Control ${control.code} on ${system.systemId}/${system.client}: ${deviations.length} deviation(s).`
        const alertId = cds.utils.uuid()

        await tx.run(INSERT.into(Alerts).entries({
          ID: alertId, control_ID: controlId, system_ID: system.ID, severity, description,
          incidentStatus: 'NEW', incidentCreatedAt: now
        }))
        for (const d of deviations) {
          await tx.run(INSERT.into(AlertItems).entries({
            ID: cds.utils.uuid(), alert_ID: alertId, sapObject: d.sapObject, parameter: d.parameter,
            operator: d.operator, actualValue: d.actualValue, expectedValue: d.expectedValue,
            deviationFlag: true, severity, message: d.message
          }))
        }
        for (const line of logLines) {
          await tx.run(INSERT.into(ControlRunLogs).entries({
            ID: cds.utils.uuid(), control_ID: controlId, system_ID: system.ID, alert_ID: alertId, level: line.level, message: line.message
          }))
        }

        alertsCreated++
        // Best-effort - a notification failure shouldn't affect the run result.
        notify(tenantId, databaseName, {
          title: 'Control Execution Deviation',
          message: description,
          category: 'TASK',
          priority: control.critical ? 'HIGH' : 'MEDIUM',
          targetPage: 'DeviationReport',
          targetRecord: alertId,
          icon: 'sap-icon://alert',
          iconClass: 'xyraNotifyIconRed'
        }).catch((err) => console.error('notify(runControl) failed:', err))
      } else {
        for (const line of logLines) {
          await tx.run(INSERT.into(ControlRunLogs).entries({
            ID: cds.utils.uuid(), control_ID: controlId, system_ID: system.ID, level: line.level, message: line.message
          }))
        }
      }
    }

    const nextRunAt = computeNextRunAt(control.frequency, control.cronExpression, now)
    await tx.run(UPDATE(Controls).set({
      lastRunAt: now, lastRunStatus: totalDeviations ? 'FAIL' : 'PASS', nextRunAt
    }).where({ ID: controlId }))

    return { success: true, controlId, systemsChecked: configs.length, deviationsFound: totalDeviations, alertsCreated }
  } finally {
    await tx.commit()
  }
}

// Scheduler entry point: run every enabled Control whose nextRunAt is due.
// Filtering in JS rather than a WHERE with a null-or-timestamp OR shape -
// Controls per tenant is a small dataset, and this sidesteps having to prove
// out another query shape against the pinned @cap-js/postgres version (see
// notification_engine's clearAll for the kind of quirk that's worth avoiding).
async function runDueControls(tenantId, databaseName, now = new Date()) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { Controls } = await tenantEntities()
  const tx = tenantDb.tx()
  let controls
  try {
    controls = await tx.run(SELECT.from(Controls).where({ enabled: true }))
  } finally {
    await tx.commit()
  }

  const due = controls.filter((c) => !c.nextRunAt || new Date(c.nextRunAt) <= now)
  let checked = 0
  for (const control of due) {
    try {
      await runControl(tenantId, databaseName, control.ID)
      checked++
    } catch (err) {
      console.error(`control_engine: run failed for control ${control.ID}`, err)
    }
  }
  return { checked }
}

module.exports = { runControl, runDueControls, evaluateOperator, fetchObjectParameter }
