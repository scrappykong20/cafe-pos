/**
 * CanjeQRModal — flujo completo para canjear una recompensa QR de la app del cliente.
 *
 * Flujo:
 *  1. Cajero abre el modal (botón "Canjear Recompensa")
 *  2. Escanea / pega el token del QR
 *  3. Se hace preview: muestra cliente + recompensas + costo
 *  4. Cajero confirma → process_qr_redemption → éxito
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import QRScannerModal from './QRScannerModal'

interface Reward {
  id: string
  nombre: string
  costo: number
}

interface Preview {
  token_id: string
  usuario: { id: string; nombre: string; last_name: string; correo: string }
  engranajes: number
  rewards: Reward[]
  total_costo: number
}

interface Props {
  onClose: () => void
}

export default function CanjeQRModal({ onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const [tokenInput, setTokenInput]   = useState('')
  const [preview, setPreview]         = useState<Preview | null>(null)
  const [loading, setLoading]         = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [exitoInfo, setExitoInfo]     = useState<{ usuario: string; rewards: Reward[]; antes: number; despues: number } | null>(null)
  const [showScanner, setShowScanner] = useState(true) // abrir escáner de inmediato
  const [error, setError]             = useState<string | null>(null)

  // foco automático en el campo al montar
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  // ── Captura Enter del lector USB ─────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const val = tokenInput.trim()
      if (val) cargarPreview(val)
    }
  }

  // ── Preview del token escaneado ──────────────────────────────────────────────
  async function cargarPreview(tokenId: string) {
    setLoading(true)
    setError(null)
    setPreview(null)

    try {
      const id = extraerTokenId(tokenId)

      const { data, error: rpcError } = await supabase.rpc('preview_qr_token', { p_token_id: id })

      if (rpcError) throw new Error(rpcError.message)
      if (!data)    throw new Error('No se encontró información del QR')

      const info: Preview = Array.isArray(data) ? data[0] : data

      // Verificar que sea un QR de canje (tiene recompensas)
      if (!info.rewards || info.rewards.length === 0 || info.total_costo === 0) {
        throw new Error('Este QR es para acumular engranajes, no para canjear recompensas. Usa el botón "Acreditar Engranajes".')
      }

      setPreview({ ...info, token_id: id })
    } catch (err: any) {
      setError(err.message ?? 'Error al leer el QR')
    } finally {
      setLoading(false)
    }
  }

  // ── Confirmar canje ──────────────────────────────────────────────────────────
  async function confirmarCanje() {
    if (!preview) return
    setConfirmando(true)
    setError(null)

    try {
      const { data, error: rpcError } = await supabase.rpc('process_qr_redemption', {
        p_token_id: preview.token_id,
      })

      if (rpcError) throw new Error(rpcError.message)

      const result = Array.isArray(data) ? data[0] : data

      if (result?.error) throw new Error(result.error)
      if (!result?.ok)   throw new Error('No se pudo procesar el canje')

      setExitoInfo({
        usuario:  result.usuario ?? preview.usuario.nombre,
        rewards:  result.rewards ?? preview.rewards,
        antes:    result.engranajes_antes,
        despues:  result.engranajes_despues,
      })
      toast.success('¡Canje procesado correctamente!')
    } catch (err: any) {
      setError(err.message ?? 'Error al confirmar el canje')
    } finally {
      setConfirmando(false)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function extraerTokenId(texto: string): string {
    try {
      const url = new URL(texto)
      const t = url.searchParams.get('token')
      if (t) return t
    } catch {}
    return texto.trim()
  }

  function reset() {
    setPreview(null)
    setTokenInput('')
    setError(null)
    setShowScanner(true)
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  RENDER — PANTALLA ÉXITO
  // ────────────────────────────────────────────────────────────────────────────
  if (exitoInfo) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-3xl w-full max-w-md border border-slate-700 overflow-hidden">

          {/* Header verde */}
          <div className="bg-green-600 px-6 py-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-xl">✅</span>
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-none">¡Canje confirmado!</p>
              <p className="text-green-200 text-sm mt-0.5">El cliente puede llevarse su recompensa</p>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Cliente */}
            <div className="bg-slate-700/50 rounded-2xl p-4">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Cliente</p>
              <p className="text-white font-bold text-lg">{exitoInfo.usuario}</p>
            </div>

            {/* Recompensas canjeadas */}
            <div className="space-y-2">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Recompensas entregadas</p>
              {exitoInfo.rewards.map((r, i) => (
                <div key={i} className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-white font-semibold">🎁 {r.nombre}</span>
                  <span className="text-amber-400 font-bold text-sm">−{r.costo} ⚙️</span>
                </div>
              ))}
            </div>

            {/* Engranajes */}
            <div className="bg-slate-700/50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-slate-400 text-sm">Engranajes restantes</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 line-through text-sm">{exitoInfo.antes} ⚙️</span>
                <span className="text-amber-400 font-bold">→ {exitoInfo.despues} ⚙️</span>
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={reset}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition-colors"
              >
                Otro canje
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  RENDER — CONFIRMACIÓN DE PREVIEW
  // ────────────────────────────────────────────────────────────────────────────
  if (preview) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-3xl w-full max-w-md border border-slate-700 overflow-hidden">

          {/* Header */}
          <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎁</span>
              <div>
                <p className="text-slate-900 font-bold text-lg leading-none">Canje de Recompensa</p>
                <p className="text-slate-900/70 text-sm mt-0.5">Confirma antes de entregar</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-900/60 hover:text-slate-900 text-2xl leading-none">✕</button>
          </div>

          <div className="p-6 space-y-4">
            {/* Cliente */}
            <div className="bg-slate-700/50 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
                <span className="text-lg">👤</span>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Cliente</p>
                <p className="text-white font-bold">{preview.usuario.nombre} {preview.usuario.last_name}</p>
                <p className="text-slate-400 text-xs">{preview.usuario.correo}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-slate-400 text-xs">Saldo actual</p>
                <p className="text-amber-400 font-bold">{preview.engranajes} ⚙️</p>
              </div>
            </div>

            {/* Recompensas a canjear */}
            <div className="space-y-2">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">A entregar</p>
              {preview.rewards.map((r, i) => (
                <div key={i} className="bg-slate-700 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-white font-semibold">🎁 {r.nombre}</span>
                  <span className="text-amber-400 font-bold text-sm">−{r.costo} ⚙️</span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center justify-between border border-slate-700">
              <span className="text-white font-bold">Total a descontar</span>
              <span className="text-amber-400 font-bold text-lg">−{preview.total_costo} ⚙️</span>
            </div>
            <div className="bg-slate-900 rounded-xl px-4 py-2 flex items-center justify-between">
              <span className="text-slate-400 text-sm">Engranajes después</span>
              <span className="text-green-400 font-bold">{preview.engranajes - preview.total_costo} ⚙️</span>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}

            {/* Botones */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={reset}
                disabled={confirmando}
                className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCanje}
                disabled={confirmando}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {confirmando
                  ? <><span className="animate-spin">⚙️</span> Procesando...</>
                  : <>✅ Confirmar canje</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  RENDER — ESCÁNER
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Modal principal */}
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-3xl w-full max-w-sm border border-slate-700 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-500/20 rounded-full flex items-center justify-center">
                <span className="text-lg">🎁</span>
              </div>
              <div>
                <h3 className="text-white font-bold text-base leading-none">Canjear Recompensa</h3>
                <p className="text-slate-500 text-xs mt-0.5">Escanea el QR del cliente</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
          </div>

          <div className="px-5 py-5 space-y-4">

            {/* Instrucción lector USB */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center gap-3">
              <span className="text-xl">🖥️</span>
              <p className="text-amber-400 text-sm font-semibold">
                Escanea el QR con el lector — aparece aquí automáticamente
              </p>
            </div>

            {/* Campo de captura (lector USB escribe aquí) */}
            <div className="space-y-2">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Token del QR</label>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={tokenInput}
                  onChange={e => { setTokenInput(e.target.value); setError(null) }}
                  onKeyDown={handleKeyDown}
                  placeholder="Escanea o pega el token..."
                  autoComplete="off"
                  className="flex-1 bg-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm border border-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40"
                />
                <button
                  onClick={() => { const v = tokenInput.trim(); if (v) cargarPreview(v) }}
                  disabled={!tokenInput.trim() || loading}
                  className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 font-bold px-4 py-3 rounded-xl text-sm transition-colors"
                >
                  {loading ? '...' : 'OK'}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}

            {/* Botón cámara */}
            <button
              onClick={() => setShowScanner(true)}
              className="w-full text-slate-500 hover:text-slate-300 text-xs text-center py-1 transition-colors"
            >
              📷 Usar cámara en su lugar
            </button>
          </div>
        </div>
      </div>

      {/* Escáner de cámara (si se prefiere) */}
      {showScanner && (
        <QRScannerModal
          onScan={token => { setShowScanner(false); setTokenInput(token); cargarPreview(token) }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </>
  )
}
