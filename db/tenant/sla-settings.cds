namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// One row per tenant (singleton, same pattern as DashboardSettings) — business-day
// review SLA deadlines. This app's review chain is exactly 2 levels (Reviewer1,
// then Reviewer2 - final; see review_engine's own header comment), with no
// per-control-type split - one universal SLA pair per tenant, admin-editable
// from Organization Details. Escalation Manager is pure oversight (no decision
// gate of its own - EscalationManager.controller.js), so its only "SLA" is a
// delay past Reviewer2's deadline after which the item is flagged for their
// attention.
entity SlaSettings : cuid, managed {
    reviewer1Days      : Integer default 10;
    reviewer2Days      : Integer default 5;
    escalationDelayDays : Integer default 3; // ponytail: no documented default - starter value, admin should tune

    // Cursor for lib/sla_reminder's weekly job — kept on the settings row itself
    // rather than a second table just to track "did I already remind this tenant".
    lastReminderSentAt : Timestamp;
}
