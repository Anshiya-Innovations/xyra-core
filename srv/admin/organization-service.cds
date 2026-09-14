// ponytail: same "subdomain in the request body" pattern as the other services —
// no session/JWT layer yet.
@path: '/api/organization'
service OrganizationService {

    type OrganizationEntry {
        id             : String;
        orgCode        : String;
        name           : String;
        industry       : String;
        region         : String;
        country        : String;
        primaryContact : String;
        email          : String;
        phone          : String;
        status         : String;
        systemCount    : Integer; // how many Systems currently belong to this org
        createdAt      : Timestamp;
    };

    action listOrganizations(subdomain: String) returns {
        success       : Boolean;
        message       : String;
        organizations : many OrganizationEntry;
    };

    action getOrganization(subdomain: String, id: String) returns {
        success      : Boolean;
        message      : String;
        organization : OrganizationEntry;
    };

    action createOrganization(
        subdomain       : String,
        orgCode         : String,
        name            : String,
        industry        : String,
        region          : String,
        country         : String,
        primaryContact  : String,
        email           : String,
        phone           : String,
        status          : String,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    action updateOrganization(
        subdomain       : String,
        id              : String,
        name            : String,
        industry        : String,
        region          : String,
        country         : String,
        primaryContact  : String,
        email           : String,
        phone           : String,
        status          : String,
        performedBy     : String,
        performedByRole : String
    ) returns {
        success : Boolean;
        message : String;
    };

    // Refused (not just discouraged) while any System still points at this
    // org - reassign or remove those first, same defensive stance as other
    // "would orphan real data" deletes in this codebase.
    action deleteOrganization(subdomain: String, id: String, performedBy: String, performedByRole: String) returns {
        success : Boolean;
        message : String;
    };
}
