@echo off
chcp 65001 >nul
echo Cerrando el proceso que escucha en el puerto 3000...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; ^
   if (-not $p) { Write-Host 'No hay nada escuchando en 3000.'; exit 0 }; ^
   foreach ($id in $p) { Write-Host ('PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }; ^
   Write-Host 'Hecho. Ahora puedes ejecutar npm start o iniciar-app.bat.'"
echo.
pause
