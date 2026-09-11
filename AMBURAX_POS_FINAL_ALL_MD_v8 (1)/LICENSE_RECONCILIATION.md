# AMBURAX POS — LICENSE RECONCILIATION

Last reconciled against the actual repository: **2026-09-11**
Method: license field read from every installed package manifest under
`node_modules/` and `apps/web/node_modules/` (144 packages).

> These are engineering observations, not legal conclusions. Anything marked
> REVIEW needs counsel, not a developer's judgement.

---

## 1. Standing rules (unchanged)

Known baseline:
- Frappe Framework: MIT
- ERPNext: GPLv3
- Other Frappe apps may use different licenses.

Rules:
- proprietary AMBURAX code remains separately owned/licensed
- ERPNext-derived code retains applicable GPL obligations
- no copied ERPNext source/frontend in proprietary packages
- retain applicable notices
- unknown license = BLOCKED
- AGPL/copyleft dependency = architecture/legal review
- every dependency enters OSS inventory/SBOM
- model/provider, marketplace, payment, fonts/icons and other assets require separate terms review

API separation is not itself a legal determination.

Commercial model: SaaS-first. Self-hosted distribution requires a separate legal/distribution review.

---

## 2. ERPNext / Frappe position — as verified, not as assumed

**No ERPNext or Frappe code is present in this repository.** See
ERPNext_VERSION_PIN.md for the evidence. The GPLv3 baseline above is therefore
currently **inert**: there is no GPL-licensed code in the tree, and no GPL
obligation has yet attached to anything.

Verified by inspection:

| Check | Result |
|---|---|
| ERPNext source copied into the repo | **None found** |
| ERPNext/Frappe frontend assets copied | **None found** |
| Direct ERPNext/Frappe imports in proprietary packages | **None found** |
| Frappe apps installed | **None** |
| Python/bench toolchain present | **None** |

The AMBURAX frontend is independently implemented (Next.js/React/Tailwind) with
no ERPNext-derived markup, CSS or JavaScript.

**This is the cleanest possible starting position, and it is also the fragile
moment.** The obligations become real on the first ERPNext commit, and the
decision that determines them — where that code lives — is still ahead of us, not
behind us.

---

## 3. Third-party dependency inventory (actual)

144 installed packages. Full license tally:

| License | Count | Class |
|---|---|---|
| MIT | 115 | Permissive |
| Apache-2.0 | 15 | Permissive |
| ISC | 7 | Permissive |
| MPL-2.0 | 2 | Weak copyleft (file-level) |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 | Mixed, weak copyleft |
| Apache-2.0 AND LGPL-3.0-or-later | 1 | Mixed, weak copyleft |
| CC-BY-4.0 | 1 | Attribution (data/asset) |
| BSD-3-Clause | 1 | Permissive |
| 0BSD | 1 | Permissive |

### UNKNOWN licenses: **ZERO**

No package is BLOCKED under the unknown-license rule.

### GPL / AGPL: **ZERO**

No strong-copyleft dependency is present.

### Weak-copyleft packages requiring a recorded position (4)

| Package | License | Role | Engineering assessment |
|---|---|---|---|
| `lightningcss` | MPL-2.0 | CSS transform, Tailwind/Next build-time | File-level copyleft. Unmodified, used as a tool. No proprietary file is a derivative. |
| `lightningcss-win32-x64-msvc` | MPL-2.0 | Native binary for the above | Same. |
| `@img/sharp-wasm32` | Apache-2.0 AND LGPL-3.0-or-later AND MIT | Next.js image optimization | LGPL component is dynamically loaded, not statically linked into proprietary source. |
| `@img/sharp-win32-x64` | Apache-2.0 AND LGPL-3.0-or-later | Native binary for the above | Same. |

**Engineering risk: LOW** for the current SaaS-first model — none of these is
modified, and none is linked into AMBURAX proprietary source.

**This changes if self-hosted distribution is ever pursued.** MPL-2.0 and LGPL
obligations differ materially between "operating a service" and "distributing a
binary". That review is deferred, not waived.

### Direct dependencies — exact versions

| Package | Version | License |
|---|---|---|
| next | 16.3.4 | MIT |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| @prisma/client | 5.22.0 | Apache-2.0 |
| prisma | 5.22.0 | Apache-2.0 |
| zod | 3.25.76 | MIT |
| bcryptjs | 2.4.3 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| tailwindcss | 3.4.19 | MIT |
| vitest | 5.0.0 | MIT |
| tsx | 4.23.13 | MIT |
| autoprefixer | 10.5.5 | MIT |
| postcss | 8.5.28 | MIT |

---

## 4. Code separation status

| Category | Location | Status |
|---|---|---|
| AMBURAX proprietary | `apps/web/src/**` (about 75 files) | Clean. No ERPNext-derived code. |
| ERPNext / Frappe | — | **Does not exist in this repository.** |
| `amburax_erp` customization layer | — | **Does not exist.** Not yet needed; required before the first ERPNext customization. |
| Third-party | `node_modules/` | 144 packages, all licenses known. |

---

## 5. Not yet reviewed — deferred, not cleared

The standing rules require separate terms review for several asset classes. None
is present in the repository yet, so none has been reviewed:

- AI model/provider terms — no AI provider is integrated
- Marketplace API terms (Shopify, Amazon, Flipkart, Meesho, IndiaMART) — none integrated
- Payment provider terms — no payment provider is integrated
- Fonts and icons — the UI currently uses system font stacks and inline SVG only; no licensed font or icon set is bundled

Each becomes a gate at the moment of first integration.

---

## 6. Actions

| Id | Action | Priority |
|---|---|---|
| L-1 | Produce a generated SBOM as a build artifact rather than an ad-hoc audit | P3-2 |
| L-2 | Record the MPL/LGPL position formally before any self-hosted distribution | Deferred until distribution is pursued |
| L-3 | Re-run this reconciliation at the first ERPNext commit — that is when GPLv3 becomes live | Mandatory gate |
| L-4 | Re-run at every dependency addition; unknown license remains BLOCKED | Continuous |

**Current verdict: no license blocker. No dependency is BLOCKED. The GPL question
is genuinely open rather than resolved, because the GPL code has not arrived yet.**
