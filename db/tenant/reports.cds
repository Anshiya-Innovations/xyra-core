namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: minimal skeleton — this domain gets its own ticket to flesh out.
entity Reports : cuid, managed {
    name        : String(100) not null;
    type        : String(30); // e.g. COMPLIANCE, AUDIT_TRAIL
    generatedAt : Timestamp;
}
