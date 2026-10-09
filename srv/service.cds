using { xyra.master as db } from '../db/schema';
using from './master/onboarding-service';
using from './master/platform-admin-service';
using from './auth/auth-service';
using from './admin/user-management-service';
using from './admin/system-config-service';
using from './admin/organization-service';
using from './profile/profile-service';
using from './notifications/notification-service';
using from './control/control-service';
using from './control/deviation-service';
using from './control/system-control-config-service';
using from './review/review-service';
using from './audit/audit-log-service';

@requires: 'platform-admin'
service PlatformService {

    entity Tenants as projection on db.Tenants;

}