# AMBURAX POS — Screen to API / Service Matrix

| ID | Screen | Service | Primary API/action | ERPNext | Events |
|---|---|---|---|---|---|
| A1 | Login | Identity | POST /auth/login | No | LoginSucceeded/Failed |
| A2 | Verify | Identity | POST /auth/verify | No | MFACompleted |
| A3 | Forgot | Identity | POST /auth/password/reset-request | No | ResetRequested |
| A4 | Reset | Identity | POST /auth/password/reset | No | PasswordChanged |
| A5 | Registration | Tenant | POST /tenants | Optional config | TenantCreated |
| A6 | Owner | Identity/Tenant | POST /onboarding/owner | User mapping | OwnerCreated |
| A7 | Store | Tenant | POST /stores | Warehouse mapping | StoreCreated |
| A8 | Team | Tenant | POST/GET /invitations, DELETE /invitations/:id, POST /invitations/:id/resend, POST /onboarding/team/complete | No | InvitationCreated/Resent/Revoked |
| A9 | POS Setup | Retail | POST /onboarding/pos, POST /pos/devices/activate | None - a terminal is not an ERPNext document | PosDeviceCreated/Activated |

**A9 additions (documented, deliberate):** the matrix originally listed one endpoint and
"POS config mapping" against ERPNext. Two corrections were made while building it.
(1) A second endpoint exists: `POST /api/v1/pos/devices/activate`. It is unauthenticated by
design - the caller is a terminal claiming its one-time pairing code, not a person - and
without it "POS setup complete" would mean only "a database row exists". Request:
`{ pairingCode }`. Response: `{ status, device, deviceSecret }`, the secret returned exactly
once and never shown to a human.
(2) There is no ERPNext mapping for a POS terminal. ERPNEXT_DOCTYPE_MAP.md defines no
terminal doctype; what ERPNext owns is the Sales Invoices and Payment Entries the till later
posts. `PosDevice` therefore carries no ERPNext provisioning field at all. See ADR-064.
`POST /api/v1/onboarding/pos` takes either `{ skip: true }` or
`{ storeId, name, code, receiptHeader?, receiptFooter?, showProductImages, scanSoundEnabled,
cashDrawerEnabled }`.
| A10 | Complete | Onboarding | GET /onboarding/status | Read | — |
| A11 | Accept Invite | Identity | POST /invitations/accept | User mapping | InvitationAccepted |

**A11 deviation (documented, deliberate):** the built endpoint is `POST /api/v1/invitations/accept`
with the raw token in the JSON body, not `POST /invitations/:id/accept`. The invitation id is not
knowable to an uninvited visitor and must not become a path parameter on a public unauthenticated
route: an id in the path invites enumeration and would require a second lookup key alongside the
token. The token alone is the credential and the lookup key (`tokenHash @unique`), and keeping it in
the body keeps it out of access logs, referrers, and browser history for the mutating request.
Request: `{ token, name?, password?, confirmPassword? }`. Response: `{ status, authenticated }`; the
session cookie is set **only** when a session was actually issued (new-account path).
| A12 | Store Select | Authorization | GET /stores/available + POST /context | Store/warehouse | ContextChanged |
| A13 | Security | Identity | security endpoints | No | SecurityChanged |
| A14 | Sessions | Identity | GET/DELETE /sessions | No | SessionRevoked |
| 15 | Dashboard | Analytics | GET /dashboard | Read | — |
| 16 | POS | POS/Sales | POST /sales | Sales Invoice/Payment | SaleCompleted |
| 19 | Sales History | Sales | GET /sales | Read | — |
| 20 | Bill | Sales | GET /sales/:id | Read | — |
| 24 | Inventory | Inventory | GET /inventory | Stock/bin/ledger | StockChanged |
| 25 | Catalog | Catalog | GET /products | Item/Variant | ProductChanged |
| 37 | Customers | CRM | GET /customers | Customer | CustomerChanged |
| 42 | Khata | Khata | GET /receivables | AR | CustomerDueChanged |
| 60 | Commerce | Commerce | GET /commerce/overview | Via adapter/read | — |
| 83 | Channels | Commerce | GET /channels | No direct | ChannelConnected |
| 87 | Listings | Commerce | GET /listings | Adapter | ListingPublished |
| 89 | Mapping | Commerce | POST /mappings | Adapter | MappingChanged |
| 90 | Publish | Commerce | POST /listings/publish | Adapter | ListingPublished |
| 94 | Online Orders | Commerce | GET /orders | Adapter + ERPNext | OrderReceived |
| 100 | Sync | Reconciliation | GET /sync/jobs | Adapter | SyncFailed |
| 101 | Reconciliation | Reconciliation | GET /reconciliation | ERPNext + channel | MismatchCreated |
| 112 | B2B Leads | B2B | GET /leads | Optional CRM mapping | LeadCreated |
| 117 | Quotation | B2B | POST /quotations | ERPNext Quotation | QuotationCreated |
| 121 | AI Automation | AI | GET/POST /automations | Via domain service | AIAction* |
| 124 | Credential Vault | Integrations | POST /credentials | No | CredentialChanged |

This matrix will be expanded to every screen before implementation of that screen.
