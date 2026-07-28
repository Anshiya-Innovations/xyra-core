namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: minimal skeleton — the Rule Engine gets its own ticket to define real rule structure.
entity Rules : cuid, managed {
    code    : String(50) not null;
    name    : String(100) not null;
    enabled : Boolean default true;
}
