const cds = require('@sap/cds')
const { fullDomainFor, logPlatformAudit } = require('../../lib/platform')

const SUBDOMAIN_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

module.exports = function (srv) {
  const { Tenants, Domains, Subscriptions, SubscriptionPlans, Provisioning } = cds.entities('xyra.master')

  srv.on('register', async (req) => {
    const fail = (message) => ({ success: false, tenantId: null, status: null, message })

    const companyName = (req.data.companyName || '').trim()
    const subdomain = (req.data.subdomain || '').trim()
    const adminName = (req.data.adminName || '').trim()
    const adminEmail = (req.data.adminEmail || '').trim()
    const planCode = (req.data.plan || 'TRIAL').trim().toUpperCase()

    if (!companyName) return fail('Company name is required.')
    if (companyName.length < 2) return fail('Company name must be at least 2 characters.')
    if (companyName.length > 100) return fail('Company name must not exceed 100 characters.')

    if (!subdomain) return fail('Subdomain is required.')
    if (subdomain.length < 3 || subdomain.length > 63) return fail('Subdomain must be between 3 and 63 characters.')
    if (!SUBDOMAIN_PATTERN.test(subdomain)) {
      return fail('Subdomain may only contain lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.')
    }

    if (!adminName) return fail('Administrator name is required.')
    if (!adminEmail) return fail('Administrator email is required.')
    if (!EMAIL_PATTERN.test(adminEmail)) return fail('Administrator email is not a valid email address.')

    // Fast-path duplicate checks — the @assert.unique constraints below are the real
    // guarantee under concurrent registrations; these just give a clean error sooner.
    const duplicateCompany = await SELECT.one.from(Tenants).where({ companyName })
    if (duplicateCompany) return fail('Company name already exists.')

    const fullDomain = fullDomainFor(subdomain)
    const duplicateDomain = await SELECT.one.from(Domains).where({ domainName: fullDomain })
    if (duplicateDomain) return fail('Subdomain already exists.')

    const subscriptionPlan = await SELECT.one.from(SubscriptionPlans).where({ code: planCode })
    if (!subscriptionPlan) return fail(`Unknown subscription plan: ${planCode}.`)

    const tenantId = cds.utils.uuid()

    try {
      await INSERT.into(Tenants).entries({
        ID: tenantId,
        companyName,
        status: 'PROVISIONING',
        adminName,
        adminEmail
      })

      await INSERT.into(Domains).entries({
        tenant_ID: tenantId,
        domainName: fullDomain,
        isCustom: false,
        isPrimary: true,
        verified: false
      })

      await INSERT.into(Subscriptions).entries({
        tenant_ID: tenantId,
        plan_ID: subscriptionPlan.ID,
        // ponytail: every registration starts a TRIAL subscription regardless of requested
        // plan; real plan activation/billing is a future concern, not this endpoint's job.
        status: 'TRIAL',
        startDate: new Date().toISOString().slice(0, 10)
      })

      await INSERT.into(Provisioning).entries({
        tenant_ID: tenantId,
        status: 'PENDING'
      })
    } catch (err) {
      const isUniqueViolation = err.code === '23505' || /duplicate key/i.test(err.message || '')
      if (!isUniqueViolation) throw err
      if (/companyname/i.test(err.message || '')) return fail('Company name already exists.')
      if (/domainname/i.test(err.message || '')) return fail('Subdomain already exists.')
      return fail('A conflicting tenant record already exists.')
    }

    await logPlatformAudit(tenantId, 'TENANT_CREATED', `${companyName} (${fullDomain}), plan ${planCode}, admin ${adminEmail}`, req.user.attr.email)

    return {
      success: true,
      tenantId,
      status: 'PROVISIONING',
      message: 'Tenant registration completed. Provisioning will begin shortly.'
    }
  })
}
