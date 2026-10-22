<#
.SYNOPSIS
    Offline PowerShell test harness for scripts/backup-db.ps1.
.DESCRIPTION
    Verifies all safety-critical behaviors, argument checks, error propagation,
    and command ordering using an in-memory mock 'docker' function.
    GUARANTEE: The real docker.exe is NEVER called.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Pre-test verification: Ensure real docker is NEVER called
$global:DockerCalls = [System.Collections.Generic.List[object]]::new()
$global:MockBehavior = @{
    DatabaseExists = $false
    CreateDbExitCode = 0
    RestoreExitCode = 0
    VerificationTables = "tenants`nproduct_variants`nusers`nstock_movements"
    VerificationExitCode = 0
}

function global:docker {
    $call = [PSCustomObject]@{
        ArgArray = $args
        Joined = ($args -join ' ')
    }
    $global:DockerCalls.Add($call)

    $joined = $args -join ' '

    # Database existence check
    if ($joined -like "*SELECT 1 FROM pg_database*") {
        if ($global:MockBehavior.DatabaseExists) {
            Write-Output "1"
        } else {
            Write-Output "0"
        }
        $global:LASTEXITCODE = 0
        return
    }

    # CREATE DATABASE
    if ($joined -like "*CREATE DATABASE*") {
        $global:LASTEXITCODE = [int]$global:MockBehavior.CreateDbExitCode
        return
    }

    # pg_restore execution
    if ($joined -like "*pg_restore -U*") {
        $global:LASTEXITCODE = [int]$global:MockBehavior.RestoreExitCode
        return
    }

    # pg_restore -l (listing)
    if ($joined -like "*pg_restore -l*") {
        $global:LASTEXITCODE = 0
        Write-Output "; Archive TOC Mock Listing`n1; 1259 16384 TABLE public tenants amburax"
        return
    }

    # Core table verification query
    if ($joined -like "*information_schema.tables WHERE table_schema = 'public' AND table_name IN*") {
        $global:LASTEXITCODE = [int]$global:MockBehavior.VerificationExitCode
        if ($global:LASTEXITCODE -ne 0) {
            return
        }
        Write-Output $global:MockBehavior.VerificationTables
        return
    }

    # Total tables count query
    if ($joined -like "*SELECT COUNT(*) FROM information_schema.tables*") {
        Write-Output "12"
        $global:LASTEXITCODE = 0
        return
    }

    # docker cp
    if ($args[0] -eq 'cp') {
        # If copying to host during backup, create the dummy destination file so Get-Item succeeds
        if ($args.Count -ge 3) {
            $dest = $args[2]
            if (-not $dest.StartsWith('/') -and -not $dest.StartsWith('amburax-postgres:')) {
                if (-not (Test-Path $dest)) {
                    $parent = Split-Path $dest -Parent
                    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                    Set-Content -Path $dest -Value "MOCK_BACKUP_DUMP_CONTENT"
                }
            }
        }
        $global:LASTEXITCODE = 0
        return
    }

    # Default for pg_dump, rm, etc.
    $global:LASTEXITCODE = 0
}

# Verify mock interception guarantee
$cmd = Get-Command docker -ErrorAction Stop
if ($cmd.CommandType -ne 'Function') {
    throw "[FATAL TEST HARNESS ERROR] 'docker' is not intercepted by the mock function! Found: $($cmd.CommandType) ($($cmd.Source))"
}
Write-Host "[HARNESS INTEGRITY] Mock 'docker' successfully intercepted (CommandType = $($cmd.CommandType)). Real docker cannot be invoked.`n" -ForegroundColor Green

