namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Rules } from './rules';
using { xyra.tenant.Systems } from './sap';

// Every value a control run extracts, deviation or not — required for compliance
// evidence per the SOP ("store the history of collected data... and validation
// performed against standards"), not just the deviations that made it into Alerts.
//
// ponytail: this grows one row per (rule × system × parameter) every run, forever —
// a real archival/partitioning story once volume is a problem, not before there's
// evidence of one. `managed`'s createdAt already timestamps each row; no separate
// capturedAt needed.
entity ControlRunHistory : cuid, managed {
    rule           : Association to Rules not null;
    system         : Association to Systems not null;
    parameterId    : String(50) not null;
    parameterValue : String(200);
    expectedValue  : String(200);
    deviationFlag  : Boolean default false;
    message        : String(500);
}
