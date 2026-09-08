namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.AlertItems } from './alerts';
using { xyra.tenant.Users } from './user';
using { xyra.tenant.ReasonCodes } from './reference';

// The two-level review workflow per SOP-8865 6.3.1: Reviewer1 = first level
// ("Control Exception Reviewer"), Reviewer2 = second and final level
// ("Manager Exception Reviewer") - both our REVIEWER role, different user
// accounts, not different roles (see lib/provisioning/seed.js). Reject at
// either level tickets and ends the chain (6.3.1.5/6.3.1.8); approve at level
// 2 is final closure (6.3.1.9) - the SOP has no third review gate. One row
// per deviated item (AlertItems) - merges what would otherwise be two
// separate review-data/review-status tables, since level 2 is a strict 1:1
// extension of level 1.
entity Reviews : cuid, managed {
    alertItem        : Association to AlertItems not null;

    reviewer1Status  : String(20) default 'NEW'; // NEW, APPROVE, REMEDIATE
    reviewer1Reason  : Association to ReasonCodes;
    reviewer1Comment : String(500);
    reviewer1By      : Association to Users;
    reviewer1At      : Timestamp;

    reviewer2Status  : String(20) default 'NEW'; // NEW, APPROVE, REMEDIATE
    reviewer2Reason  : Association to ReasonCodes;
    reviewer2Comment : String(500);
    reviewer2By      : Association to Users;
    reviewer2At      : Timestamp;

    // Only one level will ever set these - REMEDIATE ends the chain, so
    // exactly one of reviewer1/reviewer2 *Status can be REMEDIATE per Review.
    // Item-granular and live here, not on Alerts - Alerts.incidentTicketNumber
    // is one-per-Alert, but one Alert fans out into many AlertItems/Reviews
    // that can each be independently rejected; reusing it would collide the
    // moment two items under one Alert are rejected separately.
    //
    // ponytail: ticketNumber/ticketSystem are a local placeholder, not a real
    // ticketing integration - see lib/review_engine's generateTicketNumber().
    // Swap that one function for a real API call when a real system (e.g.
    // ServiceNow) is wired in; nothing else here changes.
    ticketNumber    : String(50);
    ticketLevel     : Integer;      // 1 or 2 - which level's REMEDIATE created it
    ticketCreatedAt : Timestamp;
    ticketSystem    : String(50) default 'STUB';
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