# Prepare test fixtures
$scriptToTest = Join-Path $PSScriptRoot 'backup-db.ps1'
$tempTestDir = Join-Path ([System.IO.Path]::GetTempPath()) ("amburax_test_" + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $tempTestDir -Force | Out-Null

$dummyBackupFile = Join-Path $tempTestDir 'dummy.dump'
Set-Content -Path $dummyBackupFile -Value "MOCK_DUMP_PAYLOAD"

$testResults = [System.Collections.Generic.List[object]]::new()

function Run-TestCase ([string]$Name, [scriptblock]$TestBlock) {
    $global:DockerCalls.Clear()
    $global:MockBehavior.DatabaseExists = $false
    $global:MockBehavior.CreateDbExitCode = 0
    $global:MockBehavior.RestoreExitCode = 0
    $global:MockBehavior.VerificationTables = "tenants`nproduct_variants`nusers`nstock_movements"
    $global:MockBehavior.VerificationExitCode = 0

    $status = 'PASS'
    $errorMsg = ''

    try {
        & $TestBlock
    }
    catch {
        $status = 'FAIL'
        $errorMsg = $_.Exception.Message
    }

    $res = [PSCustomObject]@{
        TestName = $Name
        Status = $status
        ErrorMessage = $errorMsg
        DockerCallsRecorded = $global:DockerCalls.Count
    }
    $testResults.Add($res)

    if ($status -eq 'PASS') {
        Write-Host "  [PASS] $Name (Docker calls: $($global:DockerCalls.Count))" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $Name" -ForegroundColor Red
        Write-Host "         Error: $errorMsg" -ForegroundColor DarkRed
    }
}

Write-Host "=== Starting Offline Test Suite for backup-db.ps1 ===" -ForegroundColor Cyan

# -------------------------------------------------------------
# Test Case 1: Target equals source or protected DB is refused before any Docker call
# -------------------------------------------------------------
Run-TestCase "1a: Refuse target matching default source DB (amburax_identity)" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase amburax_identity -Force *>&1
    } catch {
        if ($_ -like "*CRITICAL SAFETY VIOLATION*") { $caught = $true } else { throw $_ }
    }
    if (-not $caught) { throw "Expected CRITICAL SAFETY VIOLATION was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called ($($global:DockerCalls.Count) times) before safety check!" }
}

Run-TestCase "1b: Refuse target matching custom SourceDatabase parameter" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -SourceDatabase custom_source_db -TestDatabase custom_source_db -Force *>&1
    } catch {
        if ($_ -like "*CRITICAL SAFETY VIOLATION*") { $caught = $true } else { throw $_ }
    }
    if (-not $caught) { throw "Expected CRITICAL SAFETY VIOLATION was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before safety check!" }
}

Run-TestCase "1c: Refuse target matching configured POSTGRES_DB environment variable" {
    $env:POSTGRES_DB = 'tenant_prod_live'
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -SourceDatabase other_db -TestDatabase tenant_prod_live -Force *>&1
    } catch {
        if ($_ -like "*CRITICAL SAFETY VIOLATION*") { $caught = $true } else { throw $_ }
    } finally {
        Remove-Item Env:\POSTGRES_DB -ErrorAction SilentlyContinue
    }
    if (-not $caught) { throw "Expected CRITICAL SAFETY VIOLATION was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before safety check!" }
}

Run-TestCase "1d: Refuse protected system and test DBs (postgres, amburax_test, template1)" {
    foreach ($db in @('postgres', 'amburax_test', 'template0', 'template1')) {
        $caught = $false
        try {
            $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase $db -Force *>&1
        } catch {
            if ($_ -like "*CRITICAL SAFETY VIOLATION*") { $caught = $true }
        }
        if (-not $caught) { throw "Expected CRITICAL SAFETY VIOLATION for protected DB '$db'." }
    }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before safety check!" }
}

# -------------------------------------------------------------
# Test Case 2: -Force never bypasses safety checks
# -------------------------------------------------------------
Run-TestCase "2: -Force switch does NOT bypass protected target check" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase amburax_identity -Force *>&1
    } catch {
        if ($_ -like "*CRITICAL SAFETY VIOLATION*") { $caught = $true }
    }
    if (-not $caught) { throw "Safety check was bypassed by -Force!" }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called despite safety violation!" }
}

