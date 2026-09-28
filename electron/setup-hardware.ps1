# ─────────────────────────────────────────────────────────────────────────────
# setup-hardware.ps1 — Café POS
#
# Se ejecuta automáticamente durante la instalación del EXE (con permisos de
# administrador) y puede re-ejecutarse desde el print-server si la impresora
# se conecta después de instalar.
#
# Hace 3 cosas:
#   1. Deja el servicio de cola de impresión (Spooler) en Automático + iniciado
#   2. Asegura el driver "Generic / Text Only" (incluido en Windows 10/11)
#   3. Detecta impresoras USB conectadas sin cola instalada y las instala como
#      "POS TERMICA" usando ese driver (el POS imprime en RAW, así que cualquier
#      driver sirve; solo se necesita que la impresora exista en Windows)
#
# El lector QR NO necesita nada: es un dispositivo HID que Windows instala solo
# (funciona como teclado). Solo se registra su presencia en el log.
#
# Log: %ProgramData%\CafePOS\setup-hardware.log
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Continue'

$logDir = Join-Path $env:ProgramData 'CafePOS'
try { New-Item -ItemType Directory -Force -Path $logDir | Out-Null } catch {}
$logFile = Join-Path $logDir 'setup-hardware.log'

function Log([string]$msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

Log '========== setup-hardware.ps1 inicio =========='

# ── 1) Servicio de cola de impresión ─────────────────────────────────────────
try {
  Set-Service -Name Spooler -StartupType Automatic -ErrorAction Stop
  if ((Get-Service -Name Spooler).Status -ne 'Running') {
    Start-Service -Name Spooler -ErrorAction Stop
  }
  Log 'Spooler: en Automatico y corriendo'
} catch {
  Log "Spooler ERROR: $($_.Exception.Message)"
}

# ── 2) Driver Generic / Text Only ────────────────────────────────────────────
$driverName = 'Generic / Text Only'
$driverOk = $false
try {
  if (Get-PrinterDriver -Name $driverName -ErrorAction SilentlyContinue) {
    Log "Driver ya presente: $driverName"
    $driverOk = $true
  } else {
    Add-PrinterDriver -Name $driverName -ErrorAction Stop
    Log "Driver instalado: $driverName"
    $driverOk = $true
  }
} catch {
  Log "Driver ERROR: $($_.Exception.Message)"
}

# ── 3) Instalar impresoras USB conectadas que no tengan cola ─────────────────
try {
  # Puertos USB001, USB002... que el monitor usbmon expone para impresoras conectadas
  $usbPorts = @(
    Get-PrinterPort -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^USB\d+' } |
      Select-Object -ExpandProperty Name
  )
  Log ("Puertos USB de impresora detectados: " + $(if ($usbPorts.Count) { $usbPorts -join ', ' } else { '(ninguno)' }))

  # Dispositivos de clase impresora con problemas (sin driver) — solo para el log
  $problematicos = @(
    Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue |
      Where-Object { $_.Status -ne 'OK' }
  )
  foreach ($dev in $problematicos) {
    Log "Dispositivo impresora con estado $($dev.Status): $($dev.FriendlyName)"
  }

  $usedPorts = @(Get-Printer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PortName)
  $freePorts = @($usbPorts | Where-Object { $usedPorts -notcontains $_ })

  $n = 1
  foreach ($port in $freePorts) {
    if (-not $driverOk) {
      Log "No se instalo en $port porque falta el driver $driverName"
      continue
    }
    $name = if ($n -eq 1) { 'POS TERMICA' } else { "POS TERMICA $n" }
    while (Get-Printer -Name $name -ErrorAction SilentlyContinue) {
      $n++
      $name = "POS TERMICA $n"
    }
    try {
      Add-Printer -Name $name -DriverName $driverName -PortName $port -ErrorAction Stop
      Log "Impresora instalada: '$name' en $port"
      $n++
    } catch {
      Log "No se pudo instalar en ${port}: $($_.Exception.Message)"
    }
  }
  if ($freePorts.Count -eq 0) {
    Log 'No hay impresoras USB pendientes de instalar (todas ya tienen cola o no hay ninguna conectada)'
  }
} catch {
  Log "Deteccion USB ERROR: $($_.Exception.Message)"
}

# ── 4) Lector QR (HID) — solo informativo, no requiere instalacion ───────────
try {
  $hidOk = @(Get-PnpDevice -Class HIDClass -Status OK -ErrorAction SilentlyContinue).Count
  Log "Dispositivos HID activos: $hidOk (el lector QR funciona como teclado, plug-and-play)"
} catch {}

Log '========== setup-hardware.ps1 fin =========='
