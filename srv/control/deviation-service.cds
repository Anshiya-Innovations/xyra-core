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

    // One rule on one system, aggregated over its whole ControlRunHistory.
    type RuleCheckStat {
        controlId          : String; // Controls.code (or recovered code if the control was deleted)
        controlDescription : String;
        controlSeverity    : String; // LOW, MEDIUM, HIGH ('' if the control was deleted)
        controlExists      : Boolean;
        systemId           : String;
        client             : String;
        systemExists       : Boolean;
        sapObject          : String;
        parameter          : String;
        operator           : String;
        expectedValue      : String; // from the latest check
        lastActualValue    : String;
        lastPassed         : Boolean;
        lastUnreachable    : Boolean; // latest check couldn't read the value at all
        lastMessage        : String;
        lastCheckedAt      : Timestamp;
        checkCount         : Integer;
        failCount          : Integer;
    };

    // AI Insights page: the raw material for compliance recommendations -
    // the score's numerator/denominator plus a per-rule breakdown, so the
    // page can say exactly which checks are dragging the score down.
    action getComplianceInsights(subdomain: String) returns {
        success      : Boolean;
        message      : String;
        totalChecks  : Integer;
        passedChecks : Integer;
        rules        : many RuleCheckStat;
    };

    // AutomationMonitoring page's "Logs" dialog — controlId is Controls.code.
    action getControlLogs(subdomain: String, controlId: String, limit: Integer) returns {
        success : Boolean;
        message : String;
        logs    : many LogEntry;
    };
}
