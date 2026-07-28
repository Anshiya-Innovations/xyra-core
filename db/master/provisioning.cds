namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Tracks a tenant's provisioning job (this doubles as "ProvisioningJob" — one row
// per tenant, re-used across retries rather than one row per attempt).
entity Provisioning : cuid, managed {
    tenant       : Association to Tenants not null;
    status       : String(20) default 'PENDING'; // PENDING, RUNNING, FAILED, COMPLETED
    currentStep  : String(30); // CREATE_DATABASE, DEPLOY_SCHEMA, SEED_DATA, CREATE_ADMIN, CREATE_DNS, UPDATE_MASTER, COMPLETED
    databaseName : String(100);
    databaseHost : String(255);
    databasePort : Integer;
    startedAt    : Timestamp;
    completedAt  : Timestamp;
    errorMessage : String(500);
}
