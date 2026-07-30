namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Systems } from './sap';

// A monitored control (e.g. "NetWeaver AS ABAP Standard Users", "SAP HANA
// Security Audit Logging parameters"). One row per control definition,
// independent of which systems it actually runs against (see RuleSystemConfig
// for that).
entity Rules : cuid, managed {
    code        : String(20) not null; // e.g. XYRA-SEC-01, tenant's own control catalog
    name        : String(200) not null;
    controlType : String(20) default 'SECURITY'; // SECURITY, BASIS, GXP — drives who reviews it (SOP 6.5)
    frequency   : String(20) default 'MONTHLY'; // DAILY, WEEKLY, MONTHLY, QUARTERLY, ANNUAL
    critical    : Boolean default false; // feeds the "Critical Vulnerabilities" dashboard filter
    enabled     : Boolean default true;
}

// Expected parameter value for a Rule on a given system tier (Dev/Quality/Prod
// often expect different values for the same control). One row per
// (rule, tier, parameterId) — this is the actual comparison logic a control run
// checks the extracted value against.
//
// ponytail: dropped the source spec's per-ABAP-version columns (4.6x/6.x/7.x
// parameter profiles) — that's SAP-version-specific from a 2016 baseline; add back
// only if a real system on an ancient release actually needs a different expected
// value than its tier's default.
entity RuleParameters : cuid, managed {
    rule           : Association to Rules not null;
    tier           : String(20) not null; // matches Systems.tier
    parameterId    : String(50) not null;
    parameterValue : String(200) not null;
    exceptionValue : String(200); // acceptable alternate value, if any
    description    : String(200);
}

// Which systems a Rule is actually active on (SOP's System Control Configuration —
// a control can be individually turned on/off per system).
@assert.unique: { ruleSystem: [ rule, system ] }
entity RuleSystemConfig : cuid, managed {
    rule    : Association to Rules not null;
    system  : Association to Systems not null;
    enabled : Boolean default true;
}
