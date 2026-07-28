@path: '/api/auth'
service AuthService {

    // Resolves the tenant from `subdomain`, then checks email/password against
    // that tenant's own Users table. No session token yet — nothing downstream
    // needs to verify one until there are other authenticated endpoints to protect.
    action login(
        subdomain : String,
        email     : String,
        password  : String
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
