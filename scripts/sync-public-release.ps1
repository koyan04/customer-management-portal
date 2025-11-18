#!/usr/bin/env pwsh
# Sync Public_Release schema migrations from live database
# Run this before creating a new release to ensure schemas are up-to-date

param(
    [string]$DbHost = "localhost",
    [string]$DbPort = "5432",
    [string]$DbUser = "postgres",
    [string]$DbName = "user_management_portal",
    [string]$DbPassword = $env:DB_PASSWORD
)

$ErrorActionPreference = "Stop"

Write-Host "==> Syncing Public_Release schema from database" -ForegroundColor Cyan
Write-Host "    Database: $DbName @ ${DbHost}:${DbPort}" -ForegroundColor Gray

# Ensure DB password is available
if (-not $DbPassword) {
    Write-Host "ERROR: DB_PASSWORD not set. Provide via -DbPassword or `$env:DB_PASSWORD" -ForegroundColor Red
    exit 1
}

$env:PGPASSWORD = $DbPassword

# Paths
$projectRoot = Split-Path -Parent $PSScriptRoot
$migrationsDir = Join-Path $projectRoot "Public_Release\backend\migrations"
$fullSchemaFile = Join-Path $migrationsDir "000_schema.sql"

# Ensure migrations directory exists
if (-not (Test-Path $migrationsDir)) {
    New-Item -ItemType Directory -Path $migrationsDir -Force | Out-Null
    Write-Host "    Created migrations directory" -ForegroundColor Green
}

# 1. Generate full schema dump (schema-only, no data)
Write-Host "[1/3] Generating full schema (000_schema.sql)..." -ForegroundColor Yellow
try {
    pg_dump -h $DbHost -p $DbPort -U $DbUser -d $DbName -s > $fullSchemaFile
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed with exit code $LASTEXITCODE"
    }
    Write-Host "      + 000_schema.sql created" -ForegroundColor Green
} catch {
    Write-Host "      ✗ Failed to generate schema: $_" -ForegroundColor Red
    exit 1
}

# 2. Get list of tables and generate per-table migrations
Write-Host "[2/3] Generating per-table migrations..." -ForegroundColor Yellow
try {
    $tablesQuery = "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    $tables = psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -t -c $tablesQuery | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_.Trim() }
    
    if (-not $tables) {
        Write-Host "      X No tables found in database" -ForegroundColor Red
        exit 1
    }
    
    $tableCount = 0
    $index = 1
    foreach ($table in $tables) {
        $num = $index.ToString('000')
        $tableFile = Join-Path $migrationsDir "${num}-table-${table}.sql"
        pg_dump -h $DbHost -p $DbPort -U $DbUser -d $DbName -s -t $table > $tableFile
        if ($LASTEXITCODE -eq 0) {
            $tableCount++
        } else {
            Write-Host "      X Failed to dump table: $table" -ForegroundColor Red
        }
        $index++
    }
    
    Write-Host "      + Generated $tableCount table migrations" -ForegroundColor Green
} catch {
    Write-Host "      ✗ Failed to generate per-table migrations: $_" -ForegroundColor Red
    exit 1
}

# 3. Validate: check that 000_schema.sql is not empty
Write-Host "[3/3] Validating schema dump..." -ForegroundColor Yellow
$schemaSize = (Get-Item $fullSchemaFile).Length
if ($schemaSize -lt 100) {
    Write-Host "      X Schema file is suspiciously small ($schemaSize bytes)" -ForegroundColor Red
    exit 1
}

# Check for common schema objects
$schemaContent = Get-Content $fullSchemaFile -Raw
$hasCreateTable = $schemaContent -match "CREATE TABLE"
$hasCreateIndex = $schemaContent -match "CREATE.*INDEX"

if (-not $hasCreateTable) {
    Write-Host "      X Schema file missing CREATE TABLE statements" -ForegroundColor Red
    exit 1
}

$sizeKB = [math]::Round($schemaSize / 1024, 1)
Write-Host "      + Schema validated (${sizeKB}KB, tables: $hasCreateTable, indexes: $hasCreateIndex)" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "==> Sync completed successfully!" -ForegroundColor Green
Write-Host "    Full schema:    $fullSchemaFile" -ForegroundColor Gray
Write-Host "    Table dumps:    $tableCount files" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review the generated migrations" -ForegroundColor Gray
Write-Host "  2. Commit changes: git add Public_Release/backend/migrations/" -ForegroundColor Gray
Write-Host "  3. Tag release:    git tag v1.x.x" -ForegroundColor Gray
Write-Host "  4. Push:           git push; git push --tags" -ForegroundColor Gray
Write-Host ""
