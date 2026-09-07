// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/control'
service ControlService {

    type ControlRuleEntry {
        id            : String;
        sortOrder     : Integer;
        sapObject     : String;
        client        : String;
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
        frequency      : String;
        cronExpression : String;
        critical       : Boolean;
        enabled        : Boolean;
        systemIds      : many String;
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
        subdomain      : String,
        code           : String,
        description    : String,
        category       : String,
        controlType    : String,
        frequency      : String,
        cronExpression : String, // only meaningful when frequency='CRON'
        critical       : Boolean,
        systemIds      : many String,
        rules          : many ControlRuleEntry
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    // code isn't editable — the row is targeted by id. rules/systemIds are
    // always a full replace (delete+reinsert), see control-service.js.
    action updateControl(
        subdomain      : String,
        id             : String,
        description    : String,
        category       : String,
        controlType    : String,
        frequency      : String,
        cronExpression : String,
        critical       : Boolean,
        enabled        : Boolean,
        systemIds      : many String,
        rules          : many ControlRuleEntry
    ) returns {
        success : Boolean;
        message : String;
    };

    action deleteControl(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
    };

    // Manual trigger — calls lib/control_engine.runControl directly, doesn't
    // wait for the scheduler's next tick.
    action runControlNow(subdomain: String, id: String) returns {
        success         : Boolean;
        message         : String;
        deviationsFound : Integer;
        alertsCreated   : Integer;
    };
}
