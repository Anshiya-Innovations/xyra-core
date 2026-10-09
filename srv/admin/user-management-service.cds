@requires: 'ADMIN'
@path: '/api/admin'
service AdminService {

    action listUsers() returns array of {
        id        : String;
        name      : String;
        email     : String;
        organization : String;
        role      : String;
        status    : String;
        createdAt : String;
    };

    action createUser(
        name      : String,
        email     : String,
        password  : String,
        roleCode   : String,
        organization : String
    ) returns {
        success : Boolean;
        message : String;
        userId  : String;
    };

    action removeUser(
        userId    : String
    ) returns {
        success : Boolean;
        message : String;
    };

    action resetPassword(
        userId      : String,
        newPassword : String
    ) returns {
        success : Boolean;
        message : String;
    };
}
