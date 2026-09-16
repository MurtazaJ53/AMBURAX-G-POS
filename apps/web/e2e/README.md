# Browser end-to-end tests

These run a real browser against a **running AMBURAX server and a real database**. Nothing is
stubbed: the login form performs real password verification, the till's requests carry the real
session cookie, and assertions about what was recorded are made by reading the database the
application just wrote to.

## Running them

```bash
# 1. a database with the development dataset
npm run db:up
npm run prisma:deploy
npm run db:seed

# 2. the application (AMBURAX uses 3001; another application owns 3000 on some machines)
npm run dev -- -p 3001

# 3. the tests
E2E_PASSWORD='<printed by npm run db:seed>' npm run test:e2e
```

Override `E2E_BASE_URL` if your server is elsewhere, and `E2E_EMAIL` to sign in as one of the
other seeded accounts.

## The test identity

There is no fixture, no bootstrap script and no backdoor. `npm run db:seed` creates three
development accounts and prints their credentials; these tests use one of them:

| Account | Role | MFA |
|---|---|---|
| `owner@demo.amburax.test` | tenant owner | no |
| `manager.mfa@demo.amburax.test` | store manager | yes — needs `DEV_OTP_ECHO=true` |
| `cashier@demo.amburax.test` | cashier | no |

The password is read from `E2E_PASSWORD` and has no default in this directory, so no working
credential lives in the repository. `E2E_EMAIL` is required to end in `.test` — a domain RFC 6761
reserves and which can never resolve — so the suite cannot be aimed at a production account by
mistake.

## What these tests will not do

They do not write. `db.ts` opens a read-only window onto the database for two purposes: fetching
fixture identifiers the product deliberately never sends to a client (the store id), and checking
what the server actually recorded. A test that wrote its own fixtures would be manufacturing the
state it claims to be verifying.

Every negative case is one that cannot succeed by construction — an unknown barcode, an empty
bill, a quantity that is not a quantity — which is what makes the suite safe to run against a
database someone else is also using.

## Known coverage gap

The sale path itself is **not** covered here, and cannot currently be: the till needs a POS
terminal to open a shift, and the product has no supported way to create one once a business has
finished onboarding. `device-blocker.spec.ts` records that refusal at the real endpoint. When a
supported path for adding a terminal exists, that spec should be deleted and the sale, inventory,
outbox and idempotency journeys covered here.