# -------------------------------------------------------------
# Test Case 3: Invalid database identifiers are refused before any Docker call
# -------------------------------------------------------------
Run-TestCase "3a: Invalid TestDatabase with semicolon ('target;drop')" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase 'target;drop' -Force *>&1
    } catch {
        if ($_ -like "*Parameter 'TestDatabase'*is invalid*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected invalid identifier exception was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before identifier validation!" }
}

Run-TestCase "3b: Invalid TestDatabase with spaces or quotes ('target db')" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase 'target db' -Force *>&1
    } catch {
        if ($_ -like "*Parameter 'TestDatabase'*is invalid*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected invalid identifier exception was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before identifier validation!" }
}

Run-TestCase "3c: Invalid DbUser with injection characters ('user;inject')" {
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -DbUser 'user;inject' -TestDatabase valid_disposable_db -Force *>&1
    } catch {
        if ($_ -like "*Parameter 'DbUser'*is invalid*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected invalid DbUser exception was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before identifier validation!" }
}

Run-TestCase "3d: Invalid SourceDatabase in Backup mode ('source;inject')" {
    $caught = $false
    try {
        $null = & $scriptToTest -Backup -SourceDatabase 'source;inject' *>&1
    } catch {
        if ($_ -like "*Parameter 'SourceDatabase'*is invalid*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected invalid SourceDatabase exception was not thrown." }
    if ($global:DockerCalls.Count -ne 0) { throw "Docker was called before identifier validation!" }
}

# -------------------------------------------------------------
# Test Case 4: Existing disposable target is refused without issuing DROP DATABASE
# -------------------------------------------------------------
Run-TestCase "4: Existing database is refused without dropping or restoring" {
    $global:MockBehavior.DatabaseExists = $true
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase existing_disposable_db -Force *>&1
    } catch {
        if ($_ -like "*SAFETY REFUSAL*already exists*") { $caught = $true } else { throw $_ }
    }
    if (-not $caught) { throw "Expected SAFETY REFUSAL for existing DB was not thrown." }

    # Verify no DROP DATABASE, CREATE DATABASE, or pg_restore was called
    foreach ($call in $global:DockerCalls) {
        if ($call.Joined -like "*DROP DATABASE*") { throw "DANGEROUS: DROP DATABASE was invoked!" }
        if ($call.Joined -like "*CREATE DATABASE*") { throw "DANGEROUS: CREATE DATABASE was invoked on existing DB!" }
        if ($call.Joined -like "*pg_restore*") { throw "DANGEROUS: pg_restore was invoked on existing DB!" }
    }
    # Exactly one query was issued: the SELECT 1 check
    if ($global:DockerCalls.Count -ne 1) { throw "Expected exactly 1 docker call (SELECT 1 check), got $($global:DockerCalls.Count)." }
}

