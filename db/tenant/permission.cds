namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: flat permission catalog, no Role<->Permission join table yet —
// add one once real authorization checks need it.
entity Permissions : cuid, managed {
    code        : String(50) not null;
    description : String(200);
}
