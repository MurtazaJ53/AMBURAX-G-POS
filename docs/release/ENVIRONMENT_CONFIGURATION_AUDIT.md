# AMBURAX G-POS — Environment Configuration Audit

| Metadata | Details |
| :--- | :--- |
| **System** | AMBURAX G-POS |
| **Audit Document** | AUD-CFG-001 |
| **Date** | October 19, 2026 |
| **Target Platforms** | Local, Staging Sandbox, Production |

---

## 1. Audit Methodology & Security Rules

- **Zero-Exposure Policy**: Variable names, schemas, types, and fallback defaults are documented. Secret keys, credentials, tokens, or live passwords are never printed or committed.
- **Fail-Closed Validation**: The application enforces runtime schema validation via `apps/web/src/lib/env.ts` on server initialization. Missing required variables prevent process launch.

---

## 2. Environment Variables Specification

### Core Runtime & Database
| Variable Name | Required | Default / Fallback | Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Yes | `development` | Set to `production` in Staging and Production. |
| `PORT` | No | `3000` (`3001` in PM2) | Listening port for the Next.js HTTP server. |
| `DATABASE_URL` | **Yes** | None (Fails closed) | PostgreSQL connection string with username, password, host, port, database, and schema. |
| `APP_BASE_URL` | No | `http://localhost:3000` | Canonical external URL used for generating links (e.g. `https://staging-pos.amburax.com`). |

### Session & Identity Security
| Variable Name | Required | Default / Fallback | Description |
| :--- | :---: | :--- | :--- |
| `SESSION_COOKIE_NAME` | No | `amburax_session` | Name of the HttpOnly, Secure, SameSite session cookie. |
| `SESSION_TTL_HOURS` | No | `12` | Active user session duration before re-authentication is required. |
| `LOGIN_MAX_ATTEMPTS` | No | `5` | Maximum consecutive failed login attempts before temporary lockout. |
| `LOGIN_LOCKOUT_MINUTES` | No | `15` | Lockout window duration in minutes after exceeding failed attempts. |
| `OTP_LENGTH` | No | `6` | Number of digits in multi-factor authentication tokens (4 to 8). |
| `OTP_TTL_MINUTES` | No | `5` | Validity lifespan of an issued OTP token. |
| `OTP_MAX_ATTEMPTS` | No | `5` | Maximum validation attempts allowed for a given OTP challenge. |
| `OTP_MAX_RESENDS` | No | `5` | Maximum token resends allowed per challenge lifecycle. |
| `OTP_RESEND_COOLDOWN_SECONDS` | No | `30` | Cooldown period between consecutive OTP resend requests. |
| `MFA_CHALLENGE_MAX_AGE_MINUTES` | No | `30` | Maximum lifetime of an uncompleted MFA challenge step. |

### Development vs Production Safety Switches
| Variable Name | Required | Default / Fallback | Staging / Prod Enforcement |
| :--- | :---: | :--- | :--- |
| `DEV_OTP_ECHO` | No | `false` | **Forced to `false`** when `NODE_ENV === "production"`. Prevents OTP leakage in response envelopes. |
| `DEV_RESET_LINK_ECHO` | No | `false` | **Forced to `false`** when `NODE_ENV === "production"`. Prevents password reset token echo. |
| `DEV_INVITE_LINK_ECHO` | No | `false` | **Forced to `false`** when `NODE_ENV === "production"`. Prevents staff invitation token echo. |

### Transactional Outbox & Background Worker
| Variable Name | Required | Default / Fallback | Description |
| :--- | :---: | :--- | :--- |
| `OUTBOX_TRANSPORT` | No | `none` | Options: `erpnext` (live API push), `console` (dev-only stand-in), `none` (accumulate pending). |
| `OUTBOX_POLL_INTERVAL_MS`| No | `3000` | Polling frequency for the outbox worker loop when idle. |
| `OUTBOX_BATCH_SIZE` | No | `25` | Maximum number of events claimed per transaction batch using `SKIP LOCKED`. |

### ERPNext Adapter Credential Provider (`EnvErpCredentialProvider`)
| Variable Pattern | Required | Format / Description |
| :--- | :---: | :--- |
| `ERP_SITE_<SLUG>_URL` | If using ERP | Base URL for the Frappe/ERPNext site (e.g. `ERP_SITE_DEMO_URL=https://demo.erp.internal`). |
| `ERP_SITE_<SLUG>_KEY` | If using ERP | API key generated in ERPNext User Settings. |
| `ERP_SITE_<SLUG>_SECRET`| If using ERP | API secret generated in ERPNext User Settings. |

---

## 3. Configuration Safety Verification Checklist

- [x] All production configurations use strong, non-default cryptographic passwords for database access.
- [x] `DEV_OTP_ECHO`, `DEV_RESET_LINK_ECHO`, and `DEV_INVITE_LINK_ECHO` cannot be enabled in production environments due to schema-level overrides in `apps/web/src/lib/env.ts`.
- [x] Missing `DATABASE_URL` halts boot immediately with descriptive validation errors rather than attempting silent connection to localhost.
- [x] Outbox worker refuses to start with code 78 (`EX_CONFIG`) if `OUTBOX_TRANSPORT=console` is supplied under `NODE_ENV=production`.
- [x] ERP credentials are never stored in PostgreSQL tables; resolving an unconfigured site throws a descriptive error naming the missing site without echoing credential tokens.
