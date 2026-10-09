@requires: 'tenant-user'
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

    action listNotifications() returns {
        success       : Boolean;
        message       : String;
        notifications : many NotificationEntry;
    };

    action markAsRead(id: String) returns {
        success : Boolean;
        message : String;
    };

    action clearAll() returns {
        success : Boolean;
        message : String;
    };
}
