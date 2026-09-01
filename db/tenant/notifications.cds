namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// One row per notification shown in xyra-web's bell popover (see
// NotificationPopover.js / NotificationService.js). Fields mirror what that
// popover already renders 1:1, so the frontend needed no reshaping once this
// got wired up — just a real fetch instead of its old hardcoded array.
// Raised by lib/notification_engine, called from whichever tenant service
// handler needs to tell that tenant's users something happened (system
// added, user login, system went offline, ...).
entity Notifications : cuid, managed {
    title        : String(150) not null;
    message      : String(500) not null;
    category     : String(20) default 'TASK'; // TASK, REMINDER
    priority     : String(10) default 'MEDIUM'; // HIGH, MEDIUM, LOW
    read         : Boolean default false;
    targetPage   : String(50); // xyra-web route name to navigate to on click
    targetRecord : String(50);
    icon         : String(100) default 'sap-icon://bell';
    iconClass    : String(30) default 'xyraNotifyIconBlue';
}
