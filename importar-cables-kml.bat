@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Ajusta la ruta si tu KML está en otro sitio
set "KML=C:\Users\ASUS\Desktop\CABLES.kml"

if not exist "%KML%" (
  echo No se encuentra: %KML%
  pause
  exit /b 1
)

echo Importando cables a PostgreSQL ^(tabla rutas^)...
echo.

node scripts/import-kml.mjs "%KML%"
if errorlevel 1 (
  echo.
  echo Fallo la importacion. Revisa .env y que PostgreSQL este en marcha.
  pause
  exit /b 1
)

echo.
echo Listo. Abre la app y pulsa Recargar rutas.
pause
