#
# empaquetar-actualizacion.ps1
# Genera CafePOS-Update.zip con solo los archivos que cambian.
# No reinstala Node.js ni servicios — solo reemplaza el build.
#
# Ejecutar: powershell -ExecutionPolicy Bypass -File installer\empaquetar-actualizacion.ps1
#

param()
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT       = Split-Path -Parent $SCRIPT_DIR
$OUT_DIR    = Join-Path $SCRIPT_DIR 'output'
$STAGE_DIR  = Join-Path $env:TEMP "CafePOS_update_$(Get-Random)"
$ZIP_OUT    = Join-Path $OUT_DIR 'CafePOS-Update.zip'

Write-Host ''
Write-Host '  CAFE POS - Paquete de actualizacion' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $ROOT 'dist\index.html'))) {
    Write-Host "  ERROR: Ejecuta 'npm run build' primero." -ForegroundColor Red
    Read-Host '  Presiona Enter para salir'
    exit 1
}

if (-not (Test-Path $OUT_DIR)) { New-Item -ItemType Directory -Path $OUT_DIR | Out-Null }
if (Test-Path $STAGE_DIR) { Remove-Item $STAGE_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_DIR | Out-Null

Write-Host '  Copiando archivos...' -ForegroundColor Gray

# Solo lo que cambia entre versiones
Copy-Item (Join-Path $ROOT 'dist')         (Join-Path $STAGE_DIR 'dist')         -Recurse -Force
Copy-Item (Join-Path $ROOT 'serve-pos.cjs') (Join-Path $STAGE_DIR 'serve-pos.cjs') -Force
Copy-Item (Join-Path $ROOT 'print-server\server.cjs') (Join-Path $STAGE_DIR 'server.cjs') -Force

if (Test-Path $ZIP_OUT) { Remove-Item $ZIP_OUT -Force }

Write-Host '  Comprimiendo...' -ForegroundColor Gray
Compress-Archive -Path "$STAGE_DIR\*" -DestinationPath $ZIP_OUT -CompressionLevel Optimal

Remove-Item $STAGE_DIR -Recurse -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $ZIP_OUT).Length / 1MB, 1)
Write-Host "  Listo: $ZIP_OUT ($size MB)" -ForegroundColor Green

Write-Host ''
Write-Host '  COMO ACTUALIZAR EL PANEL TACTIL:' -ForegroundColor Yellow
Write-Host '  1. Copia CafePOS-Update.zip al panel' -ForegroundColor White
Write-Host '  2. Extrae el ZIP en cualquier carpeta (ej: C:\Temp\update\)' -ForegroundColor White
Write-Host '  3. Arrastra la carpeta "dist" extraida sobre el archivo' -ForegroundColor White
Write-Host '     "Actualizar Cafe POS.bat" del Escritorio del panel' -ForegroundColor White
Write-Host ''
Read-Host '  Presiona Enter para cerrar'
