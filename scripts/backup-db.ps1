<#
.SYNOPSIS
    Windows/PowerShell-compatible backup and restore verification for AMBURAX POS PostgreSQL.
.DESCRIPTION
    Provides procedures to:
      1. Create a timestamped custom-format pg_dump from the configured Docker container.
      2. Verify archive table-of-contents readability using container-side pg_restore -l.
      3. Perform a real test restore into a separate, non-existent disposable test database with strict safety guards.
.NOTES
    Does not run automatically. Execute manually as an operator.
#>

[CmdletBinding(DefaultParameterSetName = 'Backup')]
param(
    [Parameter(ParameterSetName = 'Backup')]
    [Parameter(ParameterSetName = 'VerifyListing')]
    [Parameter(ParameterSetName = 'TestRestore')]
    [string]$ContainerName = 'amburax-postgres',

    [Parameter(ParameterSetName = 'Backup')]
    [Parameter(ParameterSetName = 'TestRestore')]
    [string]$DbUser = $(if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'amburax' }),

    [Parameter(ParameterSetName = 'Backup')]
    [Parameter(ParameterSetName = 'TestRestore')]
    [string]$SourceDatabase = $(if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'amburax_identity' }),

    [Parameter(ParameterSetName = 'Backup')]
    [string]$BackupDir = '',

    [Parameter(Mandatory = $true, ParameterSetName = 'VerifyListing')]
    [Parameter(Mandatory = $true, ParameterSetName = 'TestRestore')]
    [string]$BackupFile,

    [Parameter(Mandatory = $true, ParameterSetName = 'TestRestore')]
    [string]$TestDatabase,

    [Parameter(ParameterSetName = 'Backup')]
    [switch]$Backup,

    [Parameter(ParameterSetName = 'VerifyListing')]
    [switch]$VerifyListing,

    [Parameter(ParameterSetName = 'TestRestore')]
    [switch]$TestRestore,

    [Parameter(ParameterSetName = 'TestRestore')]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Assert-ValidIdentifier ([string]$Value, [string]$ParameterName) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "Parameter '$ParameterName' must not be empty or whitespace."
    }
    if ($Value -notmatch '^[a-zA-Z0-9_]+$') {
        throw "Parameter '$ParameterName' value '$Value' is invalid. Must contain only alphanumeric characters and underscores."
    }
}

function Assert-ValidContainerName ([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "ContainerName must not be empty or whitespace."
    }
    if ($Value -notmatch '^[a-zA-Z0-9_\-]+$') {
        throw "ContainerName '$Value' is invalid. Must contain only alphanumeric characters, underscores, and dashes."
    }
}

function Get-ResolvedBackupPath ([string]$Path) {
    if (-not (Test-Path -Path $Path)) {
        throw "Backup file not found at path: '$Path'"
    }
    return (Resolve-Path -Path $Path).ProviderPath
}

# Validate common identifiers
Assert-ValidContainerName -Value $ContainerName
Assert-ValidIdentifier -Value $DbUser -ParameterName 'DbUser'

# --- ACTION 1: CREATE BACKUP ---
if ($PSCmdlet.ParameterSetName -eq 'Backup' -or $Backup) {
    Assert-ValidIdentifier -Value $SourceDatabase -ParameterName 'SourceDatabase'

    Write-Host "=== AMBURAX POS: Database Backup ===" -ForegroundColor Cyan
    Write-Host "Container:       $ContainerName"
    Write-Host "Source Database: $SourceDatabase"
    Write-Host "Database User:   $DbUser"
    if ([string]::IsNullOrWhiteSpace($BackupDir)) {
        $baseDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
        $BackupDir = Join-Path -Path $baseDir -ChildPath '..\backups'
    }

    # Ensure host backup directory exists
    if (-not (Test-Path -Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    $resolvedBackupDir = (Resolve-Path -Path $BackupDir).ProviderPath

    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $dumpFileName = if ($SourceDatabase.StartsWith('amburax_')) { "${SourceDatabase}_${timestamp}.dump" } else { "amburax_${SourceDatabase}_${timestamp}.dump" }
    $containerTempDump = "/tmp/$dumpFileName"
    $hostDestination = Join-Path -Path $resolvedBackupDir -ChildPath $dumpFileName

    Write-Host "`nStep 1/3: Creating custom-format pg_dump inside container..." -ForegroundColor Yellow
    docker exec $ContainerName pg_dump -U $DbUser -d $SourceDatabase -Fc -f $containerTempDump
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed inside container '$ContainerName' with exit code $LASTEXITCODE."
    }

    $copySuccess = $false
    try {
        Write-Host "Step 2/3: Copying dump to host ($hostDestination)..." -ForegroundColor Yellow
        docker cp "${ContainerName}:${containerTempDump}" $hostDestination
        if ($LASTEXITCODE -ne 0) {
            throw "docker cp failed to copy dump to host with exit code $LASTEXITCODE."
        }
        $copySuccess = $true
    }
    finally {
        Write-Host "Step 3/3: Cleaning temporary container dump file..." -ForegroundColor Yellow
        try {
            docker exec $ContainerName rm -f $containerTempDump
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Failed to cleanly remove container temp file '$containerTempDump' (exit code $LASTEXITCODE)."
            }
        }
        catch {
            Write-Warning "Error during container temp file removal: $_"
        }
    }

    if (-not $copySuccess) {
        throw "Backup failed before host copy completed."
    }

    Write-Host "`n[SUCCESS] Backup created and verified on host:" -ForegroundColor Green
    Write-Host "Path: $hostDestination" -ForegroundColor Green
    $fileSize = if (Test-Path $hostDestination) { (Get-Item $hostDestination).Length } else { 0 }
    Write-Host "Size: $fileSize bytes`n"
}

