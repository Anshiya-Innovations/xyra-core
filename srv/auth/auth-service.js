const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantIdByHost, requestHostname } = require('../../lib/tenant/resolveTenant')
const { activeTenant } = require('../../lib/tenant/TenantDirectory')
const { findMembership, issueTenantToken } = require('../../lib/auth/identity')
const { fullDomainFor } = require('../../lib/platform')
const { notify } = require('../../lib/notification_engine')
const { logAudit } = require('../../lib/audit')

const DEV_MODE = process.env.DEV_MODE === 'true'

module.exports = function (srv) {
  srv.on('login', async (req) => {
    const fail = (message) => ({ success: false, message, token: null, tenantId: null, userId: null, name: null, email: null, role: null })

    const email = (req.data.email || '').trim()
    const persona = (req.data.persona || '').trim().toUpperCase()
    if (!email || !persona) return fail('email and persona are required.')

    // Resolve tenant by incoming host, or fallback to provided subdomain, or default demo tenant.
    const incomingHost = requestHostname(req.http.req)
    const subdomain = req.data.subdomain ? req.data.subdomain.trim() : 'xyrademo'
    const tenantId = await resolveTenantIdByHost(incomingHost, subdomain)
    const tenant = tenantId && (await activeTenant(tenantId))
    if (!tenant) return fail('Email not found.')

    const found = await findMembership(email, tenantId)
    if (!found || found.membership.persona !== persona) return fail('Email not found.')
    const { user, membership } = found

    const tenantDb = await getPool(tenantId, tenant.databaseName)
    const entities = await tenantEntities()
    const tenantTx = tenantDb.tx()
    try {
      const tenantUser = await tenantTx.run(SELECT.one.from(entities.Users).where({ ID: membership.tenantUserId }))
      if (!tenantUser || tenantUser.status !== 'ACTIVE') return fail('Email not found.')

      // Best-effort — a notification failure shouldn't block a successful login.
      notify(tenantId, tenant.databaseName, {
        title: 'User Login',
        message: `${tenantUser.name || email} signed in.`,
        category: 'TASK',
        priority: 'LOW',
        targetPage: 'Profile',
        icon: 'sap-icon://log',
        iconClass: 'xyraNotifyIconBlue'
      }).catch((err) => console.error('notify(login) failed:', err))

      await logAudit(tenantTx, entities, {
        action: 'LOGIN',
        module: 'Authentication',
        objectType: 'User',
        objectId: tenantUser.ID,
        objectLabel: user.email,
        description: `${tenantUser.name || user.email} logged in.`,
        performedBy: user.email,
        performedByRole: persona
      })

      return {
        success: true,
        message: 'Login successful.',
        token: issueTenantToken(user, membership),
        tenantId,
        userId: tenantUser.ID,
        name: tenantUser.name,
        email: user.email,
        role: persona
      }
    } finally {
      await tenantTx.commit()
    }
  })

  srv.on('listMyTenants', async (req) => {
    const { Memberships, Tenants, Domains } = cds.entities('xyra.master')
    const memberships = await SELECT.from(Memberships).where({ user_ID: req.user.id, status: 'ACTIVE' })
    if (!memberships.length) return { success: true, message: 'OK', tenants: [] }

    const ids = memberships.map((m) => m.tenant_ID)
    const [tenants, domains] = await Promise.all([
      SELECT.from(Tenants).columns('ID', 'companyName').where({ ID: { in: ids }, status: 'ACTIVE' }),
      SELECT.from(Domains).columns('tenant_ID', 'domainName').where({ tenant_ID: { in: ids }, isPrimary: true })
    ])
    const domainOf = new Map(domains.map((d) => [d.tenant_ID, d.domainName]))
    const personaOf = new Map(memberships.map((m) => [m.tenant_ID, m.persona]))
    return {
      success: true,
      message: 'OK',
      tenants: tenants.map((t) => ({ tenantId: t.ID, companyName: t.companyName, domain: domainOf.get(t.ID) || null, persona: personaOf.get(t.ID) }))
    }
  })

  srv.on('switchTenant', async (req) => {
    const fail = (message) => ({ success: false, message, token: null, domain: null, role: null })
    const tenantId = (req.data.tenantId || '').trim()
    if (!tenantId) return fail('tenantId is required.')

    const { Users, Memberships, Domains } = cds.entities('xyra.master')
    const [user, membership] = await Promise.all([
      SELECT.one.from(Users).where({ ID: req.user.id, status: 'ACTIVE' }),
      SELECT.one.from(Memberships).where({ user_ID: req.user.id, tenant_ID: tenantId, status: 'ACTIVE' })
    ])
    if (!user || !membership || !(await activeTenant(tenantId))) return fail('You are not a member of that workspace.')

    const domain = await SELECT.one.from(Domains).columns('domainName').where({ tenant_ID: tenantId, isPrimary: true })
    return {
      success: true,
      message: 'OK',
      token: issueTenantToken(user, membership),
      domain: domain ? domain.domainName : null,
      role: membership.persona
    }
  })
}
