@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Copia del proyecto o cambia GEOJSON abajo a tu ruta.
set "GEOJSON=%~dp0data\centrales-etb.geojson"

if not exist "%GEOJSON%" (
  echo No se encuentra: %GEOJSON%
  echo Copia centrales-etb.geojson a la carpeta data\ del proyecto.
  pause
  exit /b 1
)

echo Importando centrales ETB a PostgreSQL...
echo Ejecuta antes en pgAdmin: sql\02_centrales_etb.sql
echo.

node scripts/import-centrales-geojson.mjs "%GEOJSON%" --replace
if errorlevel 1 (
  echo.
  echo Revisa .env, PostgreSQL y que exista la tabla centrales_etb.
  pause
  exit /b 1
)

echo.
echo Listo. Reinicia la app y pulsa Recargar rutas ^(carga tambien centrales^).
pause
