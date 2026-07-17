#Requires -RunAsAdministrator
<#
  Instalador de Café POS
  Instala Node.js, copia los archivos del sistema,
  crea dos servicios Windows (POS + servidor de impresión)
  y agrega un acceso directo en el Escritorio y en el inicio automático.
  Ejecutar como Administrador.
#>

$ErrorActionPreference = 'Stop'
$INSTALL_DIR  = 'C:\CafePOS'
$NODE_MIN_VER = 18
$NODE_DL_URL  = 'https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi'
$NODE_MSI     = "$env:TEMP\node_installer.msi"
$NSSM_URL     = 'https://nssm.cc/release/nssm-2.24.zip'
$NSSM_ZIP     = "$env:TEMP\nssm.zip"
$NSSM_EXE     = "$INSTALL_DIR\nssm.exe"

function Write-Step($msg) {
    Write-Host "`n  >> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "     OK: $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "     AVISO: $msg" -ForegroundColor Yellow
}

# ── Verificar que el script se ejecuta desde la carpeta correcta ──────────────
$SOURCE = Split-Path -Parent $MyInvocation.MyCommand.Path
# El instalador esta en <proyecto>/installer/ — subimos un nivel para la raiz
$PROJECT_ROOT = Split-Path -Parent $SOURCE

if (-not (Test-Path "$PROJECT_ROOT\dist\index.html")) {
    Write-Host "`n  ERROR: No se encontro dist\index.html en $PROJECT_ROOT" -ForegroundColor Red
    Write-Host "  Asegurate de haber ejecutado 'npm run build' antes de instalar." -ForegroundColor Red
    pause
    exit 1
}

Write-Host @"

  ╔══════════════════════════════════════════╗
  ║        CAFE POS — INSTALADOR v1.0        ║
  ║    El Cafe del Constructor               ║
  ╚══════════════════════════════════════════╝
"@ -ForegroundColor Yellow

# ── 1. Verificar / instalar Node.js ──────────────────────────────────────────
Write-Step "Verificando Node.js..."
$nodeOk = $false
try {
    $nodeVer = & node --version 2>$null
    if ($nodeVer -match 'v(\d+)') {
        $major = [int]$Matches[1]
        if ($major -ge $NODE_MIN_VER) {
            Write-OK "Node.js $nodeVer ya instalado"
            $nodeOk = $true
        }
    }
} catch {}

