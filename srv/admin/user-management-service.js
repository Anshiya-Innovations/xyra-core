const cds = require("@sap/cds");
const {
  getPool,
  tenantEntities,
} = require("../../lib/tenant/TenantPoolManager");
const { activeTenant } = require("../../lib/tenant/TenantDirectory");
const { ensureMembership, removeMembership } = require("../../lib/auth/identity");
const { hashPassword } = require("../../lib/auth/password");

const VALID_ROLES = ["REVIEWER", "ESCALATION_MANAGER", "AUDITOR"];

module.exports = function (srv) {
  srv.on("listUsers", async (req) => {

    const { tenantId, databaseName } = req.user.attr;

    const tenantDb = await getPool(tenantId, databaseName);
    const { Users, Roles, Organizations } = await tenantEntities();

    const tx = tenantDb.tx();
    try {
      const [users, roles, organizations] = await Promise.all([
        tx.run(SELECT.from(Users)),
        tx.run(SELECT.from(Roles)),
        tx.run(SELECT.from(Organizations)),
      ]);
      const roleById = new Map(roles.map((r) => [r.ID, r]));
      const defaultOrg =
        organizations.find((org) => org.orgCode === "DEFAULT") ||
        organizations[0];
      const defaultOrganization = defaultOrg
        ? `${defaultOrg.orgCode} - ${defaultOrg.name}`
        : "";

      if (defaultOrganization) {
        await Promise.all(
          users
            .filter((user) => !user.organization)
            .map((user) =>
              tx.run(
                UPDATE(Users)
                  .set({ organization: defaultOrganization })
                  .where({ ID: user.ID }),
              ),
            ),
        );
      }

      return users.map((u) => ({
        id: u.ID,
        name: u.name,
        email: u.email,
        organization: u.organization || defaultOrganization,
        role:
          u.role_ID && roleById.has(u.role_ID)
            ? roleById.get(u.role_ID).code
            : null,
        status: u.status,
        createdAt: u.createdAt,
      }));
    } finally {
      await tx.commit();
    }
  });

  srv.on("createUser", async (req) => {
    const fail = (message) => ({ success: false, message, userId: null });

    const name = (req.data.name || "").trim();
    const email = (req.data.email || "").trim();
    const password = req.data.password || "";
    const roleCode = (req.data.roleCode || "").trim().toUpperCase();
    const organization = (req.data.organization || "").trim();

    if (
      !name ||
      !email ||
      !password ||
      !roleCode ||
      !organization
    ) {
      return fail("name, email, password, role and organization are required.");
    }
    if (!VALID_ROLES.includes(roleCode))
      return fail("Admin accounts cannot be created here.");

    const { tenantId, databaseName } = req.user.attr;

    const tenantDb = await getPool(tenantId, databaseName);
    const { Users, Roles } = await tenantEntities();

    const tx = tenantDb.tx();
    let ok = false;
    try {
      const existing = await tx.run(SELECT.one.from(Users).where({ email }));
      if (existing) return fail("A user with this email already exists.");

      const role = await tx.run(
        SELECT.one.from(Roles).where({ code: roleCode }),
      );
      if (!role) return fail(`Role not found: ${roleCode}`);

      const id = cds.utils.uuid();
      const passwordHash = await hashPassword(password);
      await tx.run(
        INSERT.into(Users).entries({
          ID: id,
          name,
          email,
          passwordHash,
          role_ID: role.ID,
          status: "ACTIVE",
          organization,
        }),
      );

      // The master membership is what lets this user sign in — if it can't be
      // written, roll back rather than leave a tenant user nobody can log in as.
      await ensureMembership({ email, name, tenantId, tenantUserId: id, persona: roleCode });
      ok = true;
      return { success: true, message: "User created.", userId: id };
    } finally {
      await (ok ? tx.commit() : tx.rollback());
    }
  });

  srv.on("removeUser", async (req) => {
    const fail = (message) => ({ success: false, message });

    const userId = (req.data.userId || "").trim();
    if (!userId) return fail("userId is required.");

    const { tenantId, databaseName } = req.user.attr;

    const tenantDb = await getPool(tenantId, databaseName);
    const { Users } = await tenantEntities();

    const tx = tenantDb.tx();
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }));
      if (!user) return fail("User not found.");
      const tenant = await activeTenant(tenantId);
      if (tenant && user.email.toLowerCase() === String(tenant.adminEmail || "").toLowerCase())
        return fail("Cannot remove the tenant admin account.");
      if (userId === req.user.attr.tenantUserId)
        return fail("You cannot remove your own account.");

      await removeMembership(tenantId, userId);
      await tx.run(DELETE.from(Users).where({ ID: userId }));
      return { success: true, message: "User removed." };
    } finally {
      await tx.commit();
    }
  });

  srv.on("resetPassword", async (req) => {
    const fail = (message) => ({ success: false, message });

    const userId = (req.data.userId || "").trim();
    const newPassword = req.data.newPassword || "";
    if (!userId || !newPassword)
      return fail("userId and newPassword are required.");

    const { tenantId, databaseName } = req.user.attr;

    const tenantDb = await getPool(tenantId, databaseName);
    const { Users } = await tenantEntities();

    const tx = tenantDb.tx();
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }));
      if (!user) return fail("User not found.");

      const passwordHash = await hashPassword(newPassword);
      await tx.run(UPDATE(Users).set({ passwordHash }).where({ ID: userId }));
      return { success: true, message: "Password reset." };
    } finally {
      await tx.commit();
    }
  });
};
