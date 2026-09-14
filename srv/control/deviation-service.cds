// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/deviation'
service DeviationService {

    type AlertHeaderEntry {
        id                 : String;
        controlId          : String; // Controls.code, e.g. "XYRA-08"
        controlDescription : String;
        systemId           : String;
        client             : String;
        organizationId     : String;
        sector             : String;
        region             : String;
        platform           : String;
        status             : String; // Open, In Progress, Resolved
        severity           : String; // Critical, Medium
        deviationCount     : Integer;
        alertDate          : Timestamp;
        description        : String;
    };

    type AlertItemEntry {
        id            : String;
        sapObject     : String;
        parameter     : String;
        operator      : String;
        expectedValue : String;
        actualValue   : String;
        status        : String; // Critical, Medium (mirrors AlertItems.severity)
        timestamp     : Timestamp;
        message       : String;
    };

    type LogEntry {
        id        : String;
        level     : String;
        message   : String;
        timestamp : Timestamp;
    };

    type KpiSummary {
        totalIncidents  : Integer;
        openItems       : Integer;
        resolvedItems   : Integer;
        auditedControls : Integer;
        complianceRate  : String;
    };

    action listDeviations(
        subdomain      : String,
        organizationId : String,
        sector    : String,
        region    : String,
        platform  : String,
        systemId  : String,
        client    : String,
        controlId : String,
        status    : String,
        startDate : String, // yyyy-MM-dd
        endDate   : String  // yyyy-MM-dd
    ) returns {
        success : Boolean;
        message : String;
        headers : many AlertHeaderEntry;
        kpi     : KpiSummary;
    };

    action getDeviationDetail(subdomain: String, alertId: String) returns {
        success : Boolean;
        message : String;
        header  : AlertHeaderEntry;
        items   : many AlertItemEntry;
    };

    // AlertItem page's "Logs" dialog.
    action getRunLogs(subdomain: String, alertId: String) returns {
        success : Boolean;
        message : String;
        logs    : many LogEntry;
    };

    // AutomationMonitoring page's "Logs" dialog — controlId is Controls.code.
    action getControlLogs(subdomain: String, controlId: String, limit: Integer) returns {
        success : Boolean;
        message : String;
        logs    : many LogEntry;
    };
}
