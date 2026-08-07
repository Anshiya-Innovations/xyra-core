// ponytail: same "subdomain in the request body" pattern as the other services —
// no session/JWT layer yet.
@path: '/api/system-config'
service SystemConfigService {

    type SystemEntry {
        id         : String;
        sysId      : String;
        client     : String;
        sysType    : String;
        hostName   : String;
        sysDetails : String;
        sector     : String;
        platform   : String;
        region     : String;
        clientType : String;
        sysVersion : String;
        logonGroup : String;
        portNumber : Integer;
        instanceNo : String;
        status     : String;
    };

    action listSystems(subdomain: String) returns {
        success : Boolean;
        message : String;
        systems : many SystemEntry;
    };

    action createSystem(
        subdomain  : String,
        sysId      : String,
        client     : String,
        sysType    : String,
        hostName   : String,
        sysDetails : String,
        sector     : String,
        platform   : String,
        region     : String,
        clientType : String,
        sysVersion : String,
        logonGroup : String,
        portNumber : Integer,
        instanceNo : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    // sysId isn't editable (Configuration's edit dialog disables that field) —
    // the row is targeted by id, everything else can change.
    action updateSystem(
        subdomain  : String,
        id         : String,
        client     : String,
        sysType    : String,
        hostName   : String,
        sysDetails : String,
        sector     : String,
        platform   : String,
        region     : String,
        clientType : String,
        sysVersion : String,
        logonGroup : String,
        portNumber : Integer,
        instanceNo : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action deleteSystem(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
    };
}