# --- ACTION 2: VERIFY ARCHIVE READABILITY (TOC LISTING) ---
if ($PSCmdlet.ParameterSetName -eq 'VerifyListing' -or $VerifyListing) {
    Write-Host "=== AMBURAX POS: Archive Readability Verification ===" -ForegroundColor Cyan
    $fullBackupPath = Get-ResolvedBackupPath -Path $BackupFile
    Write-Host "Target Host File: $fullBackupPath"
    Write-Host "Target Container: $ContainerName"

    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $tempContainerVerifyFile = "/tmp/verify_listing_${timestamp}_$([System.IO.Path]::GetFileName($fullBackupPath))"

    try {
        Write-Host "`nStep 1/2: Copying host archive into container for TOC inspection..." -ForegroundColor Yellow
        docker cp $fullBackupPath "${ContainerName}:${tempContainerVerifyFile}"
        if ($LASTEXITCODE -ne 0) {
            throw "docker cp failed to copy archive to container with exit code $LASTEXITCODE."
        }

        Write-Host "Step 2/2: Executing pg_restore -l (Table of Contents)..." -ForegroundColor Yellow
        docker exec $ContainerName pg_restore -l $tempContainerVerifyFile
        if ($LASTEXITCODE -ne 0) {
            throw "pg_restore -l failed with exit code $LASTEXITCODE. The archive is unreadable or corrupted."
        }

        Write-Host "`n[SUCCESS] Archive header and Table of Contents are readable." -ForegroundColor Green
        Write-Warning "Archive listing (pg_restore -l) proves readability of archive metadata ONLY.`nAn untested backup is NOT a proven backup. Run a test restore against a separate disposable test database (-TestRestore) to verify real restoration."
    }
    finally {
        try {
            docker exec $ContainerName rm -f $tempContainerVerifyFile
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Failed to cleanly remove temporary verification file in container (exit code $LASTEXITCODE)."
            }
        }
        catch {
            Write-Warning "Error removing temporary verification file in container: $_"
        }
    }
}

