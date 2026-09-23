// Maps a Control onto a System — the actual "run this control on that system"
// switch. Split out from ControlService/control-service.cds on purpose: a
// Control's own definition (rules, severity, control type) is a separate
// concern from which systems it's turned on for, and that mapping needs its
// own lifecycle (created/deactivated/reactivated, run history) that doesn't
// belong on the Control record itself. See db/tenant/controls.cds's
// ControlSystemConfig entity.
//
// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/system-control-config'
service SystemControlConfigService {

    type SystemControlConfigEntry {
        id                : String;
        controlId         : String; // Controls.ID
        controlCode       : String;
        controlDescription : String;
        controlSeverity   : String; // LOW, MEDIUM, HIGH
        controlType       : String;
        controlFrequency  : String;
        systemId          : String; // Systems.ID
        systemCode        : String; // Systems.systemId, e.g. MY8
        systemClient      : String;
        enabled           : Boolean;
        createdAt         : Timestamp;
        deactivatedAt     : Timestamp;
        runCount          : Integer;
        lastRunAt         : Timestamp;
        lastRunStatus     : String; // PASS, FAIL, ERROR
    };

    action listSystemControlConfigs(subdomain: String) returns {
        success : Boolean;
        message : String;
        configs : many SystemControlConfigEntry;
    };

    // For the "Add" popup's Control/System dropdowns.
    action listMappableControlsAndSystems(subdomain: String) returns {
        success  : Boolean;
        message  : String;
        controls : many {
            id          : String;
            code        : String;
            description : String;
            severity    : String;
            controlType : String;
            frequency   : String;
        };
        systems : many {
            id     : String;
            sysId  : String;
            client : String;
        };
    };

    action createSystemControlConfig(
        subdomain       : String,
        controlId       : String,
        systemId        : String,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    action setSystemControlConfigStatus(
        subdomain       : String,
        id              : String,
        enabled         : Boolean,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
    };

    // Manual trigger scoped to just this mapping's system - calls
    // lib/control_engine.runControl(controlId, systemId) directly, doesn't
    // wait for the scheduler's next tick. See ControlService.runControlNow
    // for the "run on every mapped system" version.
    action runSystemControlConfigNow(
        subdomain       : String,
        id              : String,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success         : Boolean;
        message         : String;
        deviationsFound : Integer;
        alertsCreated   : Integer;
    };

    type RunLogEntry {
        timestamp : Timestamp;
        level     : String;
        message   : String;
    };

    action getSystemControlConfigDetail(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
        detail  : SystemControlConfigEntry;
        logs    : many RunLogEntry;
    };
}
