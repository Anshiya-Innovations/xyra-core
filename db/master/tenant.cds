namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';

// Tenant registry — platform metadata only, never customer business data.
// ponytail: no back-nav compositions to Domains/Subscriptions/Provisioning yet
// (they'd import Tenants right back, a cycle the compiler can't resolve across files).
// Add them if/when an admin UI needs to $expand from Tenants; the FK association
// from each child entity below is enough to query "domains for tenant X" either way.
@assert.unique: { companyName: [ companyName ] }
entity Tenants : cuid, managed {
    companyName : String(100) not null;
    status      : String(20) default 'PROVISIONING'; // PROVISIONING, ACTIVE, SUSPENDED, TERMINATED
    // Collected at registration, consumed by the Provisioning Service to create the tenant's admin user.
    adminName   : String(100);
    adminEmail  : String(150);
}
