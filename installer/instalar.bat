@echo off
setlocal EnableDelayedExpansion
title CAFE POS - Instalador

:: ============================================================
::  CAFE POS - INSTALADOR COMPLETO
::  El Cafe del Constructor
::  Ejecutar como Administrador
:: ============================================================

echo.
echo  ============================================================
echo   CAFE POS - INSTALADOR COMPLETO
echo   El Cafe del Constructor
echo  ============================================================
echo.

:: --- Pedir elevacion si no somos admin -----------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Solicitando permisos de administrador...
    PowerShell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

echo  [OK] Ejecutando como Administrador
echo.

:: --- Variables globales --------------------------------------
set "INSTALL_DIR=C:\CafePOS"
set "SOURCE_DIR=%~dp0"
set "NODE_URL=https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi"
set "NSSM_URL=https://nssm.cc/release/nssm-2.24.zip"
set "NODE_MSI=%TEMP%\node20_installer.msi"
set "NSSM_ZIP=%TEMP%\nssm.zip"
set "NSSM_TMP=%TEMP%\nssm_extract"
set "NSSM_EXE=%INSTALL_DIR%\nssm.exe"

:: =============================================================
:: PASO 1: Verificar / instalar Node.js
:: =============================================================
echo  [1/8] Verificando Node.js...
echo.

set "NODE_EXE="
for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"

if defined NODE_EXE (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    echo  [OK] Node.js !NODE_VER! ya instalado en !NODE_EXE!
) else (
    echo  Descargando Node.js 20 LTS...
    PowerShell -NoProfile -Command ^
        "[Net.ServicePointManager]::SecurityProtocol='Tls12';" ^
        "Write-Host '  Descargando... (puede tardar)';" ^
        "$p=New-Object System.Net.WebClient;" ^
        "$p.DownloadFile('%NODE_URL%','%NODE_MSI%');" ^
        "Write-Host '  Descarga completada.'"
    if not exist "%NODE_MSI%" (
        echo  ERROR: No se pudo descargar Node.js.
        echo  Verifica tu conexion a internet e intenta de nuevo.
        pause & exit /b 1
    )
    echo  Instalando Node.js silenciosamente...
    msiexec /i "%NODE_MSI%" /qn ADDLOCAL=ALL
    timeout /t 5 /nobreak >nul
    del /f /q "%NODE_MSI%" 2>nul

    :: Refrescar PATH
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
    set "PATH=%SYS_PATH%;%PATH%"

    for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
    if not defined NODE_EXE set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    echo  [OK] Node.js instalado
)

if not defined NODE_EXE set "NODE_EXE=C:\Program Files\nodejs\node.exe"

echo.

:: =============================================================
:: PASO 2: Detener servicios existentes (si ya estaba instalado)
:: =============================================================
echo  [2/8] Preparando directorio de instalacion...
echo.

sc stop CafePOS >nul 2>&1
sc stop CafePrintServer >nul 2>&1
timeout /t 2 /nobreak >nul

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\logs" mkdir "%INSTALL_DIR%\logs"

echo  [OK] Directorio listo: %INSTALL_DIR%
echo.

:: =============================================================
:: PASO 3: Copiar archivos del programa
:: =============================================================
echo  [3/8] Copiando archivos del sistema POS...
echo.

:: dist/ (build de React - la interfaz web)
if exist "%SOURCE_DIR%dist" (
    robocopy "%SOURCE_DIR%dist" "%INSTALL_DIR%\dist" /e /is /it /np /nfl /ndl >nul
    echo  [OK] dist/ copiado
) else (
    echo  ERROR: No se encontro la carpeta dist\
    echo  Asegurate de extraer el ZIP completo antes de ejecutar este instalador.
    pause & exit /b 1
)

:: print-server/
if exist "%SOURCE_DIR%print-server" (
    robocopy "%SOURCE_DIR%print-server" "%INSTALL_DIR%\print-server" /e /is /it /np /nfl /ndl >nul
    echo  [OK] print-server/ copiado
)

:: public/
if exist "%SOURCE_DIR%public" (
    robocopy "%SOURCE_DIR%public" "%INSTALL_DIR%\public" /e /is /it /np /nfl /ndl >nul
    echo  [OK] public/ copiado
)

