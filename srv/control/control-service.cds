// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/control'
service ControlService {

    type ControlRuleEntry {
        id            : String;
        sortOrder     : Integer;
        sapObject     : String;
        parameterType : String;
        parameter     : String;
        operator      : String;
        expectedValue : String;
    };

    type ControlEntry {
        id             : String;
        code           : String;
        description    : String;
        category       : String;
        controlType    : String;
        severity       : String; // LOW, MEDIUM, HIGH
        frequency      : String;
        cronExpression : String;
        enabled        : Boolean;
        systemIds      : many String; // read-only here — maintained via SystemControlConfigService, not this service
        lastRunAt      : Timestamp;
        lastRunStatus  : String;
        nextRunAt      : Timestamp;
        rules          : many ControlRuleEntry;
        createdAt      : Timestamp;
        createdBy      : String;
        modifiedAt     : Timestamp;
        modifiedBy     : String;
    };

    action listControls(subdomain: String) returns {
        success  : Boolean;
        message  : String;
        controls : many ControlEntry;
    };

    action getControl(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
        control : ControlEntry;
    };

    action createControl(
        subdomain       : String,
        code            : String,
        description     : String,
        category        : String,
        controlType     : String,
        severity        : String, // LOW, MEDIUM, HIGH — defaults to MEDIUM
        frequency       : String,
        cronExpression  : String, // only meaningful when frequency='CRON'
        rules           : many ControlRuleEntry,
        performedBy     : String, // acting user's email, for the audit log
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    // code isn't editable — the row is targeted by id. rules are always a full
    // replace (delete+reinsert), see control-service.js. System mapping is not
    // handled here — see SystemControlConfigService.
    action updateControl(
        subdomain       : String,
        id              : String,
        description     : String,
        category        : String,
        controlType     : String,
        severity        : String,
        frequency       : String,
        cronExpression  : String,
        enabled         : Boolean,
        rules           : many ControlRuleEntry,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action deleteControl(subdomain: String, id: String, performedBy: String, performedByRole: String) returns {
        success : Boolean;
        message : String;
    };

    // Manual trigger — calls lib/control_engine.runControl directly, doesn't
    // wait for the scheduler's next tick.
    action runControlNow(subdomain: String, id: String, performedBy: String, performedByRole: String) returns {
        success         : Boolean;
        message         : String;
        deviationsFound : Integer;
        alertsCreated   : Integer;
    };

    type ControlHistoryEntry {
        controlId          : String;
        controlDescription : String;
        systemId            : String;
        client              : String;
        region              : String;
        platform            : String;
        sector              : String;
        sapObject           : String;
        parameter           : String;
        operator            : String;
        actualValue         : String;
        expectedValue       : String;
        deviationFlag       : Boolean;
        message             : String;
        capturedAt          : Timestamp;
    };

    // Control History Data Review (SDLC 8.1.9) - every value a control run
    // extracted, deviation or not, already captured by control_engine.runControl
    // into ControlRunHistory but never read back until now. Control is a
    // required filter, not just optional - see control-service.js.
    action listControlHistory(
        subdomain : String,
        controlId : String,
        systemId  : String,
        client    : String,
        region    : String,
        platform  : String,
        sector    : String,
        startDate : String,
        endDate   : String
    ) returns {
        success : Boolean;
        message : String;
        history : many ControlHistoryEntry;
    };
}
