namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Regions, xyra.tenant.Platforms, xyra.tenant.Sectors } from './reference';

// A fixed, well-known set of tiers (SOP: "Development, Quality and Production
// tiers" plus Pre-Quality/Pre-Production). A CDS enum covers this — no need for
// a mutable admin-managed table + CRUD + history for values that essentially
// never change.
type SystemTier : String enum {
    DEVELOPMENT;
    QUALITY;
    PRE_QUALITY;
    PRODUCTION;
    PRE_PRODUCTION;
}

// One SAP (or HANA/Java) system+client being monitored. Replaces the SOP's raw
// (SystemID, Client) string pair used as a foreign key everywhere else — here it's
// a real association instead, so Rules/Alerts/History reference one row instead of
// repeating two loose strings.
@assert.unique: { systemId: [ systemId, client ] }
entity Systems : cuid, managed {
    systemId        : String(3) not null;
    client          : String(3) not null;
    tier            : SystemTier not null;
    systemName      : String(100);
    systemCompName  : String(100);
    hostName        : String(255);
    platform        : Association to Platforms;
    region          : Association to Regions;
    sector          : Association to Sectors;
    version         : String(10);
    logonGroup      : String(50);
    port            : Integer;
    instanceNo      : String(2);
    clientType      : String(20); // ABAP, Java, HANA, Dual
    endpoint        : String(255);
    status          : String(20) default 'ACTIVE'; // ACTIVE, DECOMMISSIONED
    comments        : String(200);
}

// Credentials used to connect and pull data from a System. Kept as its own entity
// (not columns on Systems) so the sensitive field is isolated to one narrow table.
// Either userId+passwordHash (basic auth, for the control-script use case) or
// jwtToken (bearer auth, for the Configuration page's connection setup) —
// neither pair is required since a given system uses one or the other.
// ponytail: passwordHash/jwtToken stored in plain columns for now — swap for a
// real secrets-manager reference (e.g. AWS Secrets Manager ARN) once this needs
// to survive a security review; this is the pre-vault stopgap, not the end state.
entity SystemCredentials : cuid, managed {
    system       : Association to Systems not null;
    userId       : String(50);
    passwordHash : String(300);
    jwtToken     : LargeString;
}