:: serve-pos.cjs
if exist "%SOURCE_DIR%serve-pos.cjs" (
    copy /y "%SOURCE_DIR%serve-pos.cjs" "%INSTALL_DIR%\serve-pos.cjs" >nul
    echo  [OK] serve-pos.cjs copiado
)

echo.

:: =============================================================
:: PASO 4: Descargar NSSM (gestor de servicios robusto)
:: =============================================================
echo  [4/8] Descargando gestor de servicios (NSSM)...
echo.

if not exist "%NSSM_EXE%" (
    PowerShell -NoProfile -Command ^
        "[Net.ServicePointManager]::SecurityProtocol='Tls12';" ^
        "$p=New-Object System.Net.WebClient;" ^
        "$p.DownloadFile('%NSSM_URL%','%NSSM_ZIP%');" ^
        "if (Test-Path '%NSSM_ZIP%') {" ^
        "  Expand-Archive -Path '%NSSM_ZIP%' -DestinationPath '%NSSM_TMP%' -Force;" ^
        "  $f=Get-ChildItem '%NSSM_TMP%' -Recurse -Filter 'nssm.exe' | Where-Object {$_.FullName -like '*win64*'} | Select-Object -First 1;" ^
        "  if (!$f) {$f=Get-ChildItem '%NSSM_TMP%' -Recurse -Filter 'nssm.exe' | Select-Object -First 1}" ^
        "  if ($f) {Copy-Item $f.FullName '%NSSM_EXE%' -Force; Write-Host '  [OK] NSSM listo'}" ^
        "  Remove-Item '%NSSM_ZIP%','%NSSM_TMP%' -Recurse -Force -ErrorAction SilentlyContinue" ^
        "}"
) else (
    echo  [OK] NSSM ya presente
)

echo.

:: =============================================================
:: PASO 5: Crear servicios Windows
:: =============================================================
echo  [5/8] Registrando servicios Windows (inicio automatico)...
echo.

