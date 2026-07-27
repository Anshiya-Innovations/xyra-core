using { xyra as db } from '../db/schema';

service PlatformService {

    entity Tenants as projection on db.Tenants;

}