DO $$
DECLARE
    duplicate_record RECORD;
    duplicate_count INTEGER := 0;
    dup_details TEXT := '';
BEGIN
    -- Check for duplicate non-null erpnextCompanyId values
    FOR duplicate_record IN
        SELECT "erpnextCompanyId", COUNT(*) as cnt
        FROM "tenants"
        WHERE "erpnextCompanyId" IS NOT NULL
        GROUP BY "erpnextCompanyId"
        HAVING COUNT(*) > 1
    LOOP
        duplicate_count := duplicate_count + 1;
        dup_details := dup_details || 'Company: "' || duplicate_record."erpnextCompanyId" || '" shared by ' || duplicate_record.cnt || ' tenants; ';
    END LOOP;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION HALTED: Found % duplicate erpnextCompanyId groups across tenants! Details: %', duplicate_count, dup_details;
    END IF;

    RAISE NOTICE 'SAFETY CHECK PASSED: Zero duplicate erpnextCompanyId values found across tenants.';
END $$;

-- Create partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_erpnextCompanyId_key" 
ON "tenants"("erpnextCompanyId") 
WHERE "erpnextCompanyId" IS NOT NULL;
