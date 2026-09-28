; ─────────────────────────────────────────────────────────────────────────────
; installer.nsh — Script NSIS personalizado para Café POS
;
; - Instala en Program Files (perMachine: true ya lo garantiza en electron-builder)
; - Escribe la clave de auto-inicio en HKLM con bandera --kiosk
; - Elimina la clave al desinstalar
; ─────────────────────────────────────────────────────────────────────────────

!macro customInstall
  ; ── Auto-inicio con Windows (todos los usuarios del equipo) ─────────────
  ; La app se lanzará en modo kiosko cada vez que Windows inicie.
  WriteRegStr HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "CafePOS" \
    '"$INSTDIR\Cafe POS.exe" --kiosk'

  ; ── Registro de metadata de instalación ─────────────────────────────────
  WriteRegStr HKLM \
    "SOFTWARE\CafeDelConstructor\POS" \
    "InstallPath" \
    "$INSTDIR"

  WriteRegStr HKLM \
    "SOFTWARE\CafeDelConstructor\POS" \
    "Version" \
    "2.5.0"

  ; ── Configurar hardware: impresora térmica + servicio de impresión ───────
  ; Ejecuta setup-hardware.ps1 (ya copiado a resources\app por extraResources).
  ; El instalador perMachine corre elevado, así que puede instalar el driver
  ; "Generic / Text Only" y dar de alta impresoras USB conectadas sin cola.
  ; El lector QR es HID (plug-and-play): no requiere instalación.
  ; El resultado queda en %ProgramData%\CafePOS\setup-hardware.log
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\app\setup-hardware.ps1"'
  Pop $0 ; código de salida (solo informativo, nunca bloquea la instalación)
!macroend

!macro customUnInstall
  ; ── Eliminar auto-inicio al desinstalar ─────────────────────────────────
  DeleteRegValue HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "CafePOS"

  ; ── Eliminar metadata de instalación ────────────────────────────────────
  DeleteRegKey HKLM "SOFTWARE\CafeDelConstructor\POS"
!macroend
