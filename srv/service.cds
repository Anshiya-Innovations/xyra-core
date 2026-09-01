using { xyra.master as db } from '../db/schema';
using from './master/onboarding-service';
using from './auth/auth-service';
using from './admin/user-management-service';
using from './admin/system-config-service';
using from './profile/profile-service';
using from './notifications/notification-service';

service PlatformService {

    entity Tenants as projection on db.Tenants;

}