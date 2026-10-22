

// ERPNext Provisioning Script for AMBURAX POS
// This script idempotently sets up the necessary Frappe/ERPNext dependencies 
// to support the POS payment mapping and sales sync logic.

const ERP_URL = process.env.ERP_SITE_FRONTEND_URL || "http://localhost:8080";
const API_KEY = process.env.ERP_SITE_FRONTEND_KEY || (() => { throw new Error("Missing ERP_SITE_FRONTEND_KEY environment variable"); })();
const API_SECRET = process.env.ERP_SITE_FRONTEND_SECRET || (() => { throw new Error("Missing ERP_SITE_FRONTEND_SECRET environment variable"); })();

const COMPANY = "Amburax Retail";
const HEADERS = {
  "Authorization": `token ${API_KEY}:${API_SECRET}`,
  "Content-Type": "application/json"
};

async function apiGet(path: string) {
  const res = await fetch(`${ERP_URL}${path}`, { headers: HEADERS });
  if (!res.ok && res.status !== 404) {
    throw new Error(`GET ${path} failed: ${res.statusText}`);
  }
  return res.status === 404 ? null : await res.json();
}

async function apiPost(path: string, body: any) {
  const res = await fetch(`${ERP_URL}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.statusText} ${await res.text()}`);
  return await res.json();
}

async function apiPut(path: string, body: any) {
  const res = await fetch(`${ERP_URL}${path}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.statusText} ${await res.text()}`);
  return await res.json();
}

async function setupModeOfPayment(mode: string, defaultAccount: string) {
  console.log(`Ensuring Mode of Payment: ${mode}`);
  const existing = await apiGet(`/api/resource/Mode of Payment/${mode}`);
  
  if (!existing) {
    console.log(`  Creating Mode of Payment: ${mode}`);
    await apiPost(`/api/resource/Mode of Payment`, {
      doctype: "Mode of Payment",
      mode_of_payment: mode,
      enabled: 1,
      type: mode === "Cash" ? "Cash" : "Bank",
      accounts: [{ company: COMPANY, default_account: defaultAccount }]
    });
  } else {
    const accounts = existing.data.accounts || [];
    const accIndex = accounts.findIndex((a: any) => a.company === COMPANY);
    if (accIndex !== -1) {
      if (accounts[accIndex].default_account !== defaultAccount) {
        console.log(`  Updating account for ${mode} to ${defaultAccount}`);
        accounts[accIndex].default_account = defaultAccount;
        await apiPut(`/api/resource/Mode of Payment/${mode}`, { accounts });
      } else {
        console.log(`  Mode of Payment ${mode} already configured.`);
      }
    } else {
      console.log(`  Adding account ${defaultAccount} to ${mode}`);
      accounts.push({ company: COMPANY, default_account: defaultAccount });
      await apiPut(`/api/resource/Mode of Payment/${mode}`, { accounts });
    }
  }
}

async function setupServerScript() {
  console.log("Ensuring Before Validate Server Script...");
  const scriptName = "Auto Fill Payment Accounts";
  const existing = await apiGet(`/api/resource/Server Script/${scriptName}`);

  const scriptBody = `
for pay in doc.payments:
    if not pay.account:
        pay.account = frappe.db.get_value('Mode of Payment Account', {'parent': pay.mode_of_payment, 'company': doc.company}, 'default_account')
  `.trim();

  if (!existing) {
    console.log(`  Creating Server Script: ${scriptName}`);
    await apiPost(`/api/resource/Server Script`, {
      doctype: "Server Script",
      name: scriptName,
      script_type: "DocType Event",
      reference_doctype: "Sales Invoice",
      doctype_event: "Before Validate",
      script: scriptBody
    });
  } else {
    if (existing.data.script.trim() !== scriptBody) {
      console.log(`  Updating Server Script: ${scriptName}`);
      await apiPut(`/api/resource/Server Script/${scriptName}`, { script: scriptBody });
    } else {
      console.log("  Server Script already configured.");
    }
  }
}

async function setupPosProfile() {
  console.log("Ensuring POS Profile...");
  const profileName = "Standard POS";
  const existing = await apiGet(`/api/resource/POS Profile/${profileName}`);

  const profileBody = {
    doctype: "POS Profile",
    name: profileName,
    company: COMPANY,
    customer: "Cash",
    warehouse: "Stores - AR",
    income_account: "Sales - AR",
    expense_account: "Cost of Goods Sold - AR",
    write_off_account: "Write Off - AR",
    write_off_cost_center: "Main - AR",
    update_stock: 1,
    payments: [
      { mode_of_payment: "Cash", default: 1 },
      { mode_of_payment: "Credit Card", default: 0 },
      { mode_of_payment: "UPI", default: 0 }
    ],
    applicable_for_users: [
      { user: "Administrator", default: 1 }
    ]
  };

  if (!existing) {
    console.log(`  Creating POS Profile: ${profileName}`);
    await apiPost(`/api/resource/POS Profile`, profileBody);
  } else {
    console.log("  POS Profile already configured.");
  }
}

async function run() {
  console.log("Starting ERPNext POS configuration provisioning...\n");
  
  console.log("NOTE: This script assumes 'server_script_enabled' is set to 1 in your bench site_config.json.");
  console.log("Run: `bench set-config -g server_script_enabled 1` if it is not.\n");

  await setupModeOfPayment("Cash", "Cash - AR");
  await setupModeOfPayment("Credit Card", "Bank - AR");
  await setupModeOfPayment("UPI", "Cash - AR"); // Map UPI to cash account or bank as required

  await setupServerScript();
  await setupPosProfile();

  console.log("\nERP provisioning complete!");
}

run().catch(console.error);
