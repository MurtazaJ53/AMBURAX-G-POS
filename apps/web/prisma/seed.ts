import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/identity/password";
import { logError } from "../src/lib/safeLog";
import { seedCatalogue } from "./seedCatalogue";

const db = new PrismaClient();

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: "demo-retail" },
    update: {},
    create: {
      name: "Demo Retail Co.",
      slug: "demo-retail",
      businessType: "RETAIL",
      country: "India",
      contactEmail: "owner@demo.amburax.test",
      contactPhone: "+91 90000 00000",
      termsAcceptedAt: new Date(),
      onboardingStep: "COMPLETE",
      onboardingCompletedAt: new Date(),
    },
  });

  const store = await db.store.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Main Store",
      code: "MAIN",
      storeType: "RETAIL",
      currency: "INR",
      addressLine: "123 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      isDefault: true,
    },
  });

  const passwordHash = await hashPassword("Passw0rd!123");

  const owner = await db.user.upsert({
    where: { email: "owner@demo.amburax.test" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "owner@demo.amburax.test",
      passwordHash,
      name: "Demo Owner",
      status: "ACTIVE",
      tenantRole: "OWNER",
    },
  });

  await db.storeMembership.upsert({
    where: { userId_storeId: { userId: owner.id, storeId: store.id } },
    update: {},
    create: { tenantId: tenant.id, userId: owner.id, storeId: store.id, role: "OWNER" },
  });

  const mfaUser = await db.user.upsert({
    where: { email: "manager.mfa@demo.amburax.test" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "manager.mfa@demo.amburax.test",
      passwordHash,
      name: "Demo Manager (MFA)",
      status: "ACTIVE",
      mfaEnabled: true,
    },
  });

  await db.storeMembership.upsert({
    where: { userId_storeId: { userId: mfaUser.id, storeId: store.id } },
    update: {},
    create: { tenantId: tenant.id, userId: mfaUser.id, storeId: store.id, role: "STORE_MANAGER" },
  });

  // A third demo login at the till-operator end of the permission model — PERMISSIONS.md's
  // Cashier: "POS sales, customer lookup, payment collection, limited discount." No MFA,
  // same pattern as the owner account.
  const cashierUser = await db.user.upsert({
    where: { email: "cashier@demo.amburax.test" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "cashier@demo.amburax.test",
      passwordHash,
      name: "Demo Cashier",
      status: "ACTIVE",
    },
  });

  await db.storeMembership.upsert({
    where: { userId_storeId: { userId: cashierUser.id, storeId: store.id } },
    update: {},
    create: { tenantId: tenant.id, userId: cashierUser.id, storeId: store.id, role: "CASHIER" },
  });

  const counts = await seedCatalogue(db, { tenantId: tenant.id, storeId: store.id });

  console.log("Seeded demo tenant.");
  console.log("  owner@demo.amburax.test / Passw0rd!123 (no MFA)");
  console.log("  manager.mfa@demo.amburax.test / Passw0rd!123 (MFA — set DEV_OTP_ECHO=true to see the code)");
  console.log("  cashier@demo.amburax.test / Passw0rd!123 (no MFA)");
  console.log(
    `  catalogue: ${counts.products} products, ${counts.variants} variants, ${counts.customers} customers`,
  );
}

main()
  .catch((err) => {
    // Was `console.error(err)` — the same raw-error pattern P0-2 removed from src/.
    // A seed failure is usually a connection failure, which is exactly when the raw
    // object is most likely to carry the connection string.
    logError("prisma/seed: seeding failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
