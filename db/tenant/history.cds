namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Controls } from './controls';
using { xyra.tenant.Systems } from './sap';

// Every value a control run extracts, deviation or not — required for compliance
// evidence per the SOP ("store the history of collected data... and validation
// performed against standards"), not just the deviations that made it into Alerts.
// sapObject/parameter/operator are a denormalized snapshot, same reasoning as
// AlertItems (see alerts.cds).
//
// ponytail: this grows one row per (control x system x rule) every run, forever —
// a real archival/partitioning story once volume is a problem, not before there's
// evidence of one. `managed`'s createdAt already timestamps each row; no separate
// capturedAt needed.
entity ControlRunHistory : cuid, managed {
    control       : Association to Controls not null;
    system        : Association to Systems not null;
    sapObject     : String(50)  not null;
    parameter     : String(100) not null;
    operator      : String(20)  not null;
    actualValue   : String(300);
    expectedValue : String(300);
    deviationFlag : Boolean default false;
    message       : String(500);
}
