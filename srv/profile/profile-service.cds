@requires: 'tenant-user'
@path: '/api/profile'
service ProfileService {

    action getProfile() returns {
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
        name         : String,
        phone        : String,
        department   : String,
        organization : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action changePassword(
        currentPassword : String,
        newPassword     : String
    ) returns {
        success : Boolean;
        message : String;
    };
}
