import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'
import { buildComandaHTML, imprimirHTML, getPrinterCocina } from '../services/printer'

interface DeliveryItem {
  id: string
  nombre: string
  emoji: string
  cantidad: number
  precio: number
  notas: string | null
}

interface DeliveryOrden {
  id: string
  created_at: string
  mesa_nombre: string
  cliente_nombre: string | null
  cliente_telefono: string | null
  direccion_entrega: string | null
  tipo_entrega: 'domicilio' | 'recoger' | null
  notas: string | null
  numero_diario: number | null
  orden_items: DeliveryItem[]
}

interface Props {
  cajero: CajeroActivo
}

export default function DeliveryAlerts({ cajero }: Props) {
  const [pendientes, setPendientes] = useState<DeliveryOrden[]>([])
  const [detalle, setDetalle] = useState<DeliveryOrden | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const prevCount = useRef(0)

  useEffect(() => {
    cargar()
    // Escuchar cambios en ordenes (cualquier cambio, filtramos en query)
    const ch = supabase.channel('delivery-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => {
    if (pendientes.length > prevCount.current) {
      sonarAlertas()
      toast('🛵 Nuevo pedido delivery', {
        duration: 6000,
        style: { background: '#ef4444', color: '#fff', fontWeight: 900, fontFamily: 'monospace' },
      })
    }
    prevCount.current = pendientes.length
  }, [pendientes.length])

  async function cargar() {
    const { data } = await supabase
      .from('ordenes')
      .select(`
        id, created_at, mesa_nombre, cliente_nombre, cliente_telefono,
        direccion_entrega, tipo_entrega, notas, numero_diario,
        orden_items(id, nombre, emoji, cantidad, precio, notas)
      `)
      .eq('canal', 'delivery')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
    setPendientes((data as DeliveryOrden[]) ?? [])
  }

  function sonarAlertas() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'square'
        osc.frequency.value = i % 2 === 0 ? 880 : 660
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.25)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.2)
        osc.start(ctx.currentTime + i * 0.25)
        osc.stop(ctx.currentTime + i * 0.25 + 0.2)
      }
    } catch {}
  }

  async function aceptar(orden: DeliveryOrden) {
    setProcesando(true)
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({
          estado: 'abierta',
          cajero_id: cajero.id,
          cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        })
        .eq('id', orden.id)
      if (error) throw error

      // Imprimir comanda en cocina
      const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })
      const infoLinea = [
        orden.cliente_telefono ? `📞 ${orden.cliente_telefono}` : null,
        orden.direccion_entrega ? `📍 ${orden.direccion_entrega}` : null,
        orden.notas ? `📝 ${orden.notas}` : null,
      ].filter(Boolean).join('  |  ')

      const html = buildComandaHTML({
        ordenStr: orden.numero_diario ? `#${orden.numero_diario}` : '',
        mesaNombre: orden.mesa_nombre,
        cajeroNombre: 'DELIVERY ONLINE',
        tipo: 'llevar',
        hora,
        items: orden.orden_items.map(i => ({ emoji: i.emoji, nombre: i.nombre, cantidad: i.cantidad, notas: i.notas })),
        notaOrden: infoLinea || undefined,
      })

      const printer = getPrinterCocina()
      let printed = false
      if (printer) printed = await imprimirHTML(printer, html)
      if (!printed) {
        const w = window.open('', '_blank', 'width=420,height=650,toolbar=no,menubar=no')
        if (w) { w.document.write(html); w.focus(); w.print(); setTimeout(() => w.close(), 3000) }
      }

      toast.success(`✅ Orden de ${orden.cliente_nombre} aceptada · comanda impresa`)
      setDetalle(null)
      cargar()
    } catch (err: any) {
      toast.error(err.message || 'Error al aceptar')
    } finally {
      setProcesando(false)
    }
  }

  async function rechazar(orden: DeliveryOrden) {
    setProcesando(true)
    try {
      await supabase.from('ordenes').update({ estado: 'cancelada' }).eq('id', orden.id)
      toast('Pedido rechazado', { icon: '❌' })
      setDetalle(null)
      cargar()
    } catch {
      toast.error('Error al rechazar')
    } finally {
      setProcesando(false)
    }
  }

  const totalOrden = (o: DeliveryOrden) =>
    o.orden_items.reduce((s, i) => s + i.precio * i.cantidad, 0)

  const tiempoRelativo = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (diff === 0) return 'ahora mismo'
    return `hace ${diff} min`
  }

  // Extrae método de pago de las notas (formato: "💵 Pago en efectivo | nota...")
  function parsearNotas(notas: string | null): { pago: string | null; notasLimpias: string | null } {
    if (!notas) return { pago: null, notasLimpias: null }
    if (notas.startsWith('💵') || notas.startsWith('💳')) {
      const partes = notas.split(' | ')
      const pago = partes[0]
      const resto = partes.slice(1).join(' | ').trim() || null
      return { pago, notasLimpias: resto }
    }
    return { pago: null, notasLimpias: notas }
  }

  function abrirWhatsApp(orden: DeliveryOrden) {
    const tel = orden.cliente_telefono?.replace(/\D/g, '') ?? ''
    const msg = encodeURIComponent(
      `Hola ${orden.cliente_nombre ?? 'cliente'}, te contactamos de El Café del Constructor sobre tu pedido. ¿Tienes un momento?`
    )
    window.open(`https://wa.me/52${tel}?text=${msg}`, '_blank', 'noopener,noreferrer')
  }

  if (pendientes.length === 0) return null

  return (
    <>
      {/* ── Badge flotante ──────────────────────────────────────── */}
      <button
        onClick={() => setShowPanel(true)}
        title={`${pendientes.length} pedido${pendientes.length !== 1 ? 's' : ''} delivery pendiente${pendientes.length !== 1 ? 's' : ''}`}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 800,
          width: 62, height: 62, border: 'none', borderRadius: '50%',
          background: '#ef4444', color: '#fff', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          boxShadow: '0 0 0 0 rgba(239,68,68,0.6)',
          animation: 'delivery-pulse 1.4s infinite',
        }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>🛵</span>
        <span style={{ fontSize: 11, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1 }}>
          {pendientes.length}
        </span>
      </button>

      {/* ── Panel lateral ──────────────────────────────────────── */}
      {showPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 850, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowPanel(false)} />
          <div style={{
            width: 360, maxWidth: '95vw', background: 'var(--charcoal)',
            borderLeft: '3px solid #ef4444', height: '100vh',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '14px 18px', background: 'var(--dark)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ color: '#ef4444', fontWeight: 900, fontSize: 14, textTransform: 'uppercase', letterSpacing: 2, margin: 0 }}>
                  🛵 Delivery pendiente
                </p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>
                  {pendientes.length} pedido{pendientes.length !== 1 ? 's' : ''} esperando confirmación
                </p>
              </div>
              <button onClick={() => setShowPanel(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pendientes.map(o => (
                <button
                  key={o.id}
                  onClick={() => { setDetalle(o); setShowPanel(false) }}
                  style={{
                    background: 'var(--dark)', border: '1px solid var(--border)',
                    borderLeft: '4px solid #ef4444', padding: '12px 14px',
                    textAlign: 'left', cursor: 'pointer', width: '100%',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                      <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: 14, margin: 0 }}>
                        {o.cliente_nombre || 'Sin nombre'}
                      </p>
                      <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0' }}>📞 {o.cliente_telefono}</p>
                      <p style={{ color: o.tipo_entrega === 'domicilio' ? '#ef4444' : '#22c55e', fontSize: 11, fontWeight: 900, margin: 0 }}>
                        {o.tipo_entrega === 'domicilio' ? '🛵 A domicilio' : '🏪 Recoger'}
                      </p>
                      {o.tipo_entrega === 'domicilio' && o.direccion_entrega && (
                        <p style={{
                          color: '#f97316', fontSize: 10, margin: '3px 0 0',
                          wordBreak: 'break-word', lineHeight: 1.3,
                        }}>
                          📍 {o.direccion_entrega}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: 15, margin: 0 }}>
                        ${totalOrden(o).toFixed(2)}
                      </p>
                      <p style={{ color: 'var(--muted)', fontSize: 10, margin: '3px 0 0' }}>
                        {tiempoRelativo(o.created_at)}
                      </p>
                    </div>
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: 11, margin: '6px 0 0' }}>
                    {o.orden_items.length} item{o.orden_items.length !== 1 ? 's' : ''} · Toca para revisar
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de detalle ────────────────────────────────────── */}
      {detalle && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.9)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--charcoal)', border: '1px solid var(--border)',
            borderTop: '4px solid #ef4444', width: '100%', maxWidth: 460,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '14px 18px', background: 'var(--dark)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ color: '#ef4444', fontWeight: 900, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                  🛵 Pedido delivery
                </p>
                <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>
                  {tiempoRelativo(detalle.created_at)}
                </p>
              </div>
              <button onClick={() => setDetalle(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Info cliente */}
              <div style={{ background: 'var(--dark)', border: '1px solid var(--border)', padding: 14 }}>
                <p style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Cliente
                </p>
                <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: 15, margin: '0 0 4px' }}>{detalle.cliente_nombre}</p>
                <p style={{ color: 'var(--yellow)', fontSize: 13, margin: '0 0 4px' }}>📞 {detalle.cliente_telefono}</p>
                {detalle.tipo_entrega === 'domicilio' && detalle.direccion_entrega && (
                  <p style={{ color: '#ef4444', fontSize: 13, margin: '0 0 4px' }}>📍 {detalle.direccion_entrega}</p>
                )}
                <p style={{ color: detalle.tipo_entrega === 'domicilio' ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: 13, margin: 0 }}>
                  {detalle.tipo_entrega === 'domicilio' ? '🛵 Entrega a domicilio' : '🏪 Pasará a recoger'}
                </p>
                {/* Método de pago y notas */}
                {(() => {
                  const { pago, notasLimpias } = parsearNotas(detalle.notas)
                  return (
                    <>
                      {pago && (
                        <p style={{
                          color: pago.startsWith('💵') ? '#22c55e' : '#60a5fa',
                          fontSize: 13, fontWeight: 900, marginTop: 8,
                          paddingTop: 8, borderTop: '1px solid var(--border)',
                        }}>
                          {pago}
                        </p>
                      )}
                      {notasLimpias && (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                          📝 {notasLimpias}
                        </p>
                      )}
                      {!pago && detalle.notas && (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                          📝 {detalle.notas}
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* Contactar cliente */}
              {detalle.cliente_telefono && (
                <div>
                  <p style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Contactar cliente
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <a
                      href={`tel:+52${detalle.cliente_telefono.replace(/\D/g, '')}`}
                      style={{
                        padding: '10px 8px', background: 'var(--dark)', color: '#22c55e',
                        fontWeight: 900, fontSize: 12, textTransform: 'uppercase',
                        border: '2px solid #22c55e', textDecoration: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        letterSpacing: 1, fontFamily: 'monospace', cursor: 'pointer',
                      }}>
                      📞 Llamar
                    </a>
                    <button
                      onClick={() => abrirWhatsApp(detalle)}
                      style={{
                        padding: '10px 8px', background: 'var(--dark)', color: '#25D366',
                        fontWeight: 900, fontSize: 12, textTransform: 'uppercase',
                        border: '2px solid #25D366', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        letterSpacing: 1, fontFamily: 'monospace',
                      }}>
                      💬 WhatsApp
                    </button>
                  </div>
                </div>
              )}

              {/* Items */}
              <div style={{ background: 'var(--dark)', border: '1px solid var(--border)', padding: 14 }}>
                <p style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Pedido ({detalle.orden_items.length} productos)
                </p>
                {detalle.orden_items.map(item => (
                  <div key={item.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: 14 }}>
                        {item.emoji} {item.nombre}
                        <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ×{item.cantidad}</span>
                      </span>
                      <span style={{ color: 'var(--yellow)', fontWeight: 900 }}>
                        ${(item.precio * item.cantidad).toFixed(2)}
                      </span>
                    </div>
                    {item.notas && (
                      <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0', paddingLeft: 8 }}>↳ {item.notas}</p>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: 15 }}>TOTAL</span>
                  <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: 20 }}>
                    ${totalOrden(detalle).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Acciones */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  onClick={() => rechazar(detalle)}
                  disabled={procesando}
                  style={{
                    padding: '14px', background: 'var(--dark)', color: '#ef4444',
                    fontWeight: 900, fontSize: 13, textTransform: 'uppercase',
                    border: '2px solid #ef4444', cursor: procesando ? 'not-allowed' : 'pointer',
                    letterSpacing: 1, fontFamily: 'monospace', opacity: procesando ? 0.5 : 1,
                  }}>
                  ✕ Rechazar
                </button>
                <button
                  onClick={() => aceptar(detalle)}
                  disabled={procesando}
                  style={{
                    padding: '14px', background: procesando ? '#555' : '#22c55e', color: '#000',
                    fontWeight: 900, fontSize: 13, textTransform: 'uppercase',
                    border: '2px solid #22c55e', cursor: procesando ? 'not-allowed' : 'pointer',
                    letterSpacing: 1, fontFamily: 'monospace',
                  }}>
                  {procesando ? '...' : '✓ Aceptar + Imprimir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Animación CSS */}
      <style>{`
        @keyframes delivery-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
          70%  { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
      `}</style>
    </>
  )
}
