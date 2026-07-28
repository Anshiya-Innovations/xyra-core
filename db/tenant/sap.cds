namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: minimal skeleton — connection secrets/auth flow belong to a dedicated SAP Integration ticket.
entity SAPConnections : cuid, managed {
    connectionType : String(20) default 'PARTIALLY_MANAGED'; // PARTIALLY_MANAGED, FULLY_MANAGED
    host           : String(255);
    systemId       : String(10);
    client         : String(3);
    status         : String(20) default 'INACTIVE'; // INACTIVE, ACTIVE, ERROR
}
