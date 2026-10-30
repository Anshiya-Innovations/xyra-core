@path: '/api/auth'
@(requires: 'any')
service AuthService {

    // Tenant = the hostname the user signed in on (acme.xyra-ccm.com). `subdomain`
    // is honored ONLY when DEV_MODE=true (localhost has no tenant subdomain).
    // Membership + persona are checked against xyra.master.Memberships; on
    // success a signed session token is returned and every other API call
    // derives tenant/user/persona from it.
    //
    // ponytail: email + persona only — nothing proves the caller owns the
    // email yet. Add OTP/SSO verification inside the login handler; the token
    // and everything downstream stay unchanged.
    @(requires: 'any')
    action login(
        email     : String,
        persona   : String,
        subdomain : String
    ) returns {
        success  : Boolean;
        message  : String;
        token    : String;
        tenantId : String;
        userId   : String;
        name     : String;
        email    : String;
        role     : String;
    };

    // Workspaces (tenants) the signed-in user is an active member of.
    @requires: 'tenant-user'
    action listMyTenants() returns {
        success : Boolean;
        message : String;
        tenants : many {
            tenantId    : String;
            companyName : String;
            domain      : String;
            persona     : String;
        };
    };

    // Issues a token for another tenant ONLY if the signed-in user holds an
    // active membership there — the tenantId here is a request, never trusted.
    @requires: 'tenant-user'
    action switchTenant(tenantId : String) returns {
        success  : Boolean;
        message  : String;
        token    : String;
        domain   : String;
        role     : String;
    };

}