if (-not $nodeOk) {
    Write-Step "Descargando Node.js 20 LTS ($NODE_DL_URL)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $NODE_DL_URL -OutFile $NODE_MSI -UseBasicParsing
    Write-Step "Instalando Node.js..."
    Start-Process msiexec -ArgumentList "/i `"$NODE_MSI`" /qn ADDLOCAL=ALL" -Wait
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User')
    Write-OK "Node.js instalado"
}

$NODE_EXE = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NODE_EXE) {
    # Buscar en ruta estandar
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $NODE_EXE = $c; break }
    }
}
if (-not $NODE_EXE) {
    Write-Host "  ERROR: node.exe no encontrado despues de instalar." -ForegroundColor Red
    pause; exit 1
}
Write-OK "node.exe = $NODE_EXE"

# ── 2. Descargar NSSM (gestor de servicios) ───────────────────────────────────
Write-Step "Preparando gestor de servicios (NSSM)..."
if (-not (Test-Path $NSSM_EXE)) {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $NSSM_URL -OutFile $NSSM_ZIP -UseBasicParsing
        Add-Type -Assembly System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($NSSM_ZIP)
        $entry = $zip.Entries | Where-Object { $_.FullName -like '*win64/nssm.exe' } | Select-Object -First 1
        if (-not $entry) {
            $entry = $zip.Entries | Where-Object { $_.Name -eq 'nssm.exe' } | Select-Object -First 1
        }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $NSSM_EXE, $true)
        $zip.Dispose()
        Remove-Item $NSSM_ZIP -Force -ErrorAction SilentlyContinue
        Write-OK "NSSM descargado"
    } catch {
        Write-Warn "No se pudo descargar NSSM: $_  (se usara sc.exe como alternativa)"
        $NSSM_EXE = $null
    }
} else {
    Write-OK "NSSM ya presente"
}

# ── 3. Copiar archivos del programa ───────────────────────────────────────────
Write-Step "Copiando archivos a $INSTALL_DIR ..."

# Detener servicios si ya existen (para actualizar)
foreach ($svc in @('CafePOS','CafePrintServer')) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s) {
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

# Crear directorio
if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR | Out-Null }

# Copiar todo el proyecto
$exclude = @('.git','node_modules','android','.env')
Get-ChildItem $PROJECT_ROOT -Force | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    $dst = Join-Path $INSTALL_DIR $_.Name
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName $dst -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Copy-Item $_.FullName $dst -Force -ErrorAction SilentlyContinue
    }
}

# Instalar dependencias del servidor de impresión (solo las de producción)
Write-Step "Instalando dependencias del servidor de impresion..."
Push-Location "$INSTALL_DIR\print-server"
if (-not (Test-Path 'package.json')) {
    '{ "name":"cafe-print-server","private":true,"dependencies":{} }' | Out-File 'package.json' -Encoding utf8
}
Pop-Location

Write-OK "Archivos copiados"

# ── 4. Crear archivo .env en INSTALL_DIR ──────────────────────────────────────
Write-Step "Configurando variables de entorno..."
# El .env solo es necesario para el servidor de desarrollo — el build ya las lleva incluidas
# Solo aseguramos que exista para referencia
if (Test-Path "$PROJECT_ROOT\.env") {
    Copy-Item "$PROJECT_ROOT\.env" "$INSTALL_DIR\.env" -Force
}

# ── 5. Crear script de inicio ─────────────────────────────────────────────────
Write-Step "Creando scripts de inicio..."

$startPOS = @"
@echo off
start "" "$NODE_EXE" "$INSTALL_DIR\serve-pos.cjs"
"@
$startPOS | Out-File "$INSTALL_DIR\start-pos.bat" -Encoding ascii

$startPrint = @"
@echo off
start "" "$NODE_EXE" "$INSTALL_DIR\print-server\server.cjs"
"@
$startPrint | Out-File "$INSTALL_DIR\start-print.bat" -Encoding ascii

$startAll = @"
@echo off
title Cafe POS
echo Iniciando servidores...
start "POS Server" "$NODE_EXE" "$INSTALL_DIR\serve-pos.cjs"
timeout /t 2 /nobreak > nul
start "Print Server" "$NODE_EXE" "$INSTALL_DIR\print-server\server.cjs"
timeout /t 3 /nobreak > nul
start "" "chrome" "--kiosk" "--app=http://localhost:3000" 2>nul
if errorlevel 1 start "" "msedge" "--kiosk" "http://localhost:3000" 2>nul
if errorlevel 1 start "" "http://localhost:3000"
"@
$startAll | Out-File "$INSTALL_DIR\iniciar-cafe-pos.bat" -Encoding ascii

Write-OK "Scripts creados"

# ── 6. Instalar servicios Windows ────────────────────────────────────────────
Write-Step "Registrando servicios Windows..."

function Install-Service($name, $displayName, $description, $exePath, $args) {
    # Eliminar servicio existente
    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if ($NSSM_EXE -and (Test-Path $NSSM_EXE)) {
            & $NSSM_EXE remove $name confirm 2>$null
        } else {
            & sc.exe delete $name | Out-Null
        }
        Start-Sleep -Seconds 1
    }

    if ($NSSM_EXE -and (Test-Path $NSSM_EXE)) {
        & $NSSM_EXE install $name $exePath $args
        & $NSSM_EXE set $name DisplayName $displayName
        & $NSSM_EXE set $name Description $description
        & $NSSM_EXE set $name Start SERVICE_AUTO_START
        & $NSSM_EXE set $name AppStdout "$INSTALL_DIR\logs\${name}.log"
        & $NSSM_EXE set $name AppStderr "$INSTALL_DIR\logs\${name}-err.log"
        & $NSSM_EXE set $name AppRotateFiles 1
        & $NSSM_EXE set $name AppRotateOnline 1
        & $NSSM_EXE set $name AppRotateBytes 1048576
    } else {
        # sc.exe fallback
        $binPath = "`"$exePath`" `"$args`""
        & sc.exe create $name binPath= $binPath DisplayName= $displayName start= auto | Out-Null
        & sc.exe description $name $description | Out-Null
    }
}

# Crear carpeta de logs
New-Item -ItemType Directory -Path "$INSTALL_DIR\logs" -Force | Out-Null

Install-Service `
    'CafePOS' `
    'Cafe POS - Servidor Web' `
    'Sirve la interfaz del punto de venta en http://localhost:3000' `
    $NODE_EXE `
    "$INSTALL_DIR\serve-pos.cjs"

Install-Service `
    'CafePrintServer' `
    'Cafe POS - Servidor de Impresion' `
    'Gestiona la impresion ESC/POS en http://localhost:3002' `
    $NODE_EXE `
    "$INSTALL_DIR\print-server\server.cjs"

Write-OK "Servicios registrados"

