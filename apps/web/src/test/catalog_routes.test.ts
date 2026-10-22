/**
 * Real Next.js route handler integration tests for Catalog Products:
 * - POST /api/v1/catalog/products
 * - PUT /api/v1/catalog/products/[id]
 *
 * Verifies:
 * 1. Product creation with multiple variants
 * 2. Product creation with opening stock (both with and without initial cost)
 * 3. Product update updating hsnCode (valid and invalid formats)
 * 4. Product variant creation/update with isFreeSample
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { createSession } from "@/server/identity/session";
import { POST as createProductRoute } from "@/app/api/v1/catalog/products/route";
import { PUT as updateProductRoute } from "@/app/api/v1/catalog/products/[id]/route";

function makeRequest(url: string, method: string, token: string, body?: unknown): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("cookie", `${env.SESSION_COOKIE_NAME}=${token}`);

  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function runTests() {
  console.log("=== Starting Catalog Routes Integration Tests (Real HTTP Handlers) ===");

  // Find owner user and active store
  const user = await db.user.findFirst({
    where: { tenantRole: "OWNER" },
    include: { tenant: true },
  });
  assert(user, "Expected owner user to exist in test database");

  const store = await db.store.findFirst({
    where: { tenantId: user.tenantId },
  });
  assert(store, "Expected store to exist for test tenant");

  let uom = await db.uom.findFirst({
    where: { tenantId: user.tenantId },
  });
  if (!uom) {
    uom = await db.uom.create({
      data: {
        id: `uom-${Date.now()}`,
        tenantId: user.tenantId,
        code: "PCS",
        name: "Pieces",
        decimalPlaces: 0,
        isActive: true,
      },
    });
  }

  const session = await createSession({
    userId: user.id,
    tenantId: user.tenantId,
    ip: "127.0.0.1",
    userAgent: "IntegrationTestRunner/1.0",
  });
  const token = session.token;
  console.log(`[Setup] Created test session for tenant ${user.tenant.name} (${user.tenantId}) in store ${store.name}`);

  // Test 1: Product creation with multiple variants
  console.log("\n--- Test 1: Product creation with multiple variants ---");
  const t1Name = `Multi-Variant T-Shirt ${Date.now()}`;
  const t1Req = makeRequest("http://localhost:3000/api/v1/catalog/products", "POST", token, {
    name: t1Name,
    category: "Apparel",
    brand: "G-Brand",
    baseUomId: uom.id,
    hsnCode: "61091000",
    variants: [
      {
        sku: `SKU-RED-S-${Date.now()}`,
        barcode: `BC-RS-${Date.now().toString().slice(-6)}`,
        size: "S",
        colour: "Red",
        priceMinor: 49900,
        mrpMinor: 59900,
        taxTreatment: "TAXABLE",
        taxRateBp: 500,
      },
      {
        sku: `SKU-RED-M-${Date.now()}`,
        barcode: `BC-RM-${Date.now().toString().slice(-6)}`,
        size: "M",
        colour: "Red",
        priceMinor: 54900,
        mrpMinor: 64900,
        taxTreatment: "TAXABLE",
        taxRateBp: 500,
      },
    ],
  });

  const t1Res = await createProductRoute(t1Req);
  const t1Data = await t1Res.json();
  console.log(`Test 1 Status: ${t1Res.status}`, JSON.stringify(t1Data));
  assert.equal(t1Res.status, 201, "Expected HTTP 201 Created for multiple variants");
  assert.equal(t1Data.status, "ok");
  assert(t1Data.productId, "Expected productId in response");
  const createdProductId = t1Data.productId;

  // Verify in database
  const t1DbProduct = await db.product.findUnique({
    where: { id: createdProductId },
    include: { variants: true },
  });
  assert.equal(t1DbProduct?.variants.length, 2, "Expected 2 variants created in DB");
  console.log(`✓ Test 1 Passed: Product created with ${t1DbProduct?.variants.length} variants.`);

  // Test 2: Product creation with opening stock (both with and without initial cost)
  console.log("\n--- Test 2: Opening stock validation (with and without cost) ---");

  // 2a. Opening stock without initial cost price and without isFreeSample -> Expect 400 validation error
  const t2aReq = makeRequest("http://localhost:3000/api/v1/catalog/products", "POST", token, {
    name: `Stock No Cost ${Date.now()}`,
    baseUomId: uom.id,
    variant: {
      sku: `SKU-NC-${Date.now()}`,
      priceMinor: 10000,
      openingStock: [{ storeId: store.id, quantity: 10 }],
      // costPriceMinor missing and isFreeSample not true
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
    },
  });
  const t2aRes = await createProductRoute(t2aReq);
  const t2aData = await t2aRes.json();
  console.log(`Test 2a (No Cost) Status: ${t2aRes.status}`, JSON.stringify(t2aData));
  assert.equal(t2aRes.status, 400, "Expected HTTP 400 when opening stock has no cost price");
  assert.match(t2aData.error?.message ?? t2aData.message, /Cost price is required/i, "Expected cost price required validation message");
  console.log("✓ Test 2a Passed: Correctly rejected opening stock without cost price.");

  // 2b. Opening stock with valid cost price -> Expect 201 Created
  const t2bReq = makeRequest("http://localhost:3000/api/v1/catalog/products", "POST", token, {
    name: `Stock With Cost ${Date.now()}`,
    baseUomId: uom.id,
    variant: {
      sku: `SKU-WC-${Date.now()}`,
      costPriceMinor: 5000,
      priceMinor: 10000,
      openingStock: [{ storeId: store.id, quantity: 15 }],
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
    },
  });
  const t2bRes = await createProductRoute(t2bReq);
  const t2bData = await t2bRes.json();
  console.log(`Test 2b (With Cost) Status: ${t2bRes.status}`, JSON.stringify(t2bData));
  assert.equal(t2bRes.status, 201, "Expected HTTP 201 when opening stock includes cost price");
  console.log("✓ Test 2b Passed: Successfully created product with opening stock and initial cost.");

  // Test 3: Product update updating hsnCode
  console.log("\n--- Test 3: Product update updating hsnCode ---");

  // 3a. Invalid HSN format (< 4 digits or non-digit) -> Expect 400
  const t3aReq = makeRequest(
    `http://localhost:3000/api/v1/catalog/products/${createdProductId}`,
    "PUT",
    token,
    { hsnCode: "123" }
  );
  const t3aRes = await updateProductRoute(t3aReq, { params: Promise.resolve({ id: createdProductId }) });
  const t3aData = await t3aRes.json();
  console.log(`Test 3a (Invalid HSN '123') Status: ${t3aRes.status}`, JSON.stringify(t3aData));
  assert.equal(t3aRes.status, 400, "Expected HTTP 400 for invalid HSN code < 4 digits");

  // 3b. Valid HSN format -> Expect 200 OK and database update
  const t3bReq = makeRequest(
    `http://localhost:3000/api/v1/catalog/products/${createdProductId}`,
    "PUT",
    token,
    { hsnCode: "52081110" }
  );
  const t3bRes = await updateProductRoute(t3bReq, { params: Promise.resolve({ id: createdProductId }) });
  const t3bData = await t3bRes.json();
  console.log(`Test 3b (Valid HSN '52081110') Status: ${t3bRes.status}`, JSON.stringify(t3bData));
  assert.equal(t3bRes.status, 200, "Expected HTTP 200 for valid HSN code update");

  const t3DbProduct = await db.product.findUnique({ where: { id: createdProductId } });
  assert.equal(t3DbProduct?.hsnCode, "52081110", "Expected product HSN code to be updated in DB");
  console.log("✓ Test 3 Passed: HSN code validated and updated in database.");

  // Test 4: Product variant creation/update with isFreeSample
  console.log("\n--- Test 4: Product variant creation/update with isFreeSample ---");

  // 4a. Creation with opening stock, zero/null cost price BUT isFreeSample = true -> Allowed
  const t4aReq = makeRequest("http://localhost:3000/api/v1/catalog/products", "POST", token, {
    name: `Free Sample Shirt ${Date.now()}`,
    baseUomId: uom.id,
    variant: {
      sku: `SKU-SAMPLE-${Date.now()}`,
      costPriceMinor: null,
      priceMinor: 0,
      isFreeSample: true,
      openingStock: [{ storeId: store.id, quantity: 20 }],
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
    },
  });
  const t4aRes = await createProductRoute(t4aReq);
  const t4aData = await t4aRes.json();
  console.log(`Test 4a (Free Sample Create) Status: ${t4aRes.status}`, JSON.stringify(t4aData));
  assert.equal(t4aRes.status, 201, "Expected HTTP 201 for free sample creation with opening stock");
  const sampleProductId = t4aData.productId;

  // 4b. Update variant with isFreeSample
  const sampleProduct = await db.product.findUnique({
    where: { id: sampleProductId },
    include: { variants: true },
  });
  const sampleVariant = sampleProduct?.variants[0];
  assert(sampleVariant, "Expected variant to exist");

  const t4bReq = makeRequest(
    `http://localhost:3000/api/v1/catalog/products/${sampleProductId}`,
    "PUT",
    token,
    {
      variants: [
        {
          id: sampleVariant.id,
          sku: sampleVariant.sku,
          priceMinor: 0,
          isFreeSample: true,
        },
      ],
    }
  );
  const t4bRes = await updateProductRoute(t4bReq, { params: Promise.resolve({ id: sampleProductId }) });
  const t4bData = await t4bRes.json();
  console.log(`Test 4b (Free Sample Update) Status: ${t4bRes.status}`, JSON.stringify(t4bData));
  assert.equal(t4bRes.status, 200, "Expected HTTP 200 for free sample variant update");

  // Verify stock movement was recorded with unitCostMinor: 0
  const stockMovement = await db.stockMovement.findFirst({
    where: {
      tenantId: user.tenantId,
      variantId: sampleVariant.id,
      type: "OPENING_BALANCE",
    },
  });
  assert(stockMovement, "Expected opening stock movement to exist");
  assert.equal(stockMovement.unitCostMinor, 0, "Expected free sample unitCostMinor to be 0");
  assert.equal(stockMovement.isFreeSample, true, "Expected stock movement isFreeSample to be true");
  console.log("✓ Test 4 Passed: isFreeSample opening stock and variant update verified.");

  console.log("\n=== ALL 4 INTEGRATION TEST SUITES PASSED SUCCESSFULLY ===");
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Test execution failed:", err);
    process.exit(1);
  });
