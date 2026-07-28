namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Global platform configuration.
@assert.unique: { settingKey: [ settingKey ] }
entity PlatformSettings : cuid, managed {
    settingKey : String(100) not null; // `key` is a reserved CDS keyword
    value      : String(1000);
}

// Feature flags — global by default, optionally scoped to a single tenant.
entity FeatureFlags : cuid, managed {
    flagKey     : String(100) not null;
    description : String(200);
    enabled     : Boolean default false;
    tenant      : Association to Tenants; // null = applies platform-wide
}
