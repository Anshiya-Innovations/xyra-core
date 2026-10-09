namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Global identity — one row per person, independent of any tenant. The same
// email (company or personal, e.g. Gmail) can belong to several tenants via
// Memberships; the email domain never implies a tenant.
@assert.unique: { email: [ email ] }
entity Users : cuid, managed {
    email  : String(150) not null; // stored lowercase
    name   : String(100);
    status : String(20) default 'ACTIVE'; // ACTIVE, INACTIVE
}

// Explicit user <-> tenant authorization. persona mirrors the user's role code
// in that tenant (ADMIN, REVIEWER, ESCALATION_MANAGER, AUDITOR) and is what the
// session token carries. tenantUserId is the matching xyra.tenant.Users row
// inside the tenant DB (reviews/audit FKs point at it).
@assert.unique: { userTenant: [ user, tenant ] }
entity Memberships : cuid, managed {
    user         : Association to Users not null;
    tenant       : Association to Tenants not null;
    tenantUserId : String(36) not null;
    persona      : String(30) not null;
    status       : String(20) default 'ACTIVE'; // ACTIVE, INACTIVE
}

// xyra-admin operators. Separate from tenant Users on purpose — platform access
// is never granted through a tenant membership.
@assert.unique: { email: [ email ] }
entity PlatformAdmins : cuid, managed {
    email        : String(150) not null; // stored lowercase
    name         : String(100);
    passwordHash : String(200) not null; // lib/auth/password.js format
    status       : String(20) default 'ACTIVE';
}
