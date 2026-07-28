const { Client } = require('pg')
const cds = require('@sap/cds')

const DUPLICATE_DATABASE = '42P04' // Postgres SQLSTATE for "database already exists"
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/

// ponytail: reuses the Master DB's own admin connection (same RDS server, just a
// different logical database) rather than assuming a separate maintenance DB —
// this is one shared Postgres server hosting many per-tenant databases, not one
// server per tenant.
function adminCredentials() {
  const cr = cds.env.requires.db.credentials
  return {
    host: cr.host,
    port: cr.port,
    user: cr.user,
    password: cr.password,
    database: cr.database,
    ssl: cr.ssl
  }
}

function tenantDatabaseName(subdomain) {
  const dbName = `tenant_${subdomain.replace(/-/g, '_')}`
  if (!SAFE_IDENTIFIER.test(dbName)) throw new Error(`Invalid derived database name: ${dbName}`)
  return dbName
}

// Idempotent: CREATE DATABASE has no "IF NOT EXISTS" in Postgres, so a duplicate
// error here just means a previous (possibly failed) provisioning attempt already
// made it — treat that as success so retries don't blow up on this step.
async function createTenantDatabase(dbName) {
  if (!SAFE_IDENTIFIER.test(dbName)) throw new Error(`Refusing to create database with unsafe name: ${dbName}`)

  const client = new Client(adminCredentials())
  await client.connect()
  try {
    await client.query(`CREATE DATABASE "${dbName}"`)
  } catch (err) {
    if (err.code !== DUPLICATE_DATABASE) throw err
  } finally {
    await client.end()
  }
}

module.exports = { createTenantDatabase, tenantDatabaseName, adminCredentials }
