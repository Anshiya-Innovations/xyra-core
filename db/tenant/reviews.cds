namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Alerts } from './alerts';

// ponytail: minimal skeleton — this domain gets its own ticket to flesh out.
entity Reviews : cuid, managed {
    alert      : Association to Alerts;
    status     : String(20) default 'PENDING'; // PENDING, APPROVED, REJECTED
    reviewedBy : String(150);
}
