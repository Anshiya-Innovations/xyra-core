namespace xyra;

using { cuid, managed } from '@sap/cds/common';

entity Tenants : cuid, managed {

    companyName : String(100);
    subdomain   : String(100);
    status      : String(30);

}