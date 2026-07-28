namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: minimal skeleton — this domain gets its own ticket to flesh out.
entity Roles : cuid, managed {
    code : String(30) not null; // e.g. ADMIN, USER
    name : String(100) not null;
}
