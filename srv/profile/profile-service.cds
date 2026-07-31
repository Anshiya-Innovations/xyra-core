// ponytail: same "subdomain in the request body" pattern as AuthService/AdminService
// — no session/JWT layer exists yet, so every service takes the caller's identity
// explicitly for now.
@path: '/api/profile'
service ProfileService {

    action getProfile(
        subdomain : String,
        userId    : String
    ) returns {
        success      : Boolean;
        message      : String;
        id           : String;
        name         : String;
        email        : String;
        phone        : String;
        department   : String;
        organization : String;
        role         : String;
        status       : String;
    };

    // Deliberately no email field here — changing the login identifier is a
    // separate, carefully-verified flow (out of scope), not a plain profile edit.
    action updateProfile(
        subdomain    : String,
        userId       : String,
        name         : String,
        phone        : String,
        department   : String,
        organization : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action changePassword(
        subdomain       : String,
        userId          : String,
        currentPassword : String,
        newPassword     : String
    ) returns {
        success : Boolean;
        message : String;
    };
}
