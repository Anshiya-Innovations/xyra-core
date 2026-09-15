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

    // apiToken is deliberately never returned - write-only, same convention
    // as SystemCredentials' credUserId/credPassword (leaving it blank on an
    // edit keeps whatever's already on file).
    type JiraSettingsEntry {
        enabled          : Boolean;
        siteUrl          : String;
        email            : String;
        projectKey       : String;
        issueType        : String;
        hasToken         : Boolean; // lets the UI show "token on file" without ever exposing it
        statusCreated    : String;
        statusInProgress : String;
        statusResolved   : String;
    };

    action getJiraSettings(subdomain: String, organizationId: String) returns {
        success  : Boolean;
        message  : String;
        settings : JiraSettingsEntry;
    };

    action updateJiraSettings(
        subdomain        : String,
        organizationId   : String,
        enabled          : Boolean,
        siteUrl          : String,
        email            : String,
        apiToken         : String, // optional - blank keeps the token already on file
        projectKey       : String,
        issueType        : String,
        statusCreated    : String,
        statusInProgress : String,
        statusResolved   : String,
        performedBy      : String,
        performedByRole  : String
    ) returns {
        success : Boolean;
        message : String;
    };

    // Lists a project's real status names straight from Jira using whatever
    // site/email/token/project is currently in the settings form (saved or
    // not), so the admin can map statuses before saving. apiToken is
    // optional if organizationId is given and a token is already on file
    // (write-only field - the form won't have it after a save/reload) -
    // falls back to the saved one so re-browsing statuses doesn't force
    // re-pasting the token.
    action getJiraStatusOptions(
        subdomain      : String,
        organizationId : String,
        siteUrl        : String,
        email          : String,
        apiToken       : String,
        projectKey     : String
    ) returns {
        success  : Boolean;
        message  : String;
        statuses : many String;
    };
}
