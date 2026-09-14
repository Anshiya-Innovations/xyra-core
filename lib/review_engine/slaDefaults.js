// Single source of truth for SLA-settings default values, shared by the
// provisioning seed (writes the real row) and review_engine (in-memory
// fallback for a tenant provisioned before this feature existed and that
// hasn't been re-seeded) — keeps the two from silently drifting apart.
const DEFAULT_SLA_SETTINGS = {
  reviewer1Days: 10,
  reviewer2Days: 5,
  escalationDelayDays: 3
}

module.exports = { DEFAULT_SLA_SETTINGS }
