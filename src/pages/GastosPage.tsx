import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import toast from 'react-hot-toast'

interface Props { cajero: CajeroActivo; onVolver: () => void }
interface Gasto { id: string; fecha: string; concepto: string; categoria: string; monto: number; cajero_nombre: string; notas: string | null; created_at: string }
interface GastoRecurrente { id: string; concepto: string; categoria: string; monto: number; dia_mes: number; activo: boolean; created_at: string }

const CATEGORIAS = [
  { id: 'insumos', label: 'Insumos', color: '#22c55e' },
  { id: 'servicios', label: 'Servicios', color: '#3b82f6' },
  { id: 'nomina', label: 'Nómina', color: '#a855f7' },
  { id: 'mantenimiento', label: 'Mantenimiento', color: '#f59e0b' },
  { id: 'otro', label: 'Otro', color: '#6b7280' },
]

function catColor(cat: string) { return CATEGORIAS.find(c => c.id === cat)?.color ?? '#6b7280' }
function catLabel(cat: string) { return CATEGORIAS.find(c => c.id === cat)?.label ?? cat }

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtFecha = (s: string) => new Date(s).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtHora = (s: string) => new Date(s).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

export default function GastosPage({ cajero, onVolver }: Props) {
  const [tab, setTab] = useState<'hoy' | 'historial'>('hoy')
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [loading, setLoading] = useState(true)
  const [concepto, setConcepto] = useState('')
  const [categoria, setCategoria] = useState('insumos')
  const [monto, setMonto] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Gastos recurrentes
  const [recurrentes, setRecurrentes] = useState<GastoRecurrente[]>([])
  const [recurrentesVisible, setRecurrentesVisible] = useState(false)
  const [showNuevoRecurrente, setShowNuevoRecurrente] = useState(false)
  const [rConcepto, setRConcepto] = useState('')
  const [rCategoria, setRCategoria] = useState('insumos')
  const [rMonto, setRMonto] = useState('')
  const [rDia, setRDia] = useState('1')
  const [rActivo, setRActivo] = useState(true)
  const [guardandoR, setGuardandoR] = useState(false)
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current) }, [])

  useEffect(() => {
    verificarGastosRecurrentes()
  }, [])

  useEffect(() => { cargar() }, [tab])

  async function verificarGastosRecurrentes() {
    const HOY = new Date().toDateString()
    const ultimoChequeo = sessionStorage.getItem('gastos_recurrentes_chequeo')
    if (ultimoChequeo === HOY) return

    const { data: recData, error } = await supabase
      .from('gastos_recurrentes')
      .select('*')
      .eq('activo', true)

    if (error) {
      // 42P01 = tabla no existe — silencioso
      return
    }

    if (!recData || recData.length === 0) return

    const hoy = new Date()
    const mesActual = hoy.getMonth() + 1
    const anioActual = hoy.getFullYear()
    const fechaHoy = hoy.toISOString().split('T')[0]

    for (const rec of recData as GastoRecurrente[]) {
      // Solo registrar en el día del mes configurado
      if (hoy.getDate() !== rec.dia_mes) continue

      // Verificar si ya existe un gasto con ese concepto en este mes/año
      const inicioMes = `${anioActual}-${String(mesActual).padStart(2, '0')}-01`
      const finMes = new Date(anioActual, mesActual, 0).toISOString().split('T')[0]

      const { data: existe } = await supabase
        .from('gastos')
        .select('id')
        .eq('concepto', rec.concepto)
        .gte('fecha', inicioMes)
        .lte('fecha', finMes)
        .limit(1)

      if (!existe || existe.length === 0) {
        const { error: insError } = await supabase.from('gastos').insert({
          concepto: rec.concepto,
          categoria: rec.categoria,
          monto: rec.monto,
          cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
          fecha: fechaHoy,
          notas: 'Gasto recurrente auto-registrado',
        })
        if (!insError) {
          toast(`⚙️ Gasto recurrente registrado: ${rec.concepto}`, { duration: 4000 })
        }
      }
    }
    sessionStorage.setItem('gastos_recurrentes_chequeo', HOY)
  }

  async function cargar() {
    setLoading(true)
    try {
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      let query = supabase.from('gastos').select('*').order('created_at', { ascending: false })
      if (tab === 'hoy') {
        query = query.eq('fecha', hoy.toISOString().split('T')[0])
      } else {
        const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        query = query.gte('fecha', hace30.toISOString().split('T')[0])
      }
      const { data, error } = await query
      if (error) { toast.error('Error al cargar gastos'); return }
      setGastos((data as Gasto[]) ?? [])

      // Cargar recurrentes silenciosamente
      cargarRecurrentes()
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }

  async function cargarRecurrentes() {
    const { data, error } = await supabase
      .from('gastos_recurrentes')
      .select('*')
      .order('dia_mes', { ascending: true })

    if (error) {
      // 42P01 tabla no existe — no mostrar sección
      setRecurrentesVisible(false)
      return
    }
    setRecurrentes((data as GastoRecurrente[]) ?? [])
    setRecurrentesVisible(true)
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    if (guardando) return
    const m = parseFloat(monto)
    if (!concepto.trim() || isNaN(m) || m <= 0) return
    setGuardando(true)
    const { error } = await supabase.from('gastos').insert({
      concepto: concepto.trim(), categoria, monto: m,
      cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
      fecha: new Date().toISOString().split('T')[0],
      notas: notas.trim() || null,
    })
    setGuardando(false)
    if (error) { setMsg('Error al guardar'); return }
    setConcepto(''); setMonto(''); setNotas('')
    setMsg('✓ Gasto registrado')
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    msgTimerRef.current = setTimeout(() => setMsg(null), 2500)
    cargar()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este gasto?')) return
    const { error } = await supabase.from('gastos').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar el gasto'); return }
    cargar()
  }

  async function crearRecurrente(e: React.FormEvent) {
    e.preventDefault()
    if (guardandoR) return
    const m = parseFloat(rMonto)
    if (!rConcepto.trim() || isNaN(m) || m <= 0) return
    setGuardandoR(true)
    const { error } = await supabase.from('gastos_recurrentes').insert({
      concepto: rConcepto.trim(),
      categoria: rCategoria,
      monto: m,
      dia_mes: parseInt(rDia) || 1,
      activo: rActivo,
    })
    setGuardandoR(false)
    if (error) { toast.error('Error al crear recurrente'); return }
    setRConcepto(''); setRMonto(''); setRDia('1'); setRActivo(true)
    setShowNuevoRecurrente(false)
    cargarRecurrentes()
  }

  async function eliminarRecurrente(id: string) {
    if (!confirm('¿Eliminar este gasto recurrente?')) return
    const { error } = await supabase.from('gastos_recurrentes').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar recurrente'); return }
    cargarRecurrentes()
  }

  async function toggleRecurrente(rec: GastoRecurrente) {
    const { error } = await supabase.from('gastos_recurrentes').update({ activo: !rec.activo }).eq('id', rec.id)
    if (error) { toast.error('Error al actualizar recurrente'); return }
    cargarRecurrentes()
  }

  const totalHoy = gastos.reduce((s, g) => s + Number(g.monto), 0)

  // Agrupar historial por fecha
  const porFecha = gastos.reduce<Record<string, Gasto[]>>((acc, g) => {
    acc[g.fecha] = [...(acc[g.fecha] ?? []), g]
    return acc
  }, {})

  const s = { background: 'var(--dark)', minHeight: '100vh', fontFamily: 'inherit' }
  const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1.25rem', marginBottom: '1rem' }
  const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }
  const labelStyle = { display: 'block', color: 'var(--muted)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase' as const, fontWeight: 900, marginBottom: '0.3rem' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>💸 Gastos</h1>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.25rem' }}>
          {(['hoy', 'historial'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '0.5rem', background: tab === t ? 'var(--yellow)' : 'transparent', color: tab === t ? '#000' : 'var(--muted)', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>
              {t === 'hoy' ? 'Hoy' : 'Historial 30 días'}
            </button>
          ))}
        </div>

        {msg && <div style={{ padding: '0.75rem', marginBottom: '1rem', background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', borderRadius: 2, color: '#22c55e', fontWeight: 900, fontSize: '0.85rem' }}>{msg}</div>}

        {/* Total del día */}
        {tab === 'hoy' && (
          <div style={{ ...card, borderLeft: '4px solid #ef4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Total egresos hoy</span>
            <span style={{ color: '#ef4444', fontWeight: 900, fontSize: '1.5rem' }}>{fmt(totalHoy)}</span>
          </div>
        )}

        {/* Lista */}
        {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem', fontWeight: 900 }}>Cargando...</div> : (
          tab === 'hoy' ? (
            <div style={card}>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Gastos de hoy</div>
              {gastos.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>Sin gastos registrados hoy</div> : gastos.map(g => (
                <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(g.categoria), flexShrink: 0, display: 'inline-block' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.85rem' }}>{g.concepto}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 900 }}>{catLabel(g.categoria)} · {fmtHora(g.created_at)}</div>
                  </div>
                  <span style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.9rem' }}>-{fmt(g.monto)}</span>
                  <button onClick={() => eliminar(g.id)} style={{ background: 'none', border: 'none', color: 'rgba(239,68,68,0.4)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.2rem 0.4rem' }}>✕</button>
                </div>
              ))}
            </div>
          ) : (
            Object.entries(porFecha).length === 0
              ? <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>Sin gastos en los últimos 30 días</div>
              : Object.entries(porFecha).map(([fecha, items]) => (
                <div key={fecha} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.85rem' }}>{fmtFecha(fecha)}</span>
                    <span style={{ color: '#ef4444', fontWeight: 900 }}>{fmt(items.reduce((s, g) => s + Number(g.monto), 0))}</span>
                  </div>
                  {items.map(g => (
                    <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: catColor(g.categoria), flexShrink: 0, display: 'inline-block' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'var(--text)', fontSize: '0.82rem', fontWeight: 700 }}>{g.concepto}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 900 }}>{catLabel(g.categoria)}</div>
                      </div>
                      <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.85rem' }}>-{fmt(g.monto)}</span>
                    </div>
                  ))}
                </div>
              ))
          )
        )}

        {/* Formulario nuevo gasto */}
        <div style={{ ...card, borderLeft: '4px solid var(--yellow)', marginTop: '1.5rem' }}>
          <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>+ Registrar gasto</div>
          <form onSubmit={agregar}>
            <label style={labelStyle}>Concepto</label>
            <input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Gas, café verde, limpieza..." style={inp} required />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Categoría</label>
                <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...inp, marginBottom: 0 }}>
                  {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Monto</label>
                <input type="number" min="0.01" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" style={{ ...inp, marginBottom: 0 }} required />
              </div>
            </div>

            <label style={{ ...labelStyle, marginTop: '0.6rem' }}>Notas (opcional)</label>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones..." style={inp} />

            <button type="submit" disabled={guardando || !concepto || !monto} style={{ width: '100%', padding: '0.7rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.8rem', letterSpacing: '0.2em', textTransform: 'uppercase', cursor: guardando ? 'not-allowed' : 'pointer', opacity: guardando ? 0.6 : 1 }}>
              {guardando ? 'Guardando...' : 'Registrar Gasto'}
            </button>
          </form>
        </div>

        {/* ── Sección Gastos Recurrentes ── */}
        {recurrentesVisible && (
          <div style={{ marginTop: '2rem' }}>
            {/* Header sección */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '2px solid #ef4444', marginBottom: '1rem' }}>
              <div>
                <p style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>// Automatización</p>
                <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.95rem', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>Gastos recurrentes</h2>
              </div>
              {cajero.es_admin && (
                <button
                  onClick={() => setShowNuevoRecurrente(v => !v)}
                  style={{ background: showNuevoRecurrente ? 'var(--dark)' : '#ef444422', color: showNuevoRecurrente ? 'var(--muted)' : '#ef4444', border: `1px solid ${showNuevoRecurrente ? 'var(--border)' : '#ef444455'}`, borderRadius: 2, padding: '0.4rem 0.85rem', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  {showNuevoRecurrente ? '✕ Cancelar' : '➕ Nuevo recurrente'}
                </button>
              )}
            </div>

            {/* Formulario nuevo recurrente */}
            {showNuevoRecurrente && (
              <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderLeft: '4px solid #ef4444', borderRadius: 2, padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.85rem' }}>Configurar recurrente</div>
                <form onSubmit={crearRecurrente}>
                  <label style={labelStyle}>Concepto</label>
                  <input value={rConcepto} onChange={e => setRConcepto(e.target.value)} placeholder="Ej: Renta local, Servicio de internet..." style={inp} required />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={labelStyle}>Categoría</label>
                      <select value={rCategoria} onChange={e => setRCategoria(e.target.value)} style={{ ...inp, marginBottom: 0 }}>
                        {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Monto</label>
                      <input type="number" min="0.01" step="0.01" value={rMonto} onChange={e => setRMonto(e.target.value)} placeholder="0.00" style={{ ...inp, marginBottom: 0 }} required />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', marginTop: '0.6rem' }}>
                    <div>
                      <label style={labelStyle}>Día del mes (1-31)</label>
                      <input type="number" min="1" max="31" value={rDia} onChange={e => setRDia(e.target.value)} style={{ ...inp, marginBottom: 0 }} required />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <label style={labelStyle}>Activo</label>
                      <button
                        type="button"
                        onClick={() => setRActivo(v => !v)}
                        style={{ padding: '0.58rem 0.9rem', background: rActivo ? '#22c55e22' : 'var(--dark)', border: `1px solid ${rActivo ? '#22c55e' : 'var(--border)'}`, borderRadius: 2, color: rActivo ? '#22c55e' : 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer', marginBottom: '0.6rem' }}
                      >
                        {rActivo ? 'Sí' : 'No'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button type="button" onClick={() => setShowNuevoRecurrente(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                    <button type="submit" disabled={guardandoR || !rConcepto || !rMonto} style={{ flex: 1, padding: '0.65rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: guardandoR ? 'not-allowed' : 'pointer', opacity: guardandoR ? 0.6 : 1 }}>
                      {guardandoR ? 'Guardando...' : 'Guardar recurrente'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Lista recurrentes */}
            {recurrentes.length === 0 ? (
              <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1.5rem', color: 'var(--muted)', textAlign: 'center', fontSize: '0.82rem', fontWeight: 900 }}>
                Sin gastos recurrentes configurados
              </div>
            ) : recurrentes.map(rec => (
              <div key={rec.id} style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderLeft: `4px solid ${rec.activo ? '#ef4444' : '#374151'}`, borderRadius: 2, padding: '0.85rem 1.1rem', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.88rem' }}>{rec.concepto}</span>
                    <span style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.85rem' }}>{fmt(rec.monto)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.62rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{catLabel(rec.categoria)}</span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.62rem', fontWeight: 900 }}>Día {rec.dia_mes} de cada mes</span>
                    <span style={{ color: rec.activo ? '#22c55e' : '#6b7280', fontSize: '0.62rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{rec.activo ? 'Activo' : 'Inactivo'}</span>
                  </div>
                </div>
                {cajero.es_admin && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button
                      onClick={() => toggleRecurrente(rec)}
                      style={{ padding: '0.3rem 0.6rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.62rem', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      {rec.activo ? 'Pausar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => eliminarRecurrente(rec.id)}
                      style={{ padding: '0.3rem 0.55rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 2, color: '#ef4444', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer' }}
                    >✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
