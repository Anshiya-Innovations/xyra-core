const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { logAudit } = require('../../lib/audit')
const { listProjectStatuses } = require('../../lib/ticketing/jira')

function toEntry(o, systemCount) {
  return {
    id: o.ID,
    orgCode: o.orgCode,
    name: o.name,
    industry: o.industry || '',
    region: o.region || '',
    country: o.country || '',
    primaryContact: o.primaryContact || '',
    email: o.email || '',
    phone: o.phone || '',
    status: o.status || 'Active',
    systemCount: systemCount || 0,
    createdAt: o.createdAt
  }
}

module.exports = function (srv) {
  srv.on('listOrganizations', async (req) => {
    const fail = (message) => ({ success: false, message, organizations: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Organizations, Systems } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const [orgs, systems] = await Promise.all([
        tx.run(SELECT.from(Organizations).orderBy('createdAt desc')),
        tx.run(SELECT.from(Systems).columns('organization_ID'))
      ])
      const countByOrg = new Map()
      for (const s of systems) {
        if (!s.organization_ID) continue
        countByOrg.set(s.organization_ID, (countByOrg.get(s.organization_ID) || 0) + 1)
      }

      return { success: true, message: 'OK', organizations: orgs.map((o) => toEntry(o, countByOrg.get(o.ID))) }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getOrganization', async (req) => {
    const fail = (message) => ({ success: false, message, organization: null })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Organizations, Systems } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const org = await tx.run(SELECT.one.from(Organizations).where({ ID: id }))
      if (!org) return fail('Organization not found.')

      const systemCount = (await tx.run(SELECT.from(Systems).columns('ID').where({ organization_ID: id }))).length
      return { success: true, message: 'OK', organization: toEntry(org, systemCount) }
    } finally {
      await tx.commit()
    }
  })

  srv.on('createOrganization', async (req) => {
    const fail = (message) => ({ success: false, message, id: null })
    const subdomain = (req.data.subdomain || '').trim()
    const orgCode = (req.data.orgCode || '').trim()
    const name = (req.data.name || '').trim()
    if (!subdomain || !orgCode || !name) return fail('Organization ID and Company Name are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Organizations } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Organizations).where({ orgCode }))
      if (existing) return fail(`Organization '${orgCode}' already exists.`)

      const id = cds.utils.uuid()
      await tx.run(INSERT.into(Organizations).entries({
        ID: id,
        orgCode,
        name,
        industry: req.data.industry || null,
        region: req.data.region || null,
        country: req.data.country || null,
        primaryContact: req.data.primaryContact || null,
        email: req.data.email || null,
        phone: req.data.phone || null,
        status: req.data.status || 'Active'
      }))

      await logAudit(tx, entities, {
        action: 'ORGANIZATION_CREATE',
        module: 'Organization',
        objectType: 'Organization',
        objectId: orgCode,
        objectLabel: `${orgCode} (${name})`,
        description: `Added Organization '${orgCode}' (${name}).`,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Organization created.', id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateOrganization', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Organizations } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Organizations).where({ ID: id }))
      if (!existing) return fail('Organization not found.')

      await tx.run(UPDATE(Organizations).set({
        name: req.data.name || existing.name,
        industry: req.data.industry || existing.industry,
        region: req.data.region || existing.region,
        country: req.data.country || existing.country,
        primaryContact: req.data.primaryContact || existing.primaryContact,
        email: req.data.email || existing.email,
        phone: req.data.phone || existing.phone,
        status: req.data.status || existing.status
      }).where({ ID: id }))

      await logAudit(tx, entities, {
        action: 'ORGANIZATION_UPDATE',
        module: 'Organization',
        objectType: 'Organization',
        objectId: existing.orgCode,
        objectLabel: `${existing.orgCode} (${existing.name})`,
        description: `Updated Organization '${existing.orgCode}'.`,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Organization updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('deleteOrganization', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Organizations, Systems } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Organizations).where({ ID: id }))
      if (!existing) return fail('Organization not found.')

      const systemCount = (await tx.run(SELECT.from(Systems).columns('ID').where({ organization_ID: id }))).length
      if (systemCount > 0) return fail(`Cannot delete '${existing.orgCode}' - reassign or remove its ${systemCount} system(s) first.`)

      await tx.run(DELETE.from(Organizations).where({ ID: id }))

      await logAudit(tx, entities, {
        action: 'ORGANIZATION_DELETE',
        module: 'Organization',
        objectType: 'Organization',
        objectId: existing.orgCode,
        objectLabel: `${existing.orgCode} (${existing.name})`,
        description: `Deleted Organization '${existing.orgCode}'.`,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Organization deleted.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getJiraSettings', async (req) => {
    const fail = (message) => ({ success: false, message, settings: null })
    const subdomain = (req.data.subdomain || '').trim()
    const organizationId = (req.data.organizationId || '').trim()
    if (!subdomain || !organizationId) return fail('organizationId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { JiraSettings } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const row = await tx.run(SELECT.one.from(JiraSettings).where({ organization_ID: organizationId }))
      return {
        success: true,
        message: 'OK',
        settings: {
          enabled: !!(row && row.enabled),
          siteUrl: (row && row.siteUrl) || '',
          email: (row && row.email) || '',
          projectKey: (row && row.projectKey) || '',
          issueType: (row && row.issueType) || 'Task',
          hasToken: !!(row && row.apiToken),
          statusCreated: (row && row.statusCreated) || '',
          statusInProgress: (row && row.statusInProgress) || '',
          statusResolved: (row && row.statusResolved) || ''
        }
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateJiraSettings', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const organizationId = (req.data.organizationId || '').trim()
    if (!subdomain || !organizationId) return fail('organizationId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { JiraSettings, Organizations } = entities
    const tx = tenantDb.tx()
    try {
      const org = await tx.run(SELECT.one.from(Organizations).where({ ID: organizationId }))
      if (!org) return fail('Organization not found.')

      const patch = {
        enabled: !!req.data.enabled,
        siteUrl: (req.data.siteUrl || '').trim(),
        email: (req.data.email || '').trim(),
        projectKey: (req.data.projectKey || '').trim(),
        issueType: (req.data.issueType || 'Task').trim(),
        statusCreated: (req.data.statusCreated || '').trim(),
        statusInProgress: (req.data.statusInProgress || '').trim(),
        statusResolved: (req.data.statusResolved || '').trim()
      }
      // apiToken only written when provided - blank keeps whatever's on file,
      // same as SystemCredentials' credUserId/credPassword edit behavior.
      if (req.data.apiToken) patch.apiToken = req.data.apiToken

      const existing = await tx.run(SELECT.one.from(JiraSettings).where({ organization_ID: organizationId }))
      if (existing) {
        await tx.run(UPDATE(JiraSettings).set(patch).where({ ID: existing.ID }))
      } else {
        await tx.run(INSERT.into(JiraSettings).entries({ ID: cds.utils.uuid(), organization_ID: organizationId, ...patch }))
      }

      await logAudit(tx, entities, {
        action: 'JIRA_SETTINGS_UPDATE',
        module: 'Organization',
        objectType: 'JiraSettings',
        objectId: org.orgCode,
        objectLabel: `Jira Integration - ${org.orgCode}`,
        description: `Updated Jira integration settings for '${org.orgCode}' (${patch.enabled ? 'enabled' : 'disabled'}, project ${patch.projectKey || 'none'}).`,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Jira settings updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getJiraStatusOptions', async (req) => {
    const fail = (message) => ({ success: false, message, statuses: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const siteUrl = (req.data.siteUrl || '').trim()
    const email = (req.data.email || '').trim()
    const projectKey = (req.data.projectKey || '').trim()
    let apiToken = (req.data.apiToken || '').trim()

    // apiToken is write-only (never sent back to the form after a save) -
    // fall back to whatever's already on file for this org so re-browsing
    // statuses doesn't force re-pasting the token every time.
    const organizationId = (req.data.organizationId || '').trim()
    if (!apiToken && organizationId) {
      const resolved = await resolveTenantBySubdomain(req, subdomain)
      if (resolved) {
        const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
        const { JiraSettings } = await tenantEntities()
        const tx = tenantDb.tx()
        try {
          const row = await tx.run(SELECT.one.from(JiraSettings).where({ organization_ID: organizationId }))
          if (row && row.apiToken) apiToken = row.apiToken
        } finally {
          await tx.commit()
        }
      }
    }

    const result = await listProjectStatuses({ siteUrl, email, apiToken, projectKey })
    if (!result.success) return fail(result.message)

    return { success: true, message: 'OK', statuses: result.statuses.map((s) => s.name) }
  })
}
