@requires: 'tenant-user'
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

    action listOrganizations() returns {
        success       : Boolean;
        message       : String;
        organizations : many OrganizationEntry;
    };

    action getOrganization(id: String) returns {
        success      : Boolean;
        message      : String;
        organization : OrganizationEntry;
    };

    action createOrganization(
        orgCode         : String,
        name            : String,
        industry        : String,
        region          : String,
        country         : String,
        primaryContact  : String,
        email           : String,
        phone           : String,
        status          : String
    ) returns {
        success : Boolean;
        message : String;
        id      : String;
    };

    action updateOrganization(
        id              : String,
        name            : String,
        industry        : String,
        region          : String,
        country         : String,
        primaryContact  : String,
        email           : String,
        phone           : String,
        status          : String
    ) returns {
        success : Boolean;
        message : String;
    };

    // Cascades: deletes every System under this org and everything that
    // hangs off each one (control run history/logs, alerts, reviews), plus
    // JiraSettings, then the Organization row itself. Irreversible - the
    // frontend gates this behind a confirm dialog, not this action.
    action deleteOrganization(id: String) returns {
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

    action getJiraSettings(organizationId: String) returns {
        success  : Boolean;
        message  : String;
        settings : JiraSettingsEntry;
    };

    action updateJiraSettings(
        organizationId   : String,
        enabled          : Boolean,
        siteUrl          : String,
        email            : String,
        apiToken         : String, // optional - blank keeps the token already on file
        projectKey       : String,
        issueType        : String,
        statusCreated    : String,
        statusInProgress : String,
        statusResolved   : String
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
