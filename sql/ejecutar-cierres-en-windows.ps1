# Ejecuta los 3 scripts de cierres contra PostgreSQL (Windows).
# Uso en PowerShell (desde la carpeta ftth-gis-app):
#   .\sql\ejecutar-cierres-en-windows.ps1
# O con base de datos distinta:
#   .\sql\ejecutar-cierres-en-windows.ps1 -Database mi_base

param(
  [string] $Database = "ftth_local",
  [string] $User = "postgres"
)

$ErrorActionPreference = "Stop"

$psql = $null
$search = @(
  "${env:ProgramFiles}\PostgreSQL\16\bin\psql.exe",
  "${env:ProgramFiles}\PostgreSQL\15\bin\psql.exe",
  "${env:ProgramFiles}\PostgreSQL\14\bin\psql.exe",
  "${env:ProgramFiles}\PostgreSQL\13\bin\psql.exe"
)
foreach ($p in $search) {
  if (Test-Path $p) { $psql = $p; break }
}

if (-not $psql) {
  Write-Host ""
  Write-Host "No se encontro psql.exe (cliente de PostgreSQL)." -ForegroundColor Yellow
  Write-Host "Opciones:"
  Write-Host "  1) Instala PostgreSQL desde https://www.postgresql.org/download/windows/"
  Write-Host "     y marca 'Command Line Tools'. Luego vuelve a ejecutar este script."
  Write-Host "  2) Abre pgAdmin -> Query Tool -> pega y ejecuta el contenido de:"
  Write-Host "       sql\04_cierres.sql"
  Write-Host "       sql\cierres_datos.sql"
  Write-Host "       sql\05_cierres_geom.sql"
  Write-Host "  3) Si ya tienes PostgreSQL, busca psql.exe en:"
  Write-Host "     C:\Program Files\PostgreSQL\XX\bin\psql.exe"
  Write-Host "     y ejecuta manualmente (ajusta XX y la base de datos):"
  Write-Host "     & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U $User -d $Database -f `"$($PSScriptRoot)\04_cierres.sql`""
  Write-Host ""
  exit 1
}

Write-Host "Usando: $psql" -ForegroundColor Green
Write-Host "Base de datos: $Database  Usuario: $User" -ForegroundColor Green

$scripts = @("04_cierres.sql", "cierres_datos.sql", "05_cierres_geom.sql")
foreach ($f in $scripts) {
  $path = Join-Path $PSScriptRoot $f
  if (-not (Test-Path $path)) {
    Write-Error "No existe: $path"
  }
  Write-Host "Ejecutando $f ..." -ForegroundColor Cyan
  & $psql -U $User -d $Database -f $path
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo al ejecutar $f (codigo $LASTEXITCODE). Revisa usuario, contrasena y que la base existe."
  }
}

Write-Host "Listo. Comprueba en el navegador: http://127.0.0.1:3000/api/db-check (cierres_count)" -ForegroundColor Green
