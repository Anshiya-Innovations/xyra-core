namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Organizations } from './organizations';

// One row per Organization (optional - a rejected deviation just gets the
// local STUB ticket number when this doesn't exist or isn't enabled). Kept
// as its own entity, not columns on Organizations, so the API token is
// isolated to one narrow table - same reasoning as SystemCredentials being
// split out from Systems (see sap.cds).
//
// ponytail: apiToken stored in a plain column for now - same pre-vault
// stopgap as SystemCredentials.passwordHash, not a real secrets manager.
@assert.unique: { organization: [ organization ] }
entity JiraSettings : cuid, managed {
    organization : Association to Organizations not null;
    enabled      : Boolean default false;
    siteUrl      : String(255);  // e.g. https://yourcompany.atlassian.net
    email        : String(150);  // Atlassian account email (Basic Auth, paired with apiToken)
    apiToken     : LargeString;
    projectKey   : String(20);   // Jira project/space key, e.g. "XS"
    issueType    : String(50) default 'Task';

    // Every Jira board names its own statuses - these map the 3 stages
    // jiraSync/review_engine actually care about onto whatever this board
    // really calls them (raw status name, e.g. "To Do"/"In Review"/"Done").
    // Blank until the admin configures them; jiraSync falls back to Jira's
    // built-in statusCategory ('new'/'indeterminate'/'done') when unmapped,
    // so ticket sync still works before this step is done.
    statusCreated    : String(100);
    statusInProgress : String(100);
    statusResolved   : String(100);
}