# ── 7. Iniciar servicios ───────────────────────────────────────────────────────
Write-Step "Iniciando servicios..."
Start-Service -Name 'CafePOS'         -ErrorAction SilentlyContinue
Start-Service -Name 'CafePrintServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$pos   = Get-Service 'CafePOS'         -ErrorAction SilentlyContinue
$print = Get-Service 'CafePrintServer' -ErrorAction SilentlyContinue
if ($pos.Status -eq 'Running')   { Write-OK "CafePOS corriendo" }       else { Write-Warn "CafePOS no inicio — revisa los logs en $INSTALL_DIR\logs\" }
if ($print.Status -eq 'Running') { Write-OK "CafePrintServer corriendo" } else { Write-Warn "CafePrintServer no inicio — revisa los logs" }

# ── 8. Tarea de inicio automático (abrir navegador al encender) ───────────────
Write-Step "Configurando inicio automatico del navegador..."

$taskAction = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c timeout /t 8 /nobreak && (start chrome --kiosk --app=http://localhost:3000 2>nul || start msedge --kiosk http://localhost:3000 2>nul || start http://localhost:3000)"

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn

$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Highest

Unregister-ScheduledTask -TaskName 'CafePOS_AutoStart' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName 'CafePOS_AutoStart' `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Principal $taskPrincipal `
    -Description 'Abre el POS del Cafe del Constructor al iniciar sesion' | Out-Null

Write-OK "Tarea de inicio registrada"

# ── 9. Acceso directo en el Escritorio ───────────────────────────────────────
Write-Step "Creando acceso directo en el Escritorio..."

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut("$env:PUBLIC\Desktop\Cafe POS.lnk")
$shortcut.TargetPath       = "$INSTALL_DIR\iniciar-cafe-pos.bat"
$shortcut.WorkingDirectory = $INSTALL_DIR
$shortcut.Description      = 'El Cafe del Constructor - Sistema POS'
$shortcut.IconLocation     = "$INSTALL_DIR\public\logo.png"
$shortcut.WindowStyle      = 1
$shortcut.Save()

Write-OK "Acceso directo creado en el Escritorio de todos los usuarios"

# ── 10. Crear script de actualización ────────────────────────────────────────
Write-Step "Creando script de actualizacion..."

$updateScript = @"
@echo off
echo.
echo  ===================================
echo   CAFE POS - ACTUALIZADOR
echo  ===================================
echo.
echo Este script actualiza el POS sin reinstalar.
echo Copia la nueva carpeta 'dist' al directorio del programa.
echo.
if "%~1"=="" (
    echo USO: actualizar.bat [ruta-a-carpeta-dist]
    echo.
    echo Ejemplo:
    echo   actualizar.bat "C:\Users\Jorge\Downloads\dist"
    echo.
    echo O simplemente arrastra la carpeta dist sobre este archivo.
    pause
    exit /b 1
)
set NEW_DIST=%~1
if not exist "%NEW_DIST%\index.html" (
    echo ERROR: La carpeta indicada no contiene index.html
    pause
    exit /b 1
)
echo Deteniendo servicio POS...
net stop CafePOS >nul 2>&1
timeout /t 2 /nobreak >nul
echo Reemplazando archivos...
rd /s /q "$INSTALL_DIR\dist" 2>nul
xcopy /e /i /y "%NEW_DIST%" "$INSTALL_DIR\dist\"
echo Reiniciando servicio POS...
net start CafePOS
echo.
echo  OK - Actualizacion completada
pause
"@
$updateScript | Out-File "$INSTALL_DIR\actualizar.bat" -Encoding ascii

# Tambien en el Escritorio
Copy-Item "$INSTALL_DIR\actualizar.bat" "$env:PUBLIC\Desktop\Actualizar Cafe POS.bat" -Force

Write-OK "Script de actualizacion creado"

# ── RESUMEN FINAL ─────────────────────────────────────────────────────────────
Write-Host @"

  ╔══════════════════════════════════════════════════════╗
  ║         INSTALACION COMPLETADA                       ║
  ╠══════════════════════════════════════════════════════╣
  ║  Directorio:  $INSTALL_DIR
  ║  POS Web:     http://localhost:3000
  ║  Impresion:   http://localhost:3002
  ║                                                      ║
  ║  Servicios Windows:                                  ║
  ║    CafePOS           (inicia automaticamente)        ║
  ║    CafePrintServer   (inicia automaticamente)        ║
  ║                                                      ║
  ║  Para actualizar el programa:                        ║
  ║    1. Compila el nuevo build (npm run build)         ║
  ║    2. Arrastra la carpeta 'dist' sobre el archivo    ║
  ║       "Actualizar Cafe POS.bat" del Escritorio       ║
  ╚══════════════════════════════════════════════════════╝
"@ -ForegroundColor Green

Start-Process "http://localhost:3000"
pause
