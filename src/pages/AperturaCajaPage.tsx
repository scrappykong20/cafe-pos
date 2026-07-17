import { useState } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import toast from 'react-hot-toast'

interface Props {
  cajero: CajeroActivo
  onAperturado: () => void
  onSalir: () => void
}

const BILLETES = [1000, 500, 200, 100, 50, 20]
const MONEDAS  = [10, 5, 2, 1, 0.5]

export default function AperturaCajaPage({ cajero, onAperturado, onSalir }: Props) {
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [abriendo, setAbriendo] = useState(false)

  function setCant(denom: number, val: string) {
    const n = parseInt(val) || 0
    setCantidades(prev => ({ ...prev, [String(denom)]: Math.max(0, n) }))
  }

  const totalFondo = [...BILLETES, ...MONEDAS].reduce((sum, d) => {
    return sum + d * (cantidades[String(d)] ?? 0)
  }, 0)

  async function confirmarApertura() {
    if (totalFondo < 0) return
    setAbriendo(true)
    try {
      const { error } = await supabase.from('cortes_caja').insert({
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        fondo_inicial: totalFondo,
        total_efectivo: 0,
        total_tarjeta: 0,
        total_mixto: 0,
        total_ventas: 0,
        num_ventas: 0,
        estado: 'abierto',
        turno: cajero.turno ?? 'mañana',
        total_propinas: 0,
        total_propinas_tarjeta: 0,
        total_propinas_efectivo: 0,
        apertura_at: new Date().toISOString(),
      })
      if (error) throw error
      toast.success(`✅ Caja abierta · Fondo: $${totalFondo.toFixed(2)}`)
      onAperturado()
    } catch (err: any) {
      toast.error(`Error al abrir caja: ${err?.message ?? 'desconocido'}`)
    } finally {
      setAbriendo(false)
    }
  }

  const fecha = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ background: 'var(--black)' }}>

      <div className="hazard-stripe-sm h-1 w-full absolute top-0 left-0" />

      <div className="w-full max-w-md flex flex-col gap-5 animate-slide-up">

        {/* Header */}
        <div className="text-center">
          <span className="text-4xl animate-gear inline-block">⚙️</span>
          <h1 className="font-black text-xl uppercase tracking-widest mt-3" style={{ color: 'var(--yellow)' }}>
            Apertura de Caja
          </h1>
          <p className="text-xs capitalize mt-1" style={{ color: 'var(--muted)' }}>{fecha} · {hora}</p>
          <p className="text-sm font-bold mt-2" style={{ color: 'var(--text)' }}>
            {cajero.nombre} {cajero.last_name}
            <span className="ml-2 text-xs font-black px-2 py-0.5"
              style={{ background: 'rgba(240,168,0,0.12)', border: '1px solid rgba(240,168,0,0.4)', color: 'var(--yellow)', borderRadius: 0 }}>
              {cajero.rol}
            </span>
          </p>
        </div>

        {/* Fondo inicial */}
        <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)' }}>

          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
              // Fondo inicial en caja
            </p>
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">

            {/* Billetes */}
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Billetes</p>
            <div className="grid grid-cols-3 gap-2">
              {BILLETES.map(d => (
                <div key={d} className="flex flex-col gap-1">
                  <label className="text-xs font-black" style={{ color: 'var(--muted)' }}>${d}</label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCant(d, String(Math.max(0, (cantidades[String(d)] ?? 0) - 1)))}
                      className="w-7 h-7 font-black text-sm flex items-center justify-center"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
                      −
                    </button>
                    <input
                      type="number" min="0"
                      value={cantidades[String(d)] ?? ''}
                      onChange={e => setCant(d, e.target.value)}
                      placeholder="0"
                      className="flex-1 text-center font-black text-sm py-1"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 0, width: 0 }}
                    />
                    <button
                      onClick={() => setCant(d, String((cantidades[String(d)] ?? 0) + 1))}
                      className="w-7 h-7 font-black text-sm flex items-center justify-center"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
                      +
                    </button>
                  </div>
                  {(cantidades[String(d)] ?? 0) > 0 && (
                    <span className="text-xs text-center" style={{ color: 'var(--yellow)' }}>
                      = ${(d * (cantidades[String(d)] ?? 0)).toFixed(0)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Monedas */}
            <p className="text-xs font-black uppercase tracking-widest mt-1" style={{ color: 'var(--muted)' }}>Monedas</p>
            <div className="grid grid-cols-5 gap-2">
              {MONEDAS.map(d => (
                <div key={d} className="flex flex-col gap-1">
                  <label className="text-xs font-black text-center" style={{ color: 'var(--muted)' }}>
                    ${d < 1 ? d.toFixed(1) : d}
                  </label>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => setCant(d, String((cantidades[String(d)] ?? 0) + 1))}
                      className="w-full py-0.5 font-black text-sm"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
                      +
                    </button>
                    <input
                      type="number" min="0"
                      value={cantidades[String(d)] ?? ''}
                      onChange={e => setCant(d, e.target.value)}
                      placeholder="0"
                      className="w-full text-center font-black text-xs py-1"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 0 }}
                    />
                    <button
                      onClick={() => setCant(d, String(Math.max(0, (cantidades[String(d)] ?? 0) - 1)))}
                      className="w-full py-0.5 font-black text-sm"
                      style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
                      −
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="px-4 py-3 flex items-center justify-between"
            style={{ borderTop: '2px solid var(--yellow)', background: 'rgba(240,168,0,0.06)' }}>
            <span className="font-black text-sm uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
              Total fondo
            </span>
            <span className="font-black text-2xl tabular-nums" style={{ color: 'var(--yellow)' }}>
              ${totalFondo.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Botones */}
        <div className="flex gap-3">
          <button onClick={onSalir}
            className="flex-1 py-3 font-black text-sm uppercase tracking-widest"
            style={{ background: 'var(--dark)', border: '2px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
            ← Salir
          </button>
          <button
            onClick={confirmarApertura}
            disabled={abriendo}
            className="flex-2 py-3 font-black text-sm uppercase tracking-widest flex-1"
            style={{
              background: 'var(--yellow)', border: '2px solid var(--yellow)',
              color: '#000', cursor: 'pointer', borderRadius: 0,
              flex: 2,
            }}>
            {abriendo ? '⏳ Abriendo...' : `✓ Abrir caja · $${totalFondo.toFixed(2)}`}
          </button>
        </div>

        <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
          Si no hay fondo, confirma con $0.00
        </p>
      </div>
    </div>
  )
}
