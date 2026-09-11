namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// Real, persisted, tenant-scoped activity log - replaces the old frontend-only
// mock in webapp/model/auditLogService.js. `managed`'s createdAt is the
// timestamp, same convention as ControlRunHistory/ReviewStatusHistory. Fields
// are denormalized snapshots (objectLabel/systemId/controlId/performedBy as
// plain strings, not Associations) so an entry stays meaningful after the
// Control/System/User it names is later renamed or deleted - same reasoning
// as AlertItems snapshotting its own sapObject/parameter/operator.
entity AuditLogs : cuid, managed {
    action          : String(30)   not null; // LOGIN, VIEW_ALERT, VIEW_REPORT, REVIEW_APPROVE, REVIEW_REJECT, TICKET_CREATED, CONTROL_CREATE, CONTROL_UPDATE, CONTROL_DELETE, CONTROL_RUN, SYSTEM_CREATE, SYSTEM_UPDATE
    module          : String(50)   not null; // Authentication, Deviation Report, Review, Control Management, System Configuration
    objectType      : String(30);            // Control, System, Alert, Review, Ticket, User
    objectId        : String(100);           // code/id of the thing acted on
    objectLabel     : String(200);           // human-readable label for the table, no join needed
    description     : String(1000) not null;
    previousValue   : String(2000);
    newValue        : String(2000);
    result          : String(10)   default 'SUCCESS'; // SUCCESS, FAILURE
    systemId        : String(50);            // denormalized Systems.systemId - filter target
    controlId       : String(50);            // denormalized Controls.code - filter target
    performedBy     : String(100)  not null; // denormalized user email
    performedByRole : String(30);
}
