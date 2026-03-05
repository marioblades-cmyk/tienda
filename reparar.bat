@echo off
set PATH=C:\PROGRA~1\nodejs;%PATH%
echo Limpiando modulos viejos...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
echo Instalando dependencias nuevas...
call C:\PROGRA~1\nodejs\npm.cmd install
if %ERRORLEVEL% NEQ 0 (
  echo Error en la instalacion. Intentando sin scripts...
  call C:\PROGRA~1\nodejs\npm.cmd install --no-scripts
)
echo Proceso terminado.
