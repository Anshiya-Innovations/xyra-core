namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.AlertItems } from './alerts';
using { xyra.tenant.Users } from './user';
using { xyra.tenant.ReasonCodes } from './reference';

// The two-level review workflow from the SOP (6.3.1.4/6.3.1.7): Reviewer1 = first
// level ("Control Exception Reviewer", our REVIEWER role), Reviewer2 = second level
// ("Manager Exception Reviewer", our ESCALATION_MANAGER role). One row per deviated
// item — merges the source spec's two separate review-data/review-status tables,
// since the latter is a strict 1:1 extension of the former.
entity Reviews : cuid, managed {
    alertItem        : Association to AlertItems not null;

    reviewer1Status  : String(20) default 'NEW'; // NEW, APPROVE, REMEDIATE
    reviewer1Reason  : Association to ReasonCodes;
    reviewer1Comment : String(500);
    reviewer1By      : Association to Users;
    reviewer1At      : Timestamp;

    reviewer2Status  : String(20) default 'NEW';
    reviewer2Reason  : Association to ReasonCodes;
    reviewer2Comment : String(500);
    reviewer2By      : Association to Users;
    reviewer2At      : Timestamp;
}

// Every status change on a Review over time — genuinely 1:many, unlike Reviews
// itself, so it stays a separate table.
entity ReviewStatusHistory : cuid, managed {
    review       : Association to Reviews not null;
    reviewLevel  : Integer not null; // 1 or 2
    status       : String(20) not null;
    reason       : Association to ReasonCodes;
    comment      : String(500);
    changedBy    : Association to Users;
    changedAt    : Timestamp;
}
