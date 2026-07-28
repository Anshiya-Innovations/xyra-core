namespace xyra.master;

using { cuid } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Immutable platform audit trail. Association only (not Composition) — must survive tenant deletion.
entity AuditLogs : cuid {
    tenant      : Association to Tenants; // null for platform-level actions not tied to a tenant
    action      : String(50) not null; // e.g. TENANT_CREATED, SUBSCRIPTION_CHANGED
    entityName  : String(100);
    entityKey   : String(36);
    performedBy : String(100);
    performedAt : Timestamp default $now;
    details     : String(2000);
}
