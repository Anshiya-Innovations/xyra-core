namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Controls } from './controls';
using { xyra.tenant.Systems } from './sap';

// One incident/ticket raised when a control run finds deviations on a system.
// One Alerts row per (control run x system with >=1 deviation) — a control
// checked against 3 systems where 2 fail produces 2 independently-actionable
// alerts, not one vague one. "Incident" here is deliberately generic — the
// source spec ties this to one specific internal ticketing tool; Xyra should
// integrate with whatever ticketing system a given tenant actually uses, so
// this only stores the external ticket reference, not a tool-specific field set.
entity Alerts : cuid, managed {
    control              : Association to Controls not null;
    system               : Association to Systems not null;
    severity             : String(10); // CRITICAL, MEDIUM — from Controls.critical at run time (see control_engine)
    description          : String(500); // run summary, e.g. "Control XYRA-08 on S4D/100: 2 deviation(s)."
    incidentTicketNumber : String(50);
    incidentStatus       : String(20) default 'NEW'; // NEW, IN_PROCESS, RESOLVED, CLOSED
    incidentCreatedAt    : Timestamp;
    incidentChangedAt    : Timestamp;
    externalRef          : String(100); // e.g. the external ticketing system's own GUID
    notifyEmail          : String(150);
    emailSentStatus      : Boolean default false;
}

// One deviated parameter within an Alert — the actual "expected vs actual" record
// a reviewer approves or remediates. sapObject/parameter/operator are a
// denormalized snapshot of the ControlRule that produced this row, not an
// association to it — a Control's rules get deleted+reinserted on every edit
// (see control-service.js updateControl), so a hard FK here would dangle;
// compliance evidence must survive rule edits unchanged anyway.
entity AlertItems : cuid, managed {
    alert         : Association to Alerts not null;
    sapObject     : String(50)  not null;
    parameter     : String(100) not null;
    operator      : String(20)  not null;
    actualValue   : String(300);
    expectedValue : String(300);
    deviationFlag : Boolean default true;
    severity      : String(10) default 'MEDIUM'; // CRITICAL, MEDIUM — mirrors the parent Alert
    message       : String(500);
    rawData       : LargeString; // JSON — control-specific extra fields (e.g. Tcode, ObjectID)
}
