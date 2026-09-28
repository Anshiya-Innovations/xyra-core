// ticketing/jira: creates a real Jira Cloud issue via the standard REST API
// (v3) - available on every plan including Free (Free's limits are seat
// count/storage/support, not API access). Auth is Basic (email:apiToken,
// same pairing pattern as connection_engine's SAP Basic Auth). One function,
// best-effort - callers (review_engine) fall back to a local stub ticket
// number on any failure, same "never block the primary action" stance
// connection_engine/notification_engine already take.

const DEFAULT_TIMEOUT_MS = 8000

function buildAuthHeader(email, apiToken) {
  const basic = Buffer.from(`${email}:${apiToken}`).toString('base64')
  return { Authorization: `Basic ${basic}` }
}

// Jira's v3 API requires the description as Atlassian Document Format, not
// plain text - this is the minimal valid ADF wrapper for a single paragraph.
function toAdf(text) {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: text || '' }] }] }
}

// priority/labels are optional and best-effort-omitted rather than failing
// the whole create if a site's scheme doesn't have them - Jira Cloud's
// default priority scheme (Highest/High/Medium/Low/Lowest) is present on
// every plan including Free unless an admin has customized it, so this is a
// safe default, not a guess specific to one site.
async function createIssue({ siteUrl, email, apiToken, projectKey, issueType, summary, description, priority, labels }) {
  if (!siteUrl || !email || !apiToken || !projectKey) {
    return { success: false, message: 'Jira is not fully configured (site, email, API token, and project key are all required).' }
  }

  const baseUrl = siteUrl.replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  const fields = {
    project: { key: projectKey },
    summary,
    issuetype: { name: issueType || 'Task' },
    // Callers may pass a ready ADF doc (deviationTicket.buildTicket) or plain text.
    description: description && typeof description === 'object' ? description : toAdf(description)
  }
  if (priority) fields.priority = { name: priority }
  if (labels && labels.length) fields.labels = labels

  try {
    const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(email, apiToken) },
      body: JSON.stringify({ fields }),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = (data.errorMessages && data.errorMessages[0]) ||
        (data.errors && Object.values(data.errors)[0]) ||
        `Jira returned HTTP ${response.status}.`
      return { success: false, message }
    }

    return { success: true, key: data.key, url: `${baseUrl}/browse/${data.key}` }
  } catch (err) {
    return { success: false, message: err.name === 'AbortError' ? 'Jira request timed out.' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

// Jira's status.statusCategory.key is one of a fixed, project-agnostic set
// ('new' | 'indeterminate' | 'done') regardless of what the project's actual
// workflow calls its statuses ("Done", "Closed", "Resolved", a custom name,
// ...) - this is the one reliable way to know "is this ticket resolved"
// without hardcoding status names that vary per Jira site/project.
async function getIssueStatus({ siteUrl, email, apiToken, issueKey }) {
  if (!siteUrl || !email || !apiToken || !issueKey) {
    return { success: false, message: 'siteUrl, email, apiToken, and issueKey are all required.' }
  }

  const baseUrl = siteUrl.replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`, {
      headers: buildAuthHeader(email, apiToken),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = (data.errorMessages && data.errorMessages[0]) || `Jira returned HTTP ${response.status}.`
      return { success: false, message }
    }

    const status = data.fields && data.fields.status
    return {
      success: true,
      status: (status && status.name) || '',
      statusCategory: (status && status.statusCategory && status.statusCategory.key) || ''
    }
  } catch (err) {
    return { success: false, message: err.name === 'AbortError' ? 'Jira request timed out.' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

// Every Jira board/project defines its own status names on top of Jira's 3
// fixed categories - this lists the real ones for a project so the admin
// can map "Ticket Created"/"In Progress"/"Resolved" onto whatever their
// board actually calls them, instead of us guessing/hardcoding "Done".
// Stateless - takes whatever site/email/token/project is currently in the
// settings form, saved or not, so an admin can check available statuses
// before saving.
async function listProjectStatuses({ siteUrl, email, apiToken, projectKey }) {
  if (!siteUrl || !email || !apiToken || !projectKey) {
    return { success: false, message: 'Site, email, API token, and project key are all required.' }
  }

  const baseUrl = siteUrl.replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`, {
      headers: buildAuthHeader(email, apiToken),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = (data.errorMessages && data.errorMessages[0]) || `Jira returned HTTP ${response.status}.`
      return { success: false, message }
    }

    // Response is per-issue-type, each with its own statuses array - flatten
    // and dedupe by name across issue types (the mapper is project-wide,
    // not per-issue-type).
    const seen = new Set()
    const statuses = []
    for (const issueType of data) {
      for (const status of issueType.statuses || []) {
        if (seen.has(status.name)) continue
        seen.add(status.name)
        statuses.push({ name: status.name, category: status.statusCategory && status.statusCategory.key })
      }
    }
    return { success: true, statuses }
  } catch (err) {
    return { success: false, message: err.name === 'AbortError' ? 'Jira request timed out.' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { createIssue, getIssueStatus, listProjectStatuses }
