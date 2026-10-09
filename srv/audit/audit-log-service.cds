@requires: 'tenant-user'
@path: '/api/audit-log'
service AuditLogService {

    type AuditLogEntry {
        id              : String;
        createdAt       : Timestamp;
        action          : String;
        module          : String;
        objectType      : String;
        objectId        : String;
        objectLabel     : String;
        description     : String;
        previousValue   : String;
        newValue        : String;
        result          : String;
        systemId        : String;
        controlId       : String;
        performedBy     : String;
        performedByRole : String;
    };

    // Fire-and-forget from the frontend for actions that have no backend
    // write to piggyback a tx onto (viewing an alert/report). Every other
    // action is logged server-side, inside the same tx as the real write —
    // see lib/audit/index.js.
    action logEvent(
        action          : String,
        module          : String,
        objectType      : String,
        objectId        : String,
        objectLabel     : String,
        description     : String,
        previousValue   : String,
        newValue        : String,
        result          : String,
        systemId        : String,
        controlId       : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action listAuditLogs() returns {
        success : Boolean;
        message : String;
        logs    : many AuditLogEntry;
    };
}
