import { describe, expect, it } from "vitest";
import { resolveIntegrationDatabaseUrl } from "@/test-integration/databaseUrl";

describe("resolveIntegrationDatabaseUrl", () => {
  describe("approved test database", () => {
    it("accepts a standard postgresql URL targeting amburax_test", () => {
      const input = "postgresql://user:pass@localhost:5432/amburax_test";
      expect(resolveIntegrationDatabaseUrl(input)).toBe(input);
    });

    it("accepts a postgres protocol URL targeting amburax_test", () => {
      const input = "postgres://user:pass@localhost:5432/amburax_test";
      expect(resolveIntegrationDatabaseUrl(input)).toBe(input);
    });

    it("preserves query parameters and URL settings on amburax_test", () => {
      const input = "postgresql://user:pass@localhost:5432/amburax_test?sslmode=disable&schema=public";
      expect(resolveIntegrationDatabaseUrl(input)).toBe(input);
    });
  });

  describe("identity-database rewrite", () => {
    it("rewrites /amburax_identity to /amburax_test", () => {
      const input = "postgresql://user:pass@localhost:5432/amburax_identity";
      const expected = "postgresql://user:pass@localhost:5432/amburax_test";
      expect(resolveIntegrationDatabaseUrl(input)).toBe(expected);
    });

    it("rewrites /amburax_identity to /amburax_test preserving query parameters", () => {
      const input = "postgresql://user:pass@localhost:5432/amburax_identity?schema=public&sslmode=prefer";
      const expected = "postgresql://user:pass@localhost:5432/amburax_test?schema=public&sslmode=prefer";
      expect(resolveIntegrationDatabaseUrl(input)).toBe(expected);
    });
  });

  describe("unexpected database names", () => {
    it("rejects an unapproved database name like amburax_dev or amburax_prod", () => {
      expect(() => {
        resolveIntegrationDatabaseUrl("postgresql://user:pass@localhost:5432/amburax_dev");
      }).toThrowError(/Integration tests can only target the 'amburax_test' database, but the resolved target database is 'amburax_dev'/);

      expect(() => {
        resolveIntegrationDatabaseUrl("postgresql://user:pass@localhost:5432/production_db");
      }).toThrowError(/Integration tests can only target the 'amburax_test' database, but the resolved target database is 'production_db'/);
    });

    it("does not match partial prefix names like amburax_identity_dev and rejects them", () => {
      expect(() => {
        resolveIntegrationDatabaseUrl("postgresql://user:pass@localhost:5432/amburax_identity_dev");
      }).toThrowError(/Integration tests can only target the 'amburax_test' database, but the resolved target database is 'amburax_identity_dev'/);
    });

    it("rejects a URL with missing database name", () => {
      expect(() => {
        resolveIntegrationDatabaseUrl("postgresql://user:pass@localhost:5432/");
      }).toThrowError(/Integration tests can only target the 'amburax_test' database, but the resolved target database is unspecified/);

      expect(() => {
        resolveIntegrationDatabaseUrl("postgresql://user:pass@localhost:5432");
      }).toThrowError(/Integration tests can only target the 'amburax_test' database, but the resolved target database is unspecified/);
    });

    it("does not expose sensitive credentials in error messages", () => {
      const secretPassword = "superSecretPassword123!";
      try {
        resolveIntegrationDatabaseUrl(`postgresql://sensitive_user:${secretPassword}@localhost:5432/production_db`);
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).not.toContain(secretPassword);
        expect((err as Error).message).not.toContain("sensitive_user");
      }
    });
  });

  describe("malformed or missing configuration", () => {
    it("rejects null, undefined, empty, or whitespace strings", () => {
      expect(() => resolveIntegrationDatabaseUrl(null)).toThrowError(/DATABASE_URL is missing or empty/);
      expect(() => resolveIntegrationDatabaseUrl(undefined)).toThrowError(/DATABASE_URL is missing or empty/);
      expect(() => resolveIntegrationDatabaseUrl("")).toThrowError(/DATABASE_URL is missing or empty/);
      expect(() => resolveIntegrationDatabaseUrl("   ")).toThrowError(/DATABASE_URL is missing or empty/);
    });

    it("rejects malformed URLs without leaking credentials", () => {
      expect(() => resolveIntegrationDatabaseUrl("not-a-valid-url")).toThrowError(/DATABASE_URL is malformed/);

      const secretPassword = "ultraSecretPassword456!";
      try {
        resolveIntegrationDatabaseUrl(`postgresql://user:${secretPassword}@[invalid-ipv6/`);
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).not.toContain(secretPassword);
      }
    });

    it("rejects non-Postgres protocols", () => {
      expect(() => {
        resolveIntegrationDatabaseUrl("mysql://user:pass@localhost:3306/amburax_test");
      }).toThrowError(/DATABASE_URL must use 'postgresql:' or 'postgres:' protocol/);
    });
  });
});
