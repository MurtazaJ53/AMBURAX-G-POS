/**
 * AMBURAX G-POS — Automated License Compliance & SBOM Audit Script
 *
 * Verifies all dependencies across root and workspaces against the organization's
 * License Policy. Reconciles both locally installed node_modules and package-lock.json
 * (including cross-platform optional binaries).
 * Fails closed (exit code 1) on any prohibited, ambiguous, or unapproved license.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface PackageInfo {
  name: string;
  version: string;
  license: string;
  location: string;
  scope: "production" | "development" | "optional";
}

export interface AuditResult {
  totalPackages: number;
  licenseCounts: Record<string, number>;
  permittedCount: number;
  exceptionCount: number;
  prohibitedCount: number;
  violations: Array<{ name: string; version: string; license: string; reason: string }>;
  exceptionsApproved: Array<{ name: string; version: string; license: string; reason: string }>;
}

export const POLICY = {
  PERMITTED: new Set([
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "CC0-1.0",
    "CC-BY-4.0",
    "Python-2.0",
    "Unlicense",
    "BlueOak-1.0.0",
  ]),
  PROHIBITED_COPYLEFT: [
    "AGPL-1.0", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
    "GPL-1.0", "GPL-2.0", "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later",
    "SSPL-1.0",
  ],
  EXCEPTIONS: new Map<string, { approvedLicense: string; justification: string }>([
    [
      "@img/sharp-win32-x64",
      {
        approvedLicense: "Apache-2.0 AND LGPL-3.0-or-later",
        justification: "Precompiled native runtime binary for Next.js image optimization (Windows x64). Dynamically linked; not statically compiled into proprietary source.",
      },
    ],
    [
      "@img/sharp-win32-ia32",
      {
        approvedLicense: "Apache-2.0 AND LGPL-3.0-or-later",
        justification: "Precompiled native runtime binary for Next.js image optimization (Windows ia32). Dynamically linked.",
      },
    ],
    [
      "@img/sharp-win32-arm64",
      {
        approvedLicense: "Apache-2.0 AND LGPL-3.0-or-later",
        justification: "Precompiled native runtime binary for Next.js image optimization (Windows arm64). Dynamically linked.",
      },
    ],
    [
      "@img/sharp-wasm32",
      {
        approvedLicense: "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
        justification: "Wasm binary for image optimization. Dynamically loaded; not compiled into proprietary source.",
      },
    ],
    [
      "axe-core",
      {
        approvedLicense: "MPL-2.0",
        justification: "Development/testing dependency for accessibility linting (eslint-plugin-jsx-a11y). Never shipped in production bundles.",
      },
    ],
    // Platform-specific optional libvips binaries (Linux/macOS platforms)
    [
      "@img/sharp-libvips-darwin-arm64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for macOS arm64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-darwin-x64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for macOS x64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-arm",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux arm. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-arm64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux arm64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-ppc64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux ppc64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-riscv64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux riscv64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-s390x",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux s390x. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linux-x64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux x64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linuxmusl-arm64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux musl arm64. Dynamically linked; optional platform runtime.",
      },
    ],
    [
      "@img/sharp-libvips-linuxmusl-x64",
      {
        approvedLicense: "LGPL-3.0-or-later",
        justification: "Precompiled native libvips binary for Linux musl x64. Dynamically linked; optional platform runtime.",
      },
    ],
  ]),
};

function scanNodeModules(dir: string, packages = new Map<string, PackageInfo>()): Map<string, PackageInfo> {
  if (!fs.existsSync(dir)) return packages;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith("@")) {
        scanNodeModules(fullPath, packages);
      } else {
        const pkgJsonPath = path.join(fullPath, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const raw = fs.readFileSync(pkgJsonPath, "utf8");
            const data = JSON.parse(raw);
            const key = `${data.name}@${data.version}`;
            let license = data.license || (data.licenses ? JSON.stringify(data.licenses) : "UNKNOWN");
            if (typeof license === "object") license = license.type || JSON.stringify(license);

            packages.set(key, {
              name: data.name,
              version: data.version,
              license: String(license).trim(),
              location: fullPath,
              scope: "production",
            });
          } catch {
            // Ignored invalid JSON
          }
        }
      }
    }
  }
  return packages;
}

function reconcileWithLockfile(rootDir: string, packages: Map<string, PackageInfo>): Map<string, PackageInfo> {
  const lockfilePath = path.join(rootDir, "package-lock.json");
  if (!fs.existsSync(lockfilePath)) return packages;

  try {
    const raw = fs.readFileSync(lockfilePath, "utf8");
    const lock = JSON.parse(raw);
    const pkgs = lock.packages || {};

    for (const [pkgPath, info] of Object.entries<any>(pkgs)) {
      if (!pkgPath || pkgPath === "apps/web" || pkgPath === "node_modules/@amburax/web") continue;

      const name = pkgPath.replace(/^.*node_modules\//, "");
      const version = info.version || "0.0.0";
      const key = `${name}@${version}`;

      if (!packages.has(key)) {
        let license = info.license || "UNKNOWN";
        if (typeof license === "object") license = license.type || JSON.stringify(license);

        packages.set(key, {
          name,
          version,
          license: String(license).trim(),
          location: pkgPath,
          scope: info.dev ? "development" : info.optional ? "optional" : "production",
        });
      }
    }
  } catch (err) {
    console.error("[LICENSE-AUDIT] Warning: Unable to parse package-lock.json", err);
  }

  return packages;
}

export function runLicenseAudit(rootDir: string): AuditResult {
  const rootNm = path.join(rootDir, "node_modules");
  const webNm = path.join(rootDir, "apps", "web", "node_modules");

  const packages = scanNodeModules(rootNm);
  scanNodeModules(webNm, packages);
  reconcileWithLockfile(rootDir, packages);

  const licenseCounts: Record<string, number> = {};
  const violations: AuditResult["violations"] = [];
  const exceptionsApproved: AuditResult["exceptionsApproved"] = [];
  let permittedCount = 0;

  for (const [, pkg] of packages) {
    const lic = pkg.license;
    licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;

    if (POLICY.PERMITTED.has(lic)) {
      permittedCount++;
      continue;
    }

    // Check exceptions register
    const exception = POLICY.EXCEPTIONS.get(pkg.name);
    if (exception && exception.approvedLicense === lic) {
      exceptionsApproved.push({
        name: pkg.name,
        version: pkg.version,
        license: lic,
        reason: exception.justification,
      });
      continue;
    }

    // Check prohibited
    const isProhibited = POLICY.PROHIBITED_COPYLEFT.some((proh) =>
      lic.toUpperCase().includes(proh.toUpperCase())
    );

    if (isProhibited || lic === "UNKNOWN") {
      violations.push({
        name: pkg.name,
        version: pkg.version,
        license: lic,
        reason: isProhibited ? "Strict copyleft license prohibited by policy" : "Unknown or missing license",
      });
    } else {
      violations.push({
        name: pkg.name,
        version: pkg.version,
        license: lic,
        reason: "Unreviewed license requiring explicit policy exception",
      });
    }
  }

  return {
    totalPackages: packages.size,
    licenseCounts,
    permittedCount,
    exceptionCount: exceptionsApproved.length,
    prohibitedCount: violations.length,
    violations,
    exceptionsApproved,
  };
}

// Standalone CLI execution
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const repoRoot = path.resolve(process.cwd());
  console.log(`[LICENSE-AUDIT] Running compliance scan across ${repoRoot}...`);
  const result = runLicenseAudit(repoRoot);

  console.log(`[LICENSE-AUDIT] Total Packages Scanned (Disk + Lockfile): ${result.totalPackages}`);
  console.log(`[LICENSE-AUDIT] Permitted: ${result.permittedCount}`);
  console.log(`[LICENSE-AUDIT] Approved Exceptions: ${result.exceptionCount}`);
  console.log(`[LICENSE-AUDIT] Violations: ${result.prohibitedCount}`);

  if (result.violations.length > 0) {
    console.error("\n❌ [FAIL-CLOSED] Prohibited or unapproved licenses found:");
    for (const v of result.violations) {
      console.error(`  - ${v.name}@${v.version} [${v.license}]: ${v.reason}`);
    }
    process.exit(1);
  }

  console.log("\n✅ [PASS] All installed and lockfile software packages conform to AMBURAX License Policy.");
  process.exit(0);
}
