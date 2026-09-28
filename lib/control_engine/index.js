const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')
const { buildBaseUrl, buildAuthHeader } = require('../connection_engine')
const { notify } = require('../notification_engine')
const { createReviewsForAlertItems } = require('../review_engine')
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

// OData V2 string-literal escaping: a single quote inside a literal is
// escaped by doubling it. sapObject/parameter can be free-text Rule Builder
// overrides (see ControlRules.sapObject/.parameter in db/tenant/controls.cds)
// and must be escaped before being interpolated into a $filter expression -
// an unescaped quote would break the filter's own grammar.
function escapeODataLiteral(value) {
  return String(value).replace(/'/g, "''")
}

// Pulls one parameter's current value from a system's SAP endpoint, using a
// real, minimal OData V2 contract: GET .../ZXYRA_CCM_SRV/ObjectParameterSet
// with a $filter of 3 ANDed eq clauses, real {"d":{"results":[...]}} envelope.
// Same connection contract as connection_engine.testConnection (endpoint/
// credentials, sap-client query param, Basic/Bearer auth). xyra-s4 implements
// this exact contract as a faithful local reference; a real customer SAP
// system needs a real ABAP team to build the same contract - see
// docs/Z-ODATA-INTEGRATION-SPEC.md for the full specification handed to them.
// Swapping Systems.endpoint from xyra-s4 to a real system needs no code
// change here - same request shape either way.
async function fetchObjectParameter(system, credentials, { sapObject, parameterType, parameter }) {
  const baseUrl = buildBaseUrl(system)
  if (!baseUrl) return { found: false, value: null, error: 'System has no host name or endpoint configured.' }

  const filter = [
    `ObjectName eq '${escapeODataLiteral(sapObject)}'`,
    `ParameterType eq '${escapeODataLiteral(parameterType || 'GENERAL')}'`,
    `ParameterId eq '${escapeODataLiteral(parameter)}'`
  ].join(' and ')

  const params = new URLSearchParams({
    'sap-client': system.client || '',
    '$filter': filter,
    '$format': 'json'
  })
  const url = `${baseUrl}/sap/opu/odata/sap/ZXYRA_CCM_SRV/ObjectParameterSet?${params.toString()}`
  const headers = buildAuthHeader(credentials)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) return { found: false, value: null, error: `HTTP ${response.status}` }
    const body = await response.json()
    const results = body && body.d && Array.isArray(body.d.results) ? body.d.results : []
    const row = results[0]
    return row ? { found: true, value: row.ParameterValue } : { found: false, value: null }
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

// One full run of one Control: for every enabled target system (or just
// `systemId` when given - the System Control Config page's per-mapping "Run
// Now"), evaluate every rule (in order), always recording a ControlRunHistory
// row (compliance evidence, deviation or not), and raising one Alerts+
// AlertItems+notification per system that had >=1 deviation.
async function runControl(tenantId, databaseName, controlId, systemId) {
  const tenantDb = await getPool(tenantId, databaseName)
  const {
    Controls, ControlRules, ControlSystemConfig, Systems, SystemCredentials,
    ControlRunHistory, Alerts, AlertItems, ControlRunLogs, Reviews
  } = await tenantEntities()

  const tx = tenantDb.tx()
  try {
    const control = await tx.run(SELECT.one.from(Controls).where({ ID: controlId }))
    if (!control) return { success: false, message: `No control on file for id ${controlId}.` }
    if (!control.enabled) return { success: false, message: `Control ${control.code} is disabled.` }

    const now = new Date()
    const rules = await tx.run(SELECT.from(ControlRules).where({ control_ID: controlId }).orderBy('sortOrder'))
    const configWhere = systemId ? { control_ID: controlId, system_ID: systemId, enabled: true } : { control_ID: controlId, enabled: true }
    const configs = await tx.run(SELECT.from(ControlSystemConfig).where(configWhere))

    await tx.run(INSERT.into(ControlRunLogs).entries({
      ID: cds.utils.uuid(), control_ID: controlId, level: 'INFO', message: `Starting run for ${control.code}.`
    }))

    if (!configs.length) {
      const nextRunAt = computeNextRunAt(control.frequency, control.cronExpression, now)
      const message = systemId ? 'This control is not actively mapped to that system.' : 'No enabled systems configured for this control.'
      await tx.run(INSERT.into(ControlRunLogs).entries({
        ID: cds.utils.uuid(), control_ID: controlId, system_ID: systemId || null, level: 'WARNING', message
      }))
      await tx.run(UPDATE(Controls).set({ lastRunAt: now, lastRunStatus: 'ERROR', nextRunAt }).where({ ID: controlId }))
      return { success: false, message }
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

      await tx.run(UPDATE(ControlSystemConfig).set({
        runCount: (config.runCount || 0) + 1,
        lastRunAt: now,
        lastRunStatus: deviations.length ? 'FAIL' : 'PASS'
      }).where({ ID: config.ID }))

      if (deviations.length) {
        const severity = control.severity || 'MEDIUM'
        const description = `Control ${control.code} on ${system.systemId}/${system.client}: ${deviations.length} deviation(s).`
        const alertId = cds.utils.uuid()

        await tx.run(INSERT.into(Alerts).entries({
          ID: alertId, control_ID: controlId, system_ID: system.ID, severity, description,
          incidentStatus: 'NEW', incidentCreatedAt: now
        }))
        const alertItemIds = []
        for (const d of deviations) {
          const alertItemId = cds.utils.uuid()
          alertItemIds.push(alertItemId)
          await tx.run(INSERT.into(AlertItems).entries({
            ID: alertItemId, alert_ID: alertId, sapObject: d.sapObject, parameter: d.parameter,
            operator: d.operator, actualValue: d.actualValue, expectedValue: d.expectedValue,
            deviationFlag: true, severity, message: d.message
          }))
        }
        // Every new deviation enters the Reviewer 1 queue automatically - see
        // lib/review_engine.
        await createReviewsForAlertItems(tx, Reviews, alertItemIds)
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
          category: 'ALERT',
          priority: control.severity || 'MEDIUM',
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

module.exports = { runControl, runDueControls, evaluateOperator, fetchObjectParameter, escapeODataLiteral }
