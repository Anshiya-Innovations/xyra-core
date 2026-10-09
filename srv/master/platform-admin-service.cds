// Global (platform) admin API for xyra-admin — reads/writes the Master Layer
// (xyra_master) only, never a tenant database. Every route under this path is
// gated by a platform-admin session token (server.js), never a tenant token.
@requires: 'platform-admin'
@path: '/api/platform'
service PlatformAdminService {

    type TenantEntry {
        id                 : String;
        companyName        : String;
        status             : String; // PROVISIONING, ACTIVE, SUSPENDED, TERMINATED
        adminName          : String;
        adminEmail         : String;
        domain             : String;
        planCode           : String;
        planName           : String;
        subscriptionStatus : String;
        jobStatus          : String; // PENDING, RUNNING, FAILED, COMPLETED
        currentStep        : String;
        errorMessage       : String;
        databaseName       : String;
        createdAt          : Timestamp;
        completedAt        : Timestamp;
    };

    type PlanEntry {
        id           : String;
        code         : String;
        name         : String;
        billingCycle : String;
        price        : Decimal(10, 2);
        maxUsers     : Integer;
    };

    type AuditEntry {
        id          : String;
        tenantId    : String;
        companyName : String;
        action      : String;
        performedBy : String;
        performedAt : Timestamp;
        details     : String;
    };

    action listTenants() returns {
        success : Boolean;
        message : String;
        tenants : many TenantEntry;
    };

    // ACTIVE <-> SUSPENDED only. Suspended tenants fail tenant resolution, so
    // their users can't log in and the scheduler skips them.
    action setTenantStatus(tenantId: String, status: String) returns {
        success : Boolean;
        message : String;
    };

    action listPlans() returns {
        success : Boolean;
        message : String;
        plans   : many PlanEntry;
    };

    action listAuditLogs() returns {
        success : Boolean;
        message : String;
        logs    : many AuditEntry;
    };


    // TenantPoolManager counters (JSON) — hit/miss/create/evict, connect latency.
    action getPoolStats() returns {
        success : Boolean;
        message : String;
        stats   : LargeString;
    };

}
