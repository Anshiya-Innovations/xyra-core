@path: '/api/auth'
service AuthService {

    // Email-only login, pending SSO integration — resolves the tenant from
    // `subdomain`, then checks whether an active user with that email exists
    // in that tenant's own Users table. No password: this is an intentional,
    // temporary trust boundary until the SSO button replaces this form
    // entirely. No session token yet — nothing downstream needs to verify one
    // until there are other authenticated endpoints to protect.
    action login(
        subdomain : String,
        email     : String
    ) returns {
        success  : Boolean;
        message  : String;
        tenantId : String;
        userId   : String;
        name     : String;
        email    : String;
        role     : String;
    };

}
