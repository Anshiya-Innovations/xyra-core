namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';
using { xyra.tenant.Roles } from './role';

@assert.unique: { email: [ email ] }
entity Users : cuid, managed {
    name         : String(100) not null;
    email        : String(150) not null;
    // "scrypt:<saltHex>:<hashHex>" — see lib/auth/password.js. No longer checked
    // during login (AuthService.login is email-only pending SSO integration);
    // kept nullable/around for the Profile change-password feature and as a
    // fallback auth path for whenever SSO isn't the login route.
    passwordHash : String(200);
    role         : Association to Roles;
    status       : String(20) default 'ACTIVE'; // ACTIVE, INACTIVE
    phone        : String(20);
    department   : String(100);
    organization : String(100);
}
