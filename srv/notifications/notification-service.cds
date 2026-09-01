// ponytail: same "subdomain in the request body" pattern as the other
// services — no session/JWT layer yet.
@path: '/api/notifications'
service NotificationService {

    type NotificationEntry {
        id           : String;
        title        : String;
        message      : String;
        category     : String;
        priority     : String;
        read         : Boolean;
        targetPage   : String;
        targetRecord : String;
        icon         : String;
        iconClass    : String;
        createdAt    : Timestamp;
    };

    action listNotifications(subdomain: String) returns {
        success       : Boolean;
        message       : String;
        notifications : many NotificationEntry;
    };

    action markAsRead(subdomain: String, id: String) returns {
        success : Boolean;
        message : String;
    };

    action clearAll(subdomain: String) returns {
        success : Boolean;
        message : String;
    };
}
