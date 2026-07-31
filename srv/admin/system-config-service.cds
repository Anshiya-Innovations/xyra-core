// ponytail: same "subdomain in the request body" pattern as the other services —
// no session/JWT layer yet.
@path: '/api/system-config'
service SystemConfigService {

    action getSystemConnection(
        subdomain : String
    ) returns {
        success    : Boolean;
        message    : String;
        hasConnection : Boolean;
        systemName : String;
        hostName   : String;
        systemId   : String;
        client     : String;
        instanceNo : String;
        port       : Integer;
        status     : String;
    };

    action saveSystemConnection(
        subdomain  : String,
        systemName : String,
        hostName   : String,
        systemId   : String,
        client     : String,
        instanceNo : String,
        port       : Integer,
        jwtToken   : String
    ) returns {
        success : Boolean;
        message : String;
    };

    // Basic TCP reachability check against the given host/port — not real SAP
    // protocol/auth validation (that needs actual RFC/HTTP integration, a
    // separate ticket). Tests whatever's currently in the form, not necessarily
    // what's been saved.
    action testSystemConnection(
        subdomain : String,
        hostName  : String,
        port      : Integer
    ) returns {
        success : Boolean;
        message : String;
    };
}
