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
!macroend

!macro customUnInstall
  ; ── Eliminar auto-inicio al desinstalar ─────────────────────────────────
  DeleteRegValue HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "CafePOS"

  ; ── Eliminar metadata de instalación ────────────────────────────────────
  DeleteRegKey HKLM "SOFTWARE\CafeDelConstructor\POS"
!macroend