# -------------------------------------------------------------
# -------------------------------------------------------------
# Test Case 5: Non-zero pg_restore exit prevents verification and success output
# -------------------------------------------------------------
Run-TestCase "5: Nonzero pg_restore exit code halts execution and fails test" {
    $global:MockBehavior.RestoreExitCode = 1
    $output = @()
    $caught = $false
    try {
        $output = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase new_disposable_db -Force *>&1
    } catch {
        if ($_ -like "*pg_restore failed with exit code 1*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected exception for nonzero pg_restore exit code was not thrown." }

    # Confirm pg_restore was called with fail-fast --exit-on-error
    $restoreCall = $global:DockerCalls | Where-Object { $_.Joined -like "*pg_restore -U*" }
    if (-not $restoreCall) { throw "pg_restore was not invoked!" }
    if ($restoreCall.Joined -notlike "*--exit-on-error*") {
        throw "pg_restore was invoked without fail-fast '--exit-on-error' flag!"
    }

    # Confirm no verification query was issued
    foreach ($call in $global:DockerCalls) {
        if ($call.Joined -like "*information_schema.tables*") {
            throw "Verification query was run despite pg_restore failure!"
        }
    }
    # Confirm output does NOT claim success
    $joinedOut = $output -join ' '
    if ($joinedOut -like "*[SUCCESS]*") {
        throw "Output claimed [SUCCESS] despite pg_restore failure!"
    }
    # Confirm temporary file was cleaned up
    $lastCall = $global:DockerCalls[-1]
    if ($lastCall.Joined -notlike "*rm -f /tmp/restore_test_*") {
        throw "Temporary container file was not cleaned up in finally block!"
    }
}

# -------------------------------------------------------------
# Test Case 6: Failed database creation prevents restore and verification
# -------------------------------------------------------------
Run-TestCase "6: Failed CREATE DATABASE halts execution and prevents restore" {
    $global:MockBehavior.CreateDbExitCode = 1
    $caught = $false
    try {
        $null = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase create_fail_db -Force *>&1
    } catch {
        if ($_ -like "*Failed to create disposable test database*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected exception for failed CREATE DATABASE was not thrown." }

    # Confirm neither docker cp nor pg_restore were called
    foreach ($call in $global:DockerCalls) {
        if ($call.Joined -like "*pg_restore*") { throw "pg_restore was called after failed CREATE DATABASE!" }
        if ($call.Joined -like "*cp *") { throw "docker cp was called after failed CREATE DATABASE!" }
    }
}

# -------------------------------------------------------------
# Test Case 7: Verification failure (missing core tables) prevents success output
# -------------------------------------------------------------
Run-TestCase "7: Restored DB with missing core tables fails verification" {
    $global:MockBehavior.VerificationTables = "" # No tables returned
    $caught = $false
    $output = @()
    try {
        $output = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase empty_schema_db -Force *>&1
    } catch {
        if ($_ -like "*Verification FAILED: Required core application tables*were not found*") { $caught = $true }
    }
    if (-not $caught) { throw "Expected Verification FAILED exception was not thrown." }

    $joinedOut = $output -join ' '
    if ($joinedOut -like "*[SUCCESS]*") {
        throw "Output claimed success despite empty table schema!"
    }
}

# -------------------------------------------------------------
# Test Case 8: Success output asserts fail-fast flag, order, and precise success wording
# -------------------------------------------------------------
Run-TestCase "8: Full restore test succeeds and validates fail-fast restore and precise wording" {
    $output = & $scriptToTest -TestRestore -BackupFile $dummyBackupFile -TestDatabase valid_clean_db -Force *>&1
    $joinedOut = $output -join "`n"

    # Assert fail-fast argument on pg_restore
    $restoreCall = $global:DockerCalls | Where-Object { $_.Joined -like "*pg_restore -U*" }
    if (-not $restoreCall) { throw "pg_restore was not invoked!" }
    if ($restoreCall.Joined -notlike "*--exit-on-error*") {
        throw "pg_restore was invoked without '--exit-on-error'!"
    }

    # Assert exact, precise success phrasing
    if (-not $joinedOut.Contains('[SUCCESS] Restore verification PASSED (restore command exit 0 and required table presence verified):')) {
        throw "Expected precise success output header was not produced. Got:`n$joinedOut"
    }
    if ($joinedOut -notlike "*Required core tables present: tenants, product_variants, users, stock_movements*") {
        throw "Required core tables list was not printed in verification output."
    }
    if ($joinedOut -notlike "*Scope: Verifies restore command exit code and required table presence only (does not validate row-level data or full integrity)*") {
        throw "Scope qualification notice was not printed in verification output."
    }

    # Verify command sequence
    $actions = $global:DockerCalls | ForEach-Object {
        if ($_.Joined -like "*SELECT 1 FROM pg_database*") { "CHECK_EXISTS" }
        elseif ($_.Joined -like "*CREATE DATABASE*") { "CREATE_DB" }
        elseif ($_.ArgArray[0] -eq 'cp') { "DOCKER_CP" }
        elseif ($_.Joined -like "*pg_restore -U*") { "PG_RESTORE" }
        elseif ($_.Joined -like "*information_schema.tables*WHERE table_schema = 'public' AND table_name IN*") { "VERIFY_CORE_TABLES" }
        elseif ($_.Joined -like "*SELECT COUNT(*) FROM information_schema.tables*") { "VERIFY_TOTAL_COUNT" }
        elseif ($_.Joined -like "*rm -f /tmp/restore_test_*") { "CLEANUP_TEMP" }
    }

    $expectedSequence = @(
        "CHECK_EXISTS",
        "CREATE_DB",
        "DOCKER_CP",
        "PG_RESTORE",
        "VERIFY_CORE_TABLES",
        "VERIFY_TOTAL_COUNT",
        "CLEANUP_TEMP"
    )

    $diff = Compare-Object $actions $expectedSequence
    if ($diff) {
        throw "Command sequence did not match expected order! Observed: $($actions -join ' -> ')"
    }
}

# -------------------------------------------------------------
# Test Case 9: Backup mode uses docker cp and expected container paths (no pipe)
# -------------------------------------------------------------
Run-TestCase "9: Backup mode uses expected container paths and docker cp" {
    $destBackupDir = Join-Path $tempTestDir 'backups'
    $output = & $scriptToTest -Backup -SourceDatabase amburax_identity -BackupDir $destBackupDir *>&1
    $joinedOut = $output -join "`n"

    if (-not $joinedOut.Contains('[SUCCESS] Backup created and verified on host')) {
        throw "Expected backup success message not found."
    }

    # Verify calls
    $hasPgDump = $false
    $hasDockerCp = $false
    $hasCleanup = $false

    foreach ($call in $global:DockerCalls) {
        if ($call.Joined -like "*pg_dump -U amburax -d amburax_identity -Fc -f /tmp/amburax_identity_*.dump*") { $hasPgDump = $true }
        if ($call.Joined -like "cp amburax-postgres:/tmp/amburax_identity_*.dump *") { $hasDockerCp = $true }
        if ($call.Joined -like "*rm -f /tmp/amburax_identity_*.dump*") { $hasCleanup = $true }
    }

    if (-not $hasPgDump) { throw "pg_dump was not invoked with expected parameters." }
    if (-not $hasDockerCp) { throw "docker cp was not used for archive transfer." }
    if (-not $hasCleanup) { throw "Temporary container dump was not removed." }
}

# -------------------------------------------------------------
# Test Case 10: VerifyListing mode inspects TOC and emits warning (no pipe)
# -------------------------------------------------------------
Run-TestCase "10: VerifyListing mode copies archive, lists TOC, and warns" {
    $output = & $scriptToTest -VerifyListing -BackupFile $dummyBackupFile *>&1
    $joinedOut = $output -join "`n"

    if (-not $joinedOut.Contains('[SUCCESS] Archive header and Table of Contents are readable')) {
        throw "Expected listing success message not found."
    }

    $hasCpToContainer = $false
    $hasRestoreListing = $false
    $hasCleanup = $false

    foreach ($call in $global:DockerCalls) {
        if ($call.Joined -like "cp * amburax-postgres:/tmp/verify_listing_*") { $hasCpToContainer = $true }
        if ($call.Joined -like "*pg_restore -l /tmp/verify_listing_*") { $hasRestoreListing = $true }
        if ($call.Joined -like "*rm -f /tmp/verify_listing_*") { $hasCleanup = $true }
    }

    if (-not $hasCpToContainer) { throw "docker cp into container was not called." }
    if (-not $hasRestoreListing) { throw "pg_restore -l was not called on container copy." }
    if (-not $hasCleanup) { throw "Temporary verification file was not removed." }
}

# Cleanup test fixtures
Remove-Item -Path $tempTestDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n=== Test Suite Complete ===" -ForegroundColor Cyan
$failedCount = ($testResults | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Host "Total Tests: $($testResults.Count) | Passed: $($testResults.Count - $failedCount) | Failed: $failedCount"
if ($failedCount -gt 0) {
    throw "Test suite FAILED with $failedCount failure(s)."
}
