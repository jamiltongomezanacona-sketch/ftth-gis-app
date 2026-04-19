@echo off
chcp 65001 >nul
title FTTH GIS - servidor local

REM Siempre en la carpeta de este .bat. No pegues lineas sueltas en PowerShell. Doble clic aqui o CMD.
cd /d "%~dp0"

echo.
echo  ============================================================
echo   FTTH GIS - servidor local
echo  ============================================================
echo   Carpeta: %CD%
echo.
echo   Cuando aparezca "FTTH GIS API http://127.0.0.1:XXXX" abre el editor con ese puerto:
echo     .../editor.html   ^(si 3000 esta ocupado el servidor usa 3001, 3002, etc.^)
echo.
echo   Si el puerto 3000 esta ocupado ejecuta: liberar-puerto-3000.bat
echo.
echo   Para parar el servidor: Ctrl+C en esta ventana.
echo   No ejecutes lineas sueltas de este archivo en PowerShell.
echo   Usa doble clic aqui o iniciar-app.bat desde CMD en esta carpeta.
echo  ============================================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encuentra "npm". Instala Node.js LTS ^(marca "Add to PATH"^) y vuelve a abrir esta ventana.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] No hay package.json. Este .bat debe estar dentro de la carpeta ftth-gis-app.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [AVISO] No existe .env en esta carpeta.
  echo          Copia .env.example a .env y configura DATABASE_URL ^(y MAPBOX si aplica^).
  echo.
  pause
)

REM El servidor puede abrir el navegador al arrancar ^(OPEN_BROWSER en server/index.js^)
set OPEN_BROWSER=1

echo Iniciando npm start...
echo.

call npm start

echo.
echo Servidor detenido.
pause
