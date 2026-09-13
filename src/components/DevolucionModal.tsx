import React, { useState, useRef } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

interface ItemVenta {
  nombre: string
  emoji: string
  cantidad: number
  precio: number
  subtotal: number
}

interface Props {
  venta: {
    id: string
    total: number
    metodo_pago: string
    mesa_nombre: string
    cajero_nombre: string
    created_at: string
    items?: ItemVenta[]
  }
  cajero: { id: string; nombre: string; last_name: string }
  onClose: () => void
  onCompletado: () => void
}

const MOTIVOS = [
  'Producto incorrecto',
  'Inconformidad cliente',
  'Error de cobro',
  'Otro',
]

const METODOS_DEVOLUCION = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'bonificación en cuenta', label: 'Bonificación en cuenta' },
]

function fmt(n: number) {
  return '$' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtFecha(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DevolucionModal({ venta, cajero, onClose, onCompletado }: Props) {
  const tieneItems = (venta.items ?? []).length > 0

  // Si tiene items: checkboxes para devolución parcial
  const [itemsSeleccionados, setItemsSeleccionados] = useState<boolean[]>(
    (venta.items ?? []).map(() => true)
  )

  // Si NO tiene items: monto manual
  const [montoManual, setMontoManual] = useState<string>(venta.total.toFixed(2))

  const [motivo, setMotivo] = useState<string>(MOTIVOS[0])
  const [metodoDevolucion, setMetodoDevolucion] = useState<string>('efectivo')
  const [loading, setLoading] = useState(false)
  const procesandoRef = useRef(false)

  // Calcular total a devolver
  const totalDevolver = tieneItems
    ? (venta.items ?? []).reduce((acc, item, idx) => {
        return acc + (itemsSeleccionados[idx] ? item.subtotal : 0)
      }, 0)
    : Math.min(parseFloat(montoManual) || 0, venta.total)

  function toggleItem(idx: number) {
    setItemsSeleccionados(prev => {
      const next = [...prev]
      next[idx] = !next[idx]
      return next
    })
  }

  async function confirmar() {
    if (procesandoRef.current) return
    if (totalDevolver <= 0) {
      toast.error('El monto a devolver debe ser mayor a $0')
      return
    }
    if (!motivo) {
      toast.error('Selecciona un motivo')
      return
    }

    procesandoRef.current = true
    setLoading(true)

    try {
      const itemsDevueltos = tieneItems
        ? (venta.items ?? []).filter((_, idx) => itemsSeleccionados[idx])
        : []

      // INSERT en tabla devoluciones
      const { error: insertError } = await supabase.from('devoluciones').insert({
        venta_id: venta.id,
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`.trim(),
        motivo,
        monto: totalDevolver,
        metodo_devolucion: metodoDevolucion,
        items: itemsDevueltos.length > 0 ? itemsDevueltos : null,
      })

      if (insertError) {
        console.error('Error al registrar devolución:', insertError.message)
        toast.error('Error al registrar la devolución')
        setLoading(false)
        return
      }

      // UPDATE ventas SET devuelta=true
      const { error: devueltaErr } = await supabase.from('ventas').update({ devuelta: true }).eq('id', venta.id)
      if (devueltaErr) {
        console.error('devuelta update failed:', devueltaErr.message)
        toast.error('Error al marcar venta como devuelta')
        setLoading(false)
        return
      }

      // Restar engranajes si el cliente los ganó con esta venta
      const { data: ventaData, error: ventaErr } = await supabase
        .from('ventas')
        .select('usuario_id, engranajes_ganados')
        .eq('id', venta.id)
        .maybeSingle()

      if (ventaErr) {
        console.error('Error al leer venta para revertir engranajes:', ventaErr.message)
      } else if (ventaData?.usuario_id && (ventaData.engranajes_ganados ?? 0) > 0) {
        const { data: perfil, error: perfilErr } = await supabase
          .from('usuarios')
          .select('engranajes')
          .eq('id', ventaData.usuario_id)
          .maybeSingle()

        if (perfilErr) {
          console.error('Error al leer perfil para revertir engranajes:', perfilErr.message)
        } else if (perfil) {
          const nuevosEngranajes = Math.max(0, (perfil.engranajes ?? 0) - ventaData.engranajes_ganados)
          const { error: engErr } = await supabase
            .from('usuarios')
            .update({ engranajes: nuevosEngranajes })
            .eq('id', ventaData.usuario_id)
          if (engErr) {
            toast.error('Error al revertir engranajes: ' + engErr.message)
            return
          }
        }
      }

      toast.success('Devolución registrada')
      onCompletado()
    } catch (e) {
      console.error('Error inesperado en devolución:', e)
      toast.error('Error inesperado')
      setLoading(false)
      procesandoRef.current = false
    } finally {
      procesandoRef.current = false
    }
  }

  return (
    <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.modal}>
        {/* HEADER */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>↩ DEVOLUCIÓN</span>
          <button onClick={onClose} style={styles.closeBtn} disabled={loading}>✕</button>
        </div>

        <div style={styles.body}>
          {/* RESUMEN DE LA VENTA ORIGINAL */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>VENTA ORIGINAL</div>
            <div style={styles.resumenGrid}>
              <div style={styles.resumenRow}>
                <span style={styles.resumenKey}>MESA</span>
                <span style={styles.resumenVal}>{venta.mesa_nombre ?? '—'}</span>
              </div>
              <div style={styles.resumenRow}>
                <span style={styles.resumenKey}>CAJERO</span>
                <span style={styles.resumenVal}>{venta.cajero_nombre ?? '—'}</span>
              </div>
              <div style={styles.resumenRow}>
                <span style={styles.resumenKey}>MÉTODO</span>
                <span style={styles.resumenVal}>{(venta.metodo_pago ?? '').toUpperCase()}</span>
              </div>
              <div style={styles.resumenRow}>
                <span style={styles.resumenKey}>FECHA</span>
                <span style={styles.resumenVal}>{fmtFecha(venta.created_at)}</span>
              </div>
              <div style={styles.resumenRow}>
                <span style={styles.resumenKey}>TOTAL ORIGINAL</span>
                <span style={{ ...styles.resumenVal, color: '#4ADE80' }}>{fmt(venta.total)}</span>
              </div>
            </div>
          </div>

          {/* ITEMS CON CHECKBOXES (devolución parcial) */}
          {tieneItems && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>SELECCIONA ITEMS A DEVOLVER</div>
              <div style={styles.itemsList}>
                {(venta.items ?? []).map((item, idx) => (
                  <label key={idx} style={styles.itemLabel}>
                    <input
                      type="checkbox"
                      checked={itemsSeleccionados[idx]}
                      onChange={() => toggleItem(idx)}
                      style={styles.checkbox}
                      disabled={loading}
                    />
                    <span style={styles.itemEmoji}>{item.emoji ?? '🍽️'}</span>
                    <span style={styles.itemNombre}>{item.nombre}</span>
                    <span style={styles.itemCant}>×{item.cantidad}</span>
                    <span style={styles.itemSubtotal}>{fmt(item.subtotal)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* MONTO MANUAL (si no tiene items) */}
          {!tieneItems && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>MONTO A DEVOLVER</div>
              <div style={styles.inputWrap}>
                <span style={styles.inputPrefix}>$</span>
                <input
                  type="number"
                  min="0"
                  max={venta.total}
                  step="0.01"
                  value={montoManual}
                  onChange={e => setMontoManual(e.target.value)}
                  style={styles.montoInput}
                  disabled={loading}
                />
              </div>
              <div style={styles.inputHint}>MÁXIMO: {fmt(venta.total)}</div>
            </div>
          )}

          {/* MOTIVO */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>MOTIVO *</div>
            <select
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              style={styles.select}
              disabled={loading}
            >
              {MOTIVOS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* MÉTODO DE DEVOLUCIÓN */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>MÉTODO DE DEVOLUCIÓN</div>
            <div style={styles.metodosWrap}>
              {METODOS_DEVOLUCION.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMetodoDevolucion(m.value)}
                  style={{
                    ...styles.metodoBtn,
                    ...(metodoDevolucion === m.value ? styles.metodoBtnActive : {}),
                  }}
                  disabled={loading}
                >
                  {m.label.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* TOTAL A DEVOLVER */}
          <div style={styles.totalDevolver}>
            <span style={styles.totalDevolverLabel}>TOTAL A DEVOLVER</span>
            <span style={styles.totalDevolverVal}>{fmt(totalDevolver)}</span>
          </div>

          {/* BOTÓN CONFIRMAR */}
          <button
            onClick={confirmar}
            disabled={loading || totalDevolver <= 0}
            style={{
              ...styles.confirmBtn,
              ...(loading || totalDevolver <= 0 ? styles.confirmBtnDisabled : {}),
            }}
          >
            {loading ? 'PROCESANDO...' : '↩ CONFIRMAR DEVOLUCIÓN'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modal: {
    background: 'var(--charcoal)',
    border: '2px solid #F87171',
    width: '100%',
    maxWidth: 500,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    background: 'var(--dark)',
    borderBottom: '2px solid #F87171',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: '#F87171',
    textTransform: 'uppercase',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 900,
    padding: '4px 10px',
    fontFamily: 'inherit',
  },
  body: {
    overflowY: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },

  // SECTION
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // RESUMEN
  resumenGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    padding: '10px 14px',
  },
  resumenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resumenKey: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  resumenVal: {
    fontSize: 11,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },

  // ITEMS
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  itemLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    padding: '8px 12px',
    cursor: 'pointer',
  },
  checkbox: {
    width: 16,
    height: 16,
    cursor: 'pointer',
    accentColor: '#F87171',
    flexShrink: 0,
  },
  itemEmoji: {
    fontSize: 15,
    width: 20,
    textAlign: 'center',
    flexShrink: 0,
  },
  itemNombre: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemCant: {
    fontSize: 10,
    fontWeight: 900,
    color: 'var(--muted)',
    letterSpacing: '0.1em',
    flexShrink: 0,
    width: 28,
    textAlign: 'center',
  },
  itemSubtotal: {
    fontSize: 11,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
    flexShrink: 0,
    width: 65,
    textAlign: 'right',
  },

  // MONTO MANUAL
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    padding: '0 12px',
  },
  inputPrefix: {
    fontSize: 16,
    fontWeight: 900,
    color: 'var(--muted)',
    marginRight: 4,
    flexShrink: 0,
  },
  montoInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 900,
    letterSpacing: '0.05em',
    flex: 1,
    padding: '10px 0',
    fontFamily: 'inherit',
    width: '100%',
  },
  inputHint: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // MOTIVO
  select: {
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '10px 12px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    width: '100%',
  },

  // MÉTODOS
  metodosWrap: {
    display: 'flex',
    gap: 0,
  },
  metodoBtn: {
    flex: 1,
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    borderRight: 'none',
    color: 'var(--muted)',
    padding: '8px 6px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
  metodoBtnActive: {
    background: '#F87171',
    color: '#000',
    border: '1px solid #F87171',
    borderRight: 'none',
  },

  // TOTAL
  totalDevolver: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--dark)',
    border: '2px solid #F87171',
    padding: '12px 16px',
  },
  totalDevolverLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  totalDevolverVal: {
    fontSize: 22,
    fontWeight: 900,
    color: '#F87171',
    letterSpacing: '0.05em',
  },

  // BOTÓN CONFIRMAR
  confirmBtn: {
    background: '#F87171',
    border: 'none',
    color: '#000',
    padding: '14px',
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%',
    transition: 'opacity 0.1s',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
}
