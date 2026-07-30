// ponytail: same "subdomain in the request body" pattern as AuthService — no
// session/JWT layer exists yet (see the architecture discussion this session),
// so every service that needs to know "which tenant" takes it explicitly for now.
@path: '/api/admin'
service AdminService {

    action listUsers(
        subdomain : String
    ) returns array of {
        id        : String;
        name      : String;
        email     : String;
        role      : String;
        status    : String;
        createdAt : String;
    };

    action createUser(
        subdomain : String,
        name      : String,
        email     : String,
        password  : String,
        roleCode  : String
    ) returns {
        success : Boolean;
        message : String;
        userId  : String;
    };

    action removeUser(
        subdomain : String,
        userId    : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action resetPassword(
        subdomain   : String,
        userId      : String,
        newPassword : String
    ) returns {
        success : Boolean;
        message : String;
    };
}
