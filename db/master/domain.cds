namespace xyra.master;

using { cuid, managed } from '@sap/cds/common';
using { xyra.master.Tenants } from './tenant';

// Subdomain/custom-domain mapping the Tenant Resolver uses to identify a tenant from the Host header.
@assert.unique: { domainName: [ domainName ] }
entity Domains : cuid, managed {
    tenant     : Association to Tenants not null;
    domainName : String(150) not null; // e.g. acme.xyra-ccm.com, or a customer-owned custom domain
    isCustom   : Boolean default false; // false = platform subdomain, true = customer's own domain
    isPrimary  : Boolean default false;
    verified   : Boolean default false;
}
