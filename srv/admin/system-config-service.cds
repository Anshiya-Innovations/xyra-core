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
        endpoint   : String;
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
        instanceNo : String,
        endpoint   : String, // full base URL, e.g. http://localhost:8000 — see connection_engine
        credUserId : String, // Basic Auth user; leave both cred fields empty to skip storing credentials
        credPassword : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    // sysId isn't editable (Configuration's edit dialog disables that field) —
    // the row is targeted by id, everything else can change. credUserId /
    // credPassword are only written when non-empty, so leaving them blank on
    // an edit keeps whatever credentials are already on file.
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
        instanceNo : String,
        endpoint   : String,
        credUserId : String,
        credPassword : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action deleteSystem(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
    };

    // Reaches the system's authenticated ping endpoint with the credentials
    // on file — see lib/connection_engine. Doesn't fail the request on a
    // rejected/unreachable system, that's a normal outcome to report back.
    action testSystemConnection(subdomain: String, id: String) returns {
        success    : Boolean;
        message    : String;
        statusCode : Integer;
        latencyMs  : Integer;
    };
}
