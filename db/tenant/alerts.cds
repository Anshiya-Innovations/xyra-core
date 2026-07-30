namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Rules } from './rules';
using { xyra.tenant.Systems } from './sap';

// One incident/ticket raised when a control run finds deviations on a system.
// "Incident" here is deliberately generic — the source spec ties this to one
// specific internal ticketing tool; Xyra should integrate with whatever
// ticketing system a given tenant actually uses, so this only stores the
// external ticket reference, not a tool-specific field set.
entity Alerts : cuid, managed {
    rule                 : Association to Rules not null;
    system               : Association to Systems not null;
    incidentTicketNumber : String(50);
    incidentStatus       : String(20) default 'NEW'; // NEW, IN_PROCESS, RESOLVED, CLOSED
    incidentCreatedAt    : Timestamp;
    incidentChangedAt    : Timestamp;
    externalRef          : String(100); // e.g. the external ticketing system's own GUID
    notifyEmail          : String(150);
    emailSentStatus      : Boolean default false;
}

// One deviated parameter within an Alert — the actual "expected vs actual" record
// a reviewer approves or remediates.
//
// ponytail: the source spec's equivalent table carries ~40 columns lifted
// straight from SAP's own change-document/user-master/syslog structures (WWID,
// TcodeRecon, FileOffset, CentData, ...) — different subsets are populated
// depending on which control produced the row. Modeling all of them as nullable
// columns on one table
// is exactly the "one wide legacy report table" pattern to not repeat. Core
// deviation fields stay typed; anything control-specific goes in rawData.
entity AlertItems : cuid, managed {
    alert          : Association to Alerts not null;
    parameterId    : String(50) not null;
    parameterValue : String(200);
    expectedValue  : String(200);
    deviationFlag  : Boolean default true;
    message        : String(500);
    rawData        : LargeString; // JSON — control-specific extra fields (e.g. Tcode, ObjectID)
}
