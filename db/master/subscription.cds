namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Plan catalog — shared reference data, not owned by any single tenant.
@assert.unique: { code: [ code ] }
entity SubscriptionPlans : cuid, managed {
    code         : String(30) not null;
    name         : String(100) not null;
    billingCycle : String(20) default 'MONTHLY'; // MONTHLY, YEARLY
    price        : Decimal(10, 2);
    maxUsers     : Integer;
}

// A tenant's active subscription to a plan.
entity Subscriptions : cuid, managed {
    tenant    : Association to Tenants not null;
    plan      : Association to SubscriptionPlans not null;
    status    : String(20) default 'TRIAL'; // TRIAL, ACTIVE, EXPIRED, CANCELLED
    startDate : Date;
    endDate   : Date;
}
