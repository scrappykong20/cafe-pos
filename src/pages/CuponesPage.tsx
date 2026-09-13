import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'

interface Props { cajero: CajeroActivo; onVolver: () => void }
interface Cupon { id: string; codigo: string; descripcion: string | null; tipo: string; valor: number; usos_maximos: number; usos_actuales: number; valido_desde: string | null; valido_hasta: string | null; activo: boolean; created_at: string }

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

function generarCodigo(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function CuponesPage({ cajero: _cajero, onVolver }: Props) {
  const [cupones, setCupones] = useState<Cupon[]>([])
  const [loading, setLoading] = useState(true)
  const [showNuevo, setShowNuevo] = useState(false)
  const [codigo, setCodigo] = useState(generarCodigo())
  const [descripcion, setDescripcion] = useState('')
  const [tipo, setTipo] = useState<'porcentaje' | 'fijo'>('porcentaje')
  const [valor, setValor] = useState('')
  const [usosMax, setUsosMax] = useState('1')
  const [validoDesde, setValidoDesde] = useState('')
  const [validoHasta, setValidoHasta] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'activos' | 'usados'>('activos')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('cupones').select('*').order('created_at', { ascending: false })
      if (error) { toast.error('Error al cargar cupones'); return }
      setCupones((data as Cupon[]) ?? [])
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (guardando) return
    const v = parseFloat(valor)
    if (!codigo.trim() || isNaN(v) || v <= 0) return
    setGuardando(true)
    const { error } = await supabase.from('cupones').insert({
      codigo: codigo.trim().toUpperCase(),
      descripcion: descripcion.trim() || null,
      tipo, valor: v,
      usos_maximos: parseInt(usosMax) || 1,
      usos_actuales: 0,
      valido_desde: validoDesde || null,
      valido_hasta: validoHasta || null,
      activo: true,
    })
    setGuardando(false)
    if (error) { toast.error('Error al crear cupón: ' + error.message); return }
    setCodigo(generarCodigo()); setDescripcion(''); setValor(''); setUsosMax('1'); setValidoDesde(''); setValidoHasta('')
    setShowNuevo(false); cargar()
  }

  async function toggleActivo(cupon: Cupon) {
    const { error } = await supabase.from('cupones').update({ activo: !cupon.activo }).eq('id', cupon.id)
    if (error) { toast.error('Error al actualizar cupón'); return }
    cargar()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este cupón?')) return
    const { error } = await supabase.from('cupones').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar cupón'); return }
    cargar()
  }

  const filtrados = cupones.filter(c => {
    if (filtro === 'activos') return c.activo && c.usos_actuales < c.usos_maximos
    if (filtro === 'usados') return c.usos_actuales >= c.usos_maximos || !c.activo
    return true
  })

  const s = { background: 'var(--dark)', minHeight: '100vh' }
  const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1rem', marginBottom: '0.75rem' }
  const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>🎟 Cupones</h1>
          <button onClick={() => setShowNuevo(true)} style={{ marginLeft: 'auto', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, padding: '0.5rem 1rem', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>+ Nuevo</button>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.25rem' }}>
          {(['todos', 'activos', 'usados'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} style={{ flex: 1, padding: '0.45rem', background: filtro === f ? 'var(--yellow)' : 'transparent', color: filtro === f ? '#000' : 'var(--muted)', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
              {f === 'todos' ? 'Todos' : f === 'activos' ? 'Activos' : 'Agotados/Off'}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem', fontWeight: 900 }}>Cargando...</div> :
          filtrados.length === 0 ? <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>Sin cupones</div> :
          filtrados.map(c => {
            const agotado = c.usos_actuales >= c.usos_maximos
            const color = !c.activo ? '#6b7280' : agotado ? '#f59e0b' : '#22c55e'
            return (
              <div key={c.id} style={{ ...card, borderLeft: `4px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                      <code style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.1em', background: 'var(--dark)', padding: '0.2rem 0.5rem', borderRadius: 2 }}>{c.codigo}</code>
                      <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.9rem' }}>{c.tipo === 'porcentaje' ? `${c.valor}% OFF` : `${fmt(c.valor)} OFF`}</span>
                    </div>
                    {c.descripcion && <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>{c.descripcion}</div>}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ color, fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        {!c.activo ? 'INACTIVO' : agotado ? 'AGOTADO' : 'ACTIVO'}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: '0.65rem', fontWeight: 900 }}>Usos: {c.usos_actuales}/{c.usos_maximos}</span>
                      {c.valido_hasta && <span style={{ color: 'var(--muted)', fontSize: '0.65rem', fontWeight: 900 }}>Hasta: {c.valido_hasta}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button onClick={() => toggleActivo(c)} style={{ padding: '0.35rem 0.65rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer' }}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                    <button onClick={() => eliminar(c.id)} style={{ padding: '0.35rem 0.65rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 2, color: '#ef4444', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}

        {/* Modal nuevo cupón */}
        {showNuevo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowNuevo(false)}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', borderRadius: 2, padding: '1.5rem', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>🎟 Nuevo Cupón</div>
              <form onSubmit={crear}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Código</label>
                    <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="CAFE20" required style={{ ...inp, marginBottom: 0, fontFamily: 'monospace', fontSize: '1rem', letterSpacing: '0.1em' }} />
                  </div>
                  <button type="button" onClick={() => setCodigo(generarCodigo())} style={{ padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.7rem', cursor: 'pointer', marginBottom: '0.6rem', whiteSpace: 'nowrap' }}>🔀 Auto</button>
                </div>
                <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Descripción (opcional)" style={inp} />
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <button type="button" onClick={() => setTipo('porcentaje')} style={{ flex: 1, padding: '0.5rem', background: tipo === 'porcentaje' ? 'var(--yellow)' : 'var(--dark)', color: tipo === 'porcentaje' ? '#000' : 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.7rem', cursor: 'pointer' }}>% Porcentaje</button>
                  <button type="button" onClick={() => setTipo('fijo')} style={{ flex: 1, padding: '0.5rem', background: tipo === 'fijo' ? 'var(--yellow)' : 'var(--dark)', color: tipo === 'fijo' ? '#000' : 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.7rem', cursor: 'pointer' }}>$ Fijo</button>
                </div>
                <input type="number" min="0.01" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder={tipo === 'porcentaje' ? 'Ej: 20 (para 20%)' : 'Ej: 50 (para $50)'} required style={inp} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Usos máx.</label>
                    <input type="number" min="1" value={usosMax} onChange={e => setUsosMax(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Válido desde</label>
                    <input type="date" value={validoDesde} onChange={e => setValidoDesde(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Válido hasta</label>
                    <input type="date" value={validoHasta} onChange={e => setValidoHasta(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setShowNuevo(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                  <button type="submit" disabled={guardando} style={{ flex: 1, padding: '0.65rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Crear Cupón</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
