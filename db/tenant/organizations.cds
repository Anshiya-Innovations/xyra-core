namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// Tenant -> many Organizations -> each Organization has many Systems (see
// Systems.organization in sap.cds). One company on this SaaS (one tenant) can
// run multiple business units/subsidiaries, each with its own SAP landscape -
// this is the "multiple orgs, each with its own systems" layer between the
// tenant and Systems that Control creation now selects through.
@assert.unique: { orgCode: [ orgCode ] }
entity Organizations : cuid, managed {
    orgCode        : String(20) not null;
    name           : String(150) not null;
    industry       : String(100);
    region         : String(50);
    country        : String(100);
    primaryContact : String(150);
    email          : String(150);
    phone          : String(50);
    status         : String(20) default 'Active'; // Active, Pending Setup, Under Audit Review, Inactive - free text, matches Organization.view.xml's status Select values directly (no BE/UI code mapping, same as industry/region below)
}