# --- ACTION 3: TEST RESTORE AGAINST DISPOSABLE DATABASE ---
if ($PSCmdlet.ParameterSetName -eq 'TestRestore' -or $TestRestore) {
    Write-Host "=== AMBURAX POS: Disposable Test Restore Verification ===" -ForegroundColor Cyan
    Assert-ValidIdentifier -Value $SourceDatabase -ParameterName 'SourceDatabase'
    Assert-ValidIdentifier -Value $TestDatabase -ParameterName 'TestDatabase'
    $fullBackupPath = Get-ResolvedBackupPath -Path $BackupFile

    # 1. HARD SAFEGUARD: Build dynamic set of protected databases
    $protectedDatabases = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $protectedDatabases.Add('postgres') | Out-Null
    $protectedDatabases.Add('template0') | Out-Null
    $protectedDatabases.Add('template1') | Out-Null
    $protectedDatabases.Add('amburax_identity') | Out-Null
    $protectedDatabases.Add('amburax_test') | Out-Null
    $protectedDatabases.Add($SourceDatabase) | Out-Null

    if ($env:POSTGRES_DB) {
        $protectedDatabases.Add($env:POSTGRES_DB.Trim()) | Out-Null
    }

    if ($protectedDatabases.Contains($TestDatabase)) {
        throw "[CRITICAL SAFETY VIOLATION] Target database '$TestDatabase' is a protected or active source database. Refusing to restore over source, production, or standard test databases. Safety checks cannot be bypassed by -Force. You must specify a separate disposable database name (e.g., 'amburax_restore_verification')."
    }

    # 2. HARD SAFEGUARD: Refuse already-existing target databases (never auto-drop)
    Write-Host "Checking if target database '$TestDatabase' already exists..." -ForegroundColor Yellow
    $dbExistsOutput = docker exec $ContainerName psql -U $DbUser -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$TestDatabase';"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query pg_database in container '$ContainerName' with exit code $LASTEXITCODE."
    }

    if ($dbExistsOutput -and $dbExistsOutput.ToString().Trim() -eq '1') {
        throw "[SAFETY REFUSAL] Database '$TestDatabase' already exists in container '$ContainerName'. To prevent accidental data destruction, this script will NOT drop or overwrite existing databases. Please specify a new, non-existent disposable database name (e.g., 'amburax_restore_test_$(Get-Date -Format 'yyyyMMddHHmmss')'), or manually drop it after verifying it is safe to remove via: docker exec $ContainerName psql -U $DbUser -d postgres -c `"DROP DATABASE `\`"$TestDatabase`\`";`""
    }

    Write-Host "Archive File:      $fullBackupPath"
    Write-Host "Container:         $ContainerName"
    Write-Host "Source Database:   $SourceDatabase"
    Write-Host "Database User:     $DbUser"
    Write-Host "TARGET DATABASE:   $TestDatabase (NEW DISPOSABLE TARGET)" -ForegroundColor Magenta

    # 3. Interactive confirmation
    if (-not $Force) {
        Write-Host "`n[SAFETY CONFIRMATION REQUIRED]" -ForegroundColor Yellow
        Write-Host "This operation will CREATE disposable database '$TestDatabase' and restore '$fullBackupPath' into it."
        $confirmation = Read-Host "Type '$TestDatabase' exactly to proceed"
        if ($confirmation -ne $TestDatabase) {
            Write-Host "Aborted. Confirmation did not match." -ForegroundColor Red
            return
        }
    }

    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $tempContainerRestoreFile = "/tmp/restore_test_${timestamp}_$([System.IO.Path]::GetFileName($fullBackupPath))"

    try {
        Write-Host "`nStep 1/4: Creating new disposable database '$TestDatabase' in container..." -ForegroundColor Yellow
        docker exec $ContainerName psql -U $DbUser -d postgres -c "CREATE DATABASE `"$TestDatabase`";"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create disposable test database '$TestDatabase' (exit code $LASTEXITCODE)."
        }

        Write-Host "Step 2/4: Copying host archive into container..." -ForegroundColor Yellow
        docker cp $fullBackupPath "${ContainerName}:${tempContainerRestoreFile}"
        if ($LASTEXITCODE -ne 0) {
            throw "docker cp failed with exit code $LASTEXITCODE."
        }

        Write-Host "Step 3/4: Executing real restore into disposable database '$TestDatabase'..." -ForegroundColor Yellow
        docker exec $ContainerName pg_restore -U $DbUser -d $TestDatabase --exit-on-error --no-owner --no-privileges $tempContainerRestoreFile
        if ($LASTEXITCODE -ne 0) {
            throw "pg_restore failed with exit code $LASTEXITCODE. Restore test did NOT succeed."
        }
        Write-Host "pg_restore completed with exit code 0." -ForegroundColor Green

        Write-Host "Step 4/4: Verifying required table presence in '$TestDatabase'..." -ForegroundColor Yellow
        $verifyQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('tenants', 'product_variants', 'users', 'stock_movements');"
        $foundTablesOutput = docker exec $ContainerName psql -U $DbUser -d $TestDatabase -t -A -c $verifyQuery
        if ($LASTEXITCODE -ne 0) {
            throw "Verification query failed inside '$TestDatabase' with exit code $LASTEXITCODE."
        }

        $foundTables = $foundTablesOutput -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        if ($foundTables.Count -eq 0) {
            throw "Verification FAILED: Required core application tables ('tenants', 'product_variants', 'users', 'stock_movements') were not found in restored database '$TestDatabase'."
        }

        $totalTablesOutput = docker exec $ContainerName psql -U $DbUser -d $TestDatabase -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
        if ($LASTEXITCODE -ne 0) {
            throw "Total table count query failed with exit code $LASTEXITCODE."
        }

        Write-Host "`n[SUCCESS] Restore verification PASSED (restore command exit 0 and required table presence verified):" -ForegroundColor Green
        $totalCountStr = if ($totalTablesOutput) { $totalTablesOutput.ToString().Trim() } else { '0' }
        Write-Host "- Total public tables created: $totalCountStr" -ForegroundColor Green
        Write-Host "- Required core tables present: $($foundTables -join ', ')" -ForegroundColor Green
        Write-Host "- Scope: Verifies restore command exit code and required table presence only (does not validate row-level data or full integrity)." -ForegroundColor DarkCyan

        Write-Host "`nTo clean up the disposable test database when finished, an operator can run:" -ForegroundColor Cyan
        Write-Host "docker exec $ContainerName psql -U $DbUser -d postgres -c `"DROP DATABASE `\`"$TestDatabase`\`";`"" -ForegroundColor Cyan
    }
    finally {
        try {
            docker exec $ContainerName rm -f $tempContainerRestoreFile
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Failed to cleanly remove container temporary restore file (exit code $LASTEXITCODE)."
            }
        }
        catch {
            Write-Warning "Error removing temporary restore file in container: $_"
        }
    }
}
