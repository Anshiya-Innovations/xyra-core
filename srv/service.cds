using { xyra.master as db } from '../db/schema';
using from './master/onboarding-service';
using from './auth/auth-service';

service PlatformService {

    entity Tenants as projection on db.Tenants;

}