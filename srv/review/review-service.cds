// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/review'
service ReviewService {

    type ReviewEntry {
        id                 : String;
        alertItemId        : String;
        alertId            : String;
        controlId          : String;
        controlDescription : String;
        systemId           : String;
        client             : String;
        sapObject          : String;
        parameter          : String;
        operator           : String;
        actualValue        : String;
        expectedValue      : String;
        message            : String;
        severity           : String;
        generatedDate      : Timestamp;

        reviewer1Status  : String;
        reviewer1Comment : String;
        reviewer1ByName  : String;
        reviewer1At      : Timestamp;

        reviewer2Status  : String;
        reviewer2Comment : String;
        reviewer2ByName  : String;
        reviewer2At      : Timestamp;

        ticketNumber    : String;
        ticketLevel     : Integer;
        ticketCreatedAt : Timestamp;
        ticketUrl       : String;
        ticketStatus    : String;  // raw Jira status name, e.g. "In Progress" - empty for STUB tickets
        ticketResolved  : Boolean; // true once Jira reports the issue's statusCategory as 'done'

        slaDeadline   : Timestamp; // null once the review has no active stage clock (terminal)
        daysPending   : Integer;   // calendar days since the current stage's clock started
        isOverdue     : Boolean;
        escalationDue : Boolean;   // Level 2 only: overdue by more than the tenant's escalation delay - flag for Escalation Manager
    };

    action listLevel1Queue(subdomain: String) returns { success: Boolean; message: String; reviews: many ReviewEntry; };
    action listLevel2Queue(subdomain: String) returns { success: Boolean; message: String; reviews: many ReviewEntry; };

    action listLevel1History(subdomain: String) returns { success: Boolean; message: String; reviews: many ReviewEntry; };
    action listLevel2History(subdomain: String) returns { success: Boolean; message: String; reviews: many ReviewEntry; };

    action getReviewDetail(subdomain: String, reviewId: String) returns {
        success : Boolean;
        message : String;
        review  : ReviewEntry;
    };

    // decision: APPROVE | REMEDIATE
    action decideLevel1(subdomain: String, reviewId: String, decision: String, comment: String, actingUserId: String) returns {
        success      : Boolean;
        message      : String;
        ticketNumber : String;
    };

    // decision: APPROVE | REMEDIATE. APPROVE here is final closure - no third
    // review gate exists (SOP-8865 6.3.1.9).
    action decideLevel2(subdomain: String, reviewId: String, decision: String, comment: String, actingUserId: String) returns {
        success      : Boolean;
        message      : String;
        ticketNumber : String;
    };
}
