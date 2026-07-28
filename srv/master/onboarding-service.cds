@path: '/api/onboarding'
service OnboardingService {

    // Registers a new tenant in the Master Layer only (status = PROVISIONING).
    // Does NOT create the tenant database, DNS records, or mark the tenant ACTIVE —
    // that's the future Provisioning Service's job.
    action register(
        companyName : String,
        subdomain   : String,
        adminName   : String,
        adminEmail  : String,
        plan        : String
    ) returns {
        success  : Boolean;
        tenantId : String;
        status   : String;
        message  : String;
    };

}
