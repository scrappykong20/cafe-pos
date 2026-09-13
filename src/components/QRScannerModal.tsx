import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'

interface Props {
  onScan: (text: string) => void
  onClose: () => void
}

export default function QRScannerModal({ onScan, onClose }: Props) {
  const videoRef       = useRef<HTMLVideoElement>(null)
  const controlsRef    = useRef<IScannerControls | null>(null)
  const inputRef       = useRef<HTMLInputElement>(null)

  const [manualToken, setManualToken]   = useState('')
  const [camaraError, setCamaraError]   = useState<string | null>(null)
  const [usarCamara, setUsarCamara]     = useState(false)
  const [camaraActiva, setCamaraActiva] = useState(false)

  // ── Foco automático al abrir (el lector USB escribe aquí directamente) ──────
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [])

  // ── Captura la tecla Enter del lector USB ────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const val = manualToken.trim()
      if (val) onScan(val)
    }
  }

  // ── Activar cámara (opcional, solo si no hay lector USB) ─────────────────────
  useEffect(() => {
    if (!usarCamara) {
      controlsRef.current?.stop()
      setCamaraActiva(false)
      return
    }

    const codeReader = new BrowserQRCodeReader()
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then(stream => {
        stream.getTracks().forEach(t => t.stop())
        codeReader
          .decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } } },
            videoRef.current!,
            (result, _err, controls) => {
              controlsRef.current = controls
              if (result) {
                controls.stop()
                onScan(result.getText())
              }
            },
          )
          .then(() => setCamaraActiva(true))
          .catch(() => {
            setCamaraError('No se pudo iniciar la cámara.')
            setUsarCamara(false)
          })
      })
      .catch(() => {
        setCamaraError('Permiso de cámara denegado.')
        setUsarCamara(false)
      })

    return () => { controlsRef.current?.stop() }
  }, [usarCamara])

  function handleManual(e: React.FormEvent) {
    e.preventDefault()
    const val = manualToken.trim()
    if (val) onScan(val)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-3xl w-full max-w-sm border border-slate-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h3 className="text-white font-bold text-lg">Escanear QR del cliente</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-5 space-y-4">

          {/* ── Modo lector USB (principal) ── */}
          {!usarCamara && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3">
              <span className="text-2xl">🖥️</span>
              <div>
                <p className="text-amber-400 font-bold text-sm">Lector USB conectado</p>
                <p className="text-slate-400 text-xs mt-0.5">
                  Escanea el QR — el código aparecerá automáticamente abajo
                </p>
              </div>
            </div>
          )}

          {/* Input principal — el lector USB escribe aquí */}
          <form onSubmit={handleManual} className="space-y-2">
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              {usarCamara ? 'Token manual (respaldo)' : 'Código QR'}
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={usarCamara ? 'Token del QR...' : 'Escanea o escribe el token...'}
                autoComplete="off"
                className="flex-1 bg-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm border border-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40"
              />
              <button
                type="submit"
                disabled={!manualToken.trim()}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 font-bold px-5 py-3 rounded-xl text-sm transition-colors"
              >
                OK
              </button>
            </div>
          </form>

          {/* Error de cámara */}
          {camaraError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-300 text-xs">
              {camaraError}
            </div>
          )}

          {/* Video (cámara, opcional) */}
          {usarCamara && (
            <div className="relative bg-black rounded-2xl overflow-hidden aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" />
              {camaraActiva && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 relative">
                    <div className="absolute inset-0 border-2 border-amber-400/40 rounded-2xl" />
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toggle cámara */}
          <button
            onClick={() => { setUsarCamara(v => !v); setCamaraError(null) }}
            className="w-full text-slate-500 hover:text-slate-300 text-xs text-center py-1 transition-colors"
          >
            {usarCamara ? '← Volver a modo lector USB' : '📷 Usar cámara en su lugar'}
          </button>

        </div>
      </div>
    </div>
  )
}
