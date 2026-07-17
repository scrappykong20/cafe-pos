#
# empaquetar.ps1 - Genera el paquete de distribucion de Cafe POS
# Requiere PowerShell 5+ (incluido en Windows 10/11)
# Ejecutar: powershell -ExecutionPolicy Bypass -File installer\empaquetar.ps1
#

param()
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT       = Split-Path -Parent $SCRIPT_DIR
$OUT_DIR    = Join-Path $SCRIPT_DIR 'output'
$STAGE_DIR  = Join-Path $env:TEMP "CafePOS_stage_$(Get-Random)"
$ZIP_OUT    = Join-Path $OUT_DIR 'CafePOS-Setup.zip'

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Yellow
Write-Host '   CAFE POS - Generador de instalador' -ForegroundColor Yellow
Write-Host '  ============================================' -ForegroundColor Yellow
Write-Host ''

if (-not (Test-Path (Join-Path $ROOT 'dist\index.html'))) {
    Write-Host '  ERROR: No se encontro dist\index.html' -ForegroundColor Red
    Write-Host "  Ejecuta 'npm run build' primero." -ForegroundColor Red
    Read-Host '  Presiona Enter para salir'
    exit 1
}

# Crear carpetas de salida y staging
if (-not (Test-Path $OUT_DIR)) { New-Item -ItemType Directory -Path $OUT_DIR | Out-Null }
if (Test-Path $STAGE_DIR) { Remove-Item $STAGE_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_DIR | Out-Null

Write-Host '  Copiando archivos al area de staging...' -ForegroundColor Cyan

# Copiar dist/
Write-Host '  + dist/' -ForegroundColor Gray
Copy-Item (Join-Path $ROOT 'dist') (Join-Path $STAGE_DIR 'dist') -Recurse -Force

# Copiar print-server/ (sin node_modules)
Write-Host '  + print-server/' -ForegroundColor Gray
$psDst = Join-Path $STAGE_DIR 'print-server'
New-Item -ItemType Directory -Path $psDst | Out-Null
Get-ChildItem (Join-Path $ROOT 'print-server') | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
    Copy-Item $_.FullName $psDst -Recurse -Force
}

# Copiar public/
$pubSrc = Join-Path $ROOT 'public'
if (Test-Path $pubSrc) {
    Write-Host '  + public/' -ForegroundColor Gray
    Copy-Item $pubSrc (Join-Path $STAGE_DIR 'public') -Recurse -Force
}

# Copiar serve-pos.cjs
Write-Host '  + serve-pos.cjs' -ForegroundColor Gray
Copy-Item (Join-Path $ROOT 'serve-pos.cjs') (Join-Path $STAGE_DIR 'serve-pos.cjs') -Force

# Crear carpeta installer en staging
$instDst = Join-Path $STAGE_DIR 'installer'
New-Item -ItemType Directory -Path $instDst | Out-Null
Copy-Item (Join-Path $SCRIPT_DIR 'instalar.ps1') (Join-Path $instDst 'instalar.ps1') -Force
Copy-Item (Join-Path $SCRIPT_DIR 'instalar.bat') (Join-Path $instDst 'instalar.bat') -Force

# Crear LEEME.txt
@"
====================================================
  CAFE POS - EL CAFE DEL CONSTRUCTOR
  Paquete de instalacion
====================================================

COMO INSTALAR:
1. Extrae este ZIP en cualquier carpeta temporal
   Ejemplo: C:\Temp\CafePOS\

2. Abre la carpeta "installer" dentro de lo extraido

3. Haz clic derecho en "instalar.bat"
   y selecciona "Ejecutar como administrador"

4. El instalador:
   - Descarga e instala Node.js si es necesario
   - Copia todos los archivos a C:\CafePOS\
   - Crea dos servicios Windows que inician solos
   - Crea acceso directo en el Escritorio

5. Al terminar, el POS abre en: http://localhost:3000

====================================================
COMO ACTUALIZAR SIN REINSTALAR:

En la PC de desarrollo:
  npm run build
  powershell -File installer\empaquetar-actualizacion.ps1

En el panel tactil:
  - Extrae CafePOS-Update.zip
  - Arrastra la carpeta "dist" sobre el archivo
    "Actualizar Cafe POS.bat" del Escritorio
====================================================
"@ | Out-File (Join-Path $STAGE_DIR 'LEEME.txt') -Encoding utf8

Write-Host '  Comprimiendo...' -ForegroundColor Cyan

# Eliminar ZIP anterior
if (Test-Path $ZIP_OUT) { Remove-Item $ZIP_OUT -Force }

# Comprimir con Compress-Archive (PS 5+)
Compress-Archive -Path "$STAGE_DIR\*" -DestinationPath $ZIP_OUT -CompressionLevel Optimal

$zipSizeMB = [math]::Round((Get-Item $ZIP_OUT).Length / 1MB, 1)
Write-Host "  ZIP listo: $ZIP_OUT ($zipSizeMB MB)" -ForegroundColor Green

# Limpiar staging
Remove-Item $STAGE_DIR -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   PAQUETE LISTO' -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host "  Archivo: $ZIP_OUT" -ForegroundColor Green
Write-Host ''
Write-Host '  PASOS PARA INSTALAR EN EL PANEL TACTIL:' -ForegroundColor Yellow
Write-Host '  1. Copia CafePOS-Setup.zip al panel tactil' -ForegroundColor White
Write-Host '  2. Extrae el ZIP (clic derecho -> Extraer aqui)' -ForegroundColor White
Write-Host '  3. Abre la carpeta "installer"' -ForegroundColor White
Write-Host '  4. Doble clic en "instalar.bat" (como Administrador)' -ForegroundColor White
Write-Host ''
Write-Host '  El instalador hace todo lo demas automaticamente.' -ForegroundColor Gray
Write-Host ''

Read-Host '  Presiona Enter para cerrar'