:: Eliminar servicios anteriores
if exist "%NSSM_EXE%" (
    "%NSSM_EXE%" remove CafePOS confirm >nul 2>&1
    "%NSSM_EXE%" remove CafePrintServer confirm >nul 2>&1
) else (
    sc delete CafePOS >nul 2>&1
    sc delete CafePrintServer >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Servicio POS (servidor web puerto 3000)
if exist "%NSSM_EXE%" (
    "%NSSM_EXE%" install CafePOS "%NODE_EXE%" >nul
    "%NSSM_EXE%" set CafePOS AppParameters  "%INSTALL_DIR%\serve-pos.cjs" >nul
    "%NSSM_EXE%" set CafePOS DisplayName    "Cafe POS - Servidor Web" >nul
    "%NSSM_EXE%" set CafePOS Description    "Sirve el POS en http://localhost:3000" >nul
    "%NSSM_EXE%" set CafePOS Start          SERVICE_AUTO_START >nul
    "%NSSM_EXE%" set CafePOS AppDirectory   "%INSTALL_DIR%" >nul
    "%NSSM_EXE%" set CafePOS AppStdout      "%INSTALL_DIR%\logs\CafePOS.log" >nul
    "%NSSM_EXE%" set CafePOS AppStderr      "%INSTALL_DIR%\logs\CafePOS-err.log" >nul
    "%NSSM_EXE%" set CafePOS AppRotateFiles 1 >nul
    "%NSSM_EXE%" set CafePOS AppRotateBytes 1048576 >nul
    echo  [OK] Servicio CafePOS registrado
) else (
    sc create CafePOS binPath= "\"%NODE_EXE%\" \"%INSTALL_DIR%\serve-pos.cjs\"" DisplayName= "Cafe POS - Servidor Web" start= auto >nul
    echo  [OK] Servicio CafePOS registrado (sc.exe)
)

:: Servicio Print Server (servidor impresion puerto 3002)
if exist "%NSSM_EXE%" (
    "%NSSM_EXE%" install CafePrintServer "%NODE_EXE%" >nul
    "%NSSM_EXE%" set CafePrintServer AppParameters  "%INSTALL_DIR%\print-server\server.cjs" >nul
    "%NSSM_EXE%" set CafePrintServer DisplayName    "Cafe POS - Servidor de Impresion" >nul
    "%NSSM_EXE%" set CafePrintServer Description    "Impresion ESC/POS en http://localhost:3002" >nul
    "%NSSM_EXE%" set CafePrintServer Start          SERVICE_AUTO_START >nul
    "%NSSM_EXE%" set CafePrintServer AppDirectory   "%INSTALL_DIR%" >nul
    "%NSSM_EXE%" set CafePrintServer AppStdout      "%INSTALL_DIR%\logs\CafePrintServer.log" >nul
    "%NSSM_EXE%" set CafePrintServer AppStderr      "%INSTALL_DIR%\logs\CafePrintServer-err.log" >nul
    "%NSSM_EXE%" set CafePrintServer AppRotateFiles 1 >nul
    "%NSSM_EXE%" set CafePrintServer AppRotateBytes 1048576 >nul
    echo  [OK] Servicio CafePrintServer registrado
) else (
    sc create CafePrintServer binPath= "\"%NODE_EXE%\" \"%INSTALL_DIR%\print-server\server.cjs\"" DisplayName= "Cafe POS - Servidor Impresion" start= auto >nul
    echo  [OK] Servicio CafePrintServer registrado (sc.exe)
)

:: Iniciar servicios ahora mismo
net start CafePOS >nul 2>&1
net start CafePrintServer >nul 2>&1
echo  [OK] Servicios iniciados

echo.

:: =============================================================
:: PASO 6: Configurar modo kiosco
:: =============================================================
echo  [6/8] Configurando modo kiosco...
echo.

:: Bloquear Gestor de Tareas
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f >nul
echo  [OK] Gestor de tareas bloqueado

:: Deshabilitar menu contextual del escritorio
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoViewContextMenu /t REG_DWORD /d 1 /f >nul
echo  [OK] Menu contextual desactivado

:: Ocultar barra de tareas automaticamente
PowerShell -NoProfile -Command ^
    "$p='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3';" ^
    "if(Test-Path $p){" ^
    "  $v=(Get-ItemProperty $p -Name Settings).Settings;" ^
    "  $v[8]=3;" ^
    "  Set-ItemProperty $p -Name Settings -Value $v;" ^
    "  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue;" ^
    "  Start-Sleep -Milliseconds 1000;" ^
    "  Start-Process explorer" ^
    "}" >nul 2>&1
echo  [OK] Barra de tareas en auto-ocultar

:: Tarea programada: abrir Chrome/Edge en kiosco al iniciar sesion
PowerShell -NoProfile -Command ^
    "$xml=[xml]'<?xml version=\"1.0\" encoding=\"UTF-16\"?>" ^
    "<Task xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">" ^
    "<Triggers><LogonTrigger><Delay>PT5S</Delay><Enabled>true</Enabled></LogonTrigger></Triggers>" ^
    "<Principals><Principal><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>" ^
    "<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings>" ^
    "<Actions><Exec><Command>cmd.exe</Command><Arguments>/c start chrome --kiosk --app=http://localhost:3000 --disable-infobars --no-first-run --disable-translate 2^>nul || start msedge --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run</Arguments></Exec></Actions>" ^
    "</Task>';" ^
    "$f='%TEMP%\cafePOS_kiosk_task.xml';" ^
    "$xml.Save($f);" ^
    "schtasks /create /tn CafePOS_Kiosk /xml $f /f | Out-Null;" ^
    "Remove-Item $f -Force -ErrorAction SilentlyContinue" >nul 2>&1
echo  [OK] Kiosco: POS abre automaticamente al iniciar sesion

echo.

:: =============================================================
:: PASO 7: Configurar inicio de sesion automatico (sin password)
:: =============================================================
echo  [7/8] Configurando inicio de sesion automatico...
echo.

for /f "tokens=2 delims=\" %%u in ('whoami') do set "CURRENT_USER=%%u"
echo  Usuario actual: %CURRENT_USER%

reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon    /t REG_SZ /d "1"             /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultUsername   /t REG_SZ /d "%CURRENT_USER%" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword   /t REG_SZ /d ""              /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultDomainName /t REG_SZ /d "."             /f >nul

echo  [OK] Auto-login configurado para: %CURRENT_USER%
echo      Al encender el panel -> Windows inicia solo -> POS abre automaticamente
echo      Solo hay que ingresar el PIN del cajero en la app

echo.

:: =============================================================
:: PASO 8: Crear script de actualizacion y accesos directos
:: =============================================================
echo  [8/8] Creando accesos directos y herramientas...
echo.

:: Script de actualizacion
(
echo @echo off
echo echo.
echo echo  CAFE POS - Actualizador
echo echo  ========================
echo echo.
echo if "%%~1"=="" ^(
echo   echo Arrastra la nueva carpeta 'dist' sobre este archivo.
echo   echo O ejecuta: actualizar.bat "ruta\a\dist"
echo   pause ^& exit /b 1
echo ^)
echo if not exist "%%~1\index.html" ^(
echo   echo ERROR: La carpeta seleccionada no contiene index.html
echo   pause ^& exit /b 1
echo ^)
echo echo Deteniendo servicio...
echo net stop CafePOS ^>nul 2^>^&1
echo timeout /t 2 /nobreak ^>nul
echo echo Reemplazando archivos...
echo rd /s /q "%INSTALL_DIR%\dist" 2^>nul
echo robocopy "%%~1" "%INSTALL_DIR%\dist" /e /np /nfl /ndl ^>nul
echo echo Reiniciando servicio...
echo net start CafePOS
echo echo.
echo echo  [OK] Actualizacion completada. Recarga la pagina con F5.
echo pause
) > "%INSTALL_DIR%\actualizar.bat"

:: Script de inicio manual
(
echo @echo off
echo title Cafe POS
echo net start CafePOS ^>nul 2^>^&1
echo net start CafePrintServer ^>nul 2^>^&1
echo timeout /t 3 /nobreak ^>nul
echo start "" "chrome" --kiosk --app=http://localhost:3000 --disable-infobars --no-first-run 2^>nul
echo if errorlevel 1 start "" "msedge" --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run 2^>nul
echo if errorlevel 1 start http://localhost:3000
) > "%INSTALL_DIR%\iniciar-cafe-pos.bat"

:: Accesos directos en el Escritorio (para todos los usuarios)
PowerShell -NoProfile -Command ^
    "$ws=New-Object -ComObject WScript.Shell;" ^
    "$s=$ws.CreateShortcut('C:\Users\Public\Desktop\Cafe POS.lnk');" ^
    "$s.TargetPath='%INSTALL_DIR%\iniciar-cafe-pos.bat';" ^
    "$s.WorkingDirectory='%INSTALL_DIR%';" ^
    "$s.Description='El Cafe del Constructor - Sistema POS';" ^
    "$s.WindowStyle=1;" ^
    "$s.Save();" ^
    "$u=$ws.CreateShortcut('C:\Users\Public\Desktop\Actualizar Cafe POS.lnk');" ^
    "$u.TargetPath='%INSTALL_DIR%\actualizar.bat';" ^
    "$u.WorkingDirectory='%INSTALL_DIR%';" ^
    "$u.Description='Actualiza el Cafe POS sin reinstalar';" ^
    "$u.WindowStyle=1;" ^
    "$u.Save()" >nul 2>&1

echo  [OK] Acceso directo "Cafe POS" en el Escritorio
echo  [OK] Acceso directo "Actualizar Cafe POS" en el Escritorio
echo  [OK] Script de actualizacion en %INSTALL_DIR%\actualizar.bat

echo.
echo  ============================================================
echo   INSTALACION COMPLETADA
echo  ============================================================
echo.
echo   Directorio: %INSTALL_DIR%
echo   POS Web:    http://localhost:3000
echo   Impresion:  http://localhost:3002
echo.
echo   SERVICIOS WINDOWS (inician solos con Windows):
echo     CafePOS           - servidor del sistema POS
echo     CafePrintServer   - servidor de impresion termica
echo.
echo   KIOSCO:
echo     - Windows inicia sesion automaticamente
echo     - El POS abre solo en pantalla completa
echo     - Solo se ve el POS, sin barra de tareas
echo     - Solo se necesita ingresar el PIN del cajero
echo.
echo   PARA ACTUALIZAR SIN REINSTALAR:
echo     1. Genera nuevo build: npm run build
echo     2. Arrastra la carpeta 'dist' sobre
echo        "Actualizar Cafe POS" en el Escritorio
echo.
echo  ============================================================
echo.

:: Abrir el POS en el navegador
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo  Presiona cualquier tecla para cerrar...
pause >nul
