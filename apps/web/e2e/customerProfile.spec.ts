import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db } from "./db";

test.describe("F6.2 Customer Profile", () => {
  test("loads customer profile with real data and blocks cross-tenant access", async ({ page }) => {
    // Get the primary E2E tenant
    const user = await db.user.findFirst({ where: { email: "owner@demo.amburax.test" } });
    if (!user) throw new Error("E2E owner not found");

    await signIn(page);

    // 1. Create a customer to test with
    const customer = await db.customer.create({
      data: {
        tenantId: user.tenantId,
        name: "E2E Profile Test",
        phone: "9998887771",
        email: "e2e@profile.test",
        isActive: true,
      }
    });

    // 2. Navigate to profile
    await page.goto(`/customers/${customer.id}`);
    
    // 3. Verify it loads
    await expect(page.getByRole("heading", { name: "E2E Profile Test" })).toBeVisible();
    await expect(page.getByText("9998887771")).toBeVisible();
    await expect(page.getByText("e2e@profile.test")).toBeVisible();

    // 4. Verify cross-tenant isolation
    // Create another tenant's customer
    const rand = Math.random().toString(36).slice(2, 7);
    const otherTenant = await db.tenant.create({ 
      data: { 
        name: `Other Tenant ${rand}`, 
        slug: `other-tenant-${rand}`,
        businessType: "RETAIL",
        country: "IN",
        contactEmail: "other@example.com",
        contactPhone: "0000000000",
        termsAcceptedAt: new Date()
      } 
    });
    const otherCustomer = await db.customer.create({
      data: {
        tenantId: otherTenant.id,
        name: "Other Tenant Customer",
        phone: "5555555555"
      }
    });

    // Navigate to other tenant's customer
    const response = await page.goto(`/customers/${otherCustomer.id}`);
    
    // Since Next.js returns 404 for notFound() inside server component, we check for a 404
    expect(response?.status()).toBe(404);
  });
});
