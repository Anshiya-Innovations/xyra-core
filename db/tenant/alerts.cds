namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Rules } from './rules';

// ponytail: minimal skeleton — this domain gets its own ticket to flesh out.
entity Alerts : cuid, managed {
    rule     : Association to Rules;
    title    : String(200) not null;
    severity : String(20) default 'MEDIUM'; // LOW, MEDIUM, HIGH, CRITICAL
    status   : String(20) default 'OPEN'; // OPEN, CLOSED
}
