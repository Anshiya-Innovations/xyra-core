namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Roles } from './role';

// ponytail: minimal skeleton — this domain gets its own ticket to flesh out.
@assert.unique: { email: [ email ] }
entity Users : cuid, managed {
    name         : String(100) not null;
    email        : String(150) not null;
    passwordHash : String(200); // "scrypt:<saltHex>:<hashHex>" — see lib/auth/password.js
    role         : Association to Roles;
    status       : String(20) default 'ACTIVE'; // ACTIVE, INACTIVE
}
