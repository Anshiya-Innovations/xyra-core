using { xyra.master as db } from '../db/schema';
using from './master/onboarding-service';
using from './auth/auth-service';
using from './admin/user-management-service';

service PlatformService {

    entity Tenants as projection on db.Tenants;

}