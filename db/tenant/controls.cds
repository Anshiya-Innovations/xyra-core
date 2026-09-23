namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Systems } from './sap';

// A monitored control (e.g. "SAP Security Baseline & Parameter Enforcement").
// One row per control definition — replaces the old `Rules` entity name; a
// control HAS rules (see ControlRules below), it isn't one itself. Scheduling
// state lives directly here (1:1 with a Control) rather than in a separate
// join table — see control_scheduler.
entity Controls : cuid, managed {
    code           : String(20)  not null; // user-typed Control ID, e.g. XYRA-08
    description    : String(500) not null;
    category       : String(20);           // Security, ITGC, Financial, SOX (frontend list, no dedicated field yet)
    controlType    : String(20) default 'SECURITY'; // SECURITY, BASIS, GXP — drives who reviews it (SOP 6.5)
    severity       : String(10) default 'MEDIUM'; // LOW, MEDIUM, HIGH — which severity range this control's deviations fall under (drives Alert/AlertItem severity at run time, see control_engine)
    frequency      : String(20) default 'DAILY';     // DAILY, WEEKLY, MONTHLY, QUARTERLY, ANNUAL, REALTIME, CRON
    cronExpression : String(100); // only meaningful when frequency = CRON
    enabled        : Boolean default true;

    lastRunAt      : Timestamp;
    lastRunStatus  : String(10); // PASS, FAIL, ERROR
    nextRunAt      : Timestamp;  // when control_scheduler should run this next
}

// Which systems a Control is actually active on (a control can be individually
// turned on/off per system) — maintained from the System Control Config page,
// not from the Control's own create/edit form (see srv/control/system-control-
// config-service.js). deactivatedAt/lastRunAt/lastRunStatus/runCount exist for
// that page's activate/deactivate action and its per-mapping details view;
// `managed`'s createdAt already covers "when was this mapping created".
@assert.unique: { controlSystem: [ control, system ] }
entity ControlSystemConfig : cuid, managed {
    control       : Association to Controls not null;
    system        : Association to Systems not null;
    enabled       : Boolean default true;
    deactivatedAt : Timestamp; // set when enabled flips false, cleared on re-activation
    lastRunAt     : Timestamp;
    lastRunStatus : String(10); // PASS, FAIL, ERROR
    runCount      : Integer default 0;
}

// One condition line within a Control (1 Control : N ControlRules, checked in
// sortOrder). Replaces RuleParameters entirely — that entity's fields
// (tier/parameterId/exceptionValue) predated the actual Rule Builder UI and
// didn't match it. Each frontend "preset + custom override" pair (client/
// customClient, parameter/customParameter, expectedValue/customExpectedValue)
// collapses into one column here holding the final resolved value — the
// engine only ever needs that, not which UI path produced it.
entity ControlRules : cuid, managed {
    control       : Association to Controls not null;
    sortOrder     : Integer not null default 1;
    sapObject     : String(50)  not null; // SAP*, DDIC, ..., SDMI_*, or a free-text override
    client        : String(30)  not null; // 'All' | '000'..'300' | resolved override
    parameterType : String(20) default 'GENERAL'; // GENERAL | SETGET | DEFAULT — matches xyra-s4's object_parameters
    parameter     : String(100) not null; // resolved value only
    operator      : String(20)  not null; // EQUALS, NOT_EQUALS, CONTAINS, NOT_CONTAINS, EXISTS, NOT_EXISTS, GT, LT, GTE, LTE
    expectedValue : String(300) not null; // resolved value only
}
