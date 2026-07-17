import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'

interface Props { cajero: CajeroActivo; onVolver: () => void }
interface HappyHour { id: string; nombre: string; descuento_porcentaje: number; hora_inicio: string; hora_fin: string; dias_semana: number[]; activo: boolean }

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function fmtHora(t: string) {
  const [hh, mm] = t.split(':').map(Number)
  const suffix = hh >= 12 ? 'pm' : 'am'
  const h = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh
  return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2,'0')}${suffix}`
}

function estaActivo(hh: HappyHour): boolean {
  if (!hh.activo) return false
  const ahora = new Date()
  const dia = ahora.getDay()
  if (!hh.dias_semana.includes(dia)) return false
  const hhmm = ahora.toTimeString().slice(0, 5)
  return hhmm >= hh.hora_inicio.slice(0, 5) && hhmm <= hh.hora_fin.slice(0, 5)
}

export default function HappyHoursPage({ cajero: _cajero, onVolver }: Props) {
  const [happyHours, setHappyHours] = useState<HappyHour[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [descuento, setDescuento] = useState('')
  const [horaInicio, setHoraInicio] = useState('15:00')
  const [horaFin, setHoraFin] = useState('17:00')
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('happy_hours').select('*').order('hora_inicio')
    setHappyHours((data as HappyHour[]) ?? [])
    setLoading(false)
  }

  function abrirForm(hh?: HappyHour) {
    if (hh) {
      setEditId(hh.id); setNombre(hh.nombre); setDescuento(String(hh.descuento_porcentaje))
      setHoraInicio(hh.hora_inicio.slice(0, 5)); setHoraFin(hh.hora_fin.slice(0, 5)); setDias(hh.dias_semana)
    } else {
      setEditId(null); setNombre(''); setDescuento(''); setHoraInicio('15:00'); setHoraFin('17:00'); setDias([1,2,3,4,5])
    }
    setShowForm(true)
  }

  function toggleDia(d: number) {
    setDias(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    const desc = parseFloat(descuento)
    if (!nombre.trim() || isNaN(desc) || desc <= 0 || dias.length === 0) return

    // Validar que la hora de fin sea posterior a la de inicio
    if (horaFin <= horaInicio) {
      alert('La hora de fin debe ser posterior a la hora de inicio')
      return
    }

    // Validar que no haya traslape con otros happy hours en los mismos días
    const conflicto = happyHours.find(hh => {
      if (editId && hh.id === editId) return false
      const diasEnComun = hh.dias_semana.some(d => dias.includes(d))
      if (!diasEnComun) return false
      const existeInicio = hh.hora_inicio.slice(0, 5)
      const existeFin = hh.hora_fin.slice(0, 5)
      return horaInicio < existeFin && horaFin > existeInicio
    })
    if (conflicto) {
      alert(`Conflicto de horario con "${conflicto.nombre}" (${fmtHora(conflicto.hora_inicio)}–${fmtHora(conflicto.hora_fin)}).\nAjusta los horarios para que no se traslapen.`)
      return
    }

    setGuardando(true)
    const payload = { nombre: nombre.trim(), descuento_porcentaje: desc, hora_inicio: horaInicio, hora_fin: horaFin, dias_semana: dias, activo: true }
    if (editId) {
      await supabase.from('happy_hours').update(payload).eq('id', editId)
    } else {
      await supabase.from('happy_hours').insert(payload)
    }
    setGuardando(false); setShowForm(false); cargar()
  }

  async function toggleActivo(hh: HappyHour) {
    await supabase.from('happy_hours').update({ activo: !hh.activo }).eq('id', hh.id); cargar()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este happy hour?')) return
    await supabase.from('happy_hours').delete().eq('id', id); cargar()
  }

  const s = { background: 'var(--dark)', minHeight: '100vh' }
  const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1.25rem', marginBottom: '0.75rem' }
  const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>⚡ Happy Hours</h1>
          <button onClick={() => abrirForm()} style={{ marginLeft: 'auto', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, padding: '0.5rem 1rem', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>+ Nuevo</button>
        </div>

        <div style={{ ...card, background: 'rgba(240,168,0,0.05)', borderLeft: '4px solid var(--yellow)' }}>
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: 0 }}>
            Los happy hours activos se aplican automáticamente al abrir el CheckoutModal. El sistema detecta si la hora actual está dentro del rango configurado.
          </p>
        </div>

        {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem', fontWeight: 900 }}>Cargando...</div> :
          happyHours.length === 0 ? <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>Sin happy hours configurados</div> :
          happyHours.map(hh => {
            const activo = estaActivo(hh)
            return (
              <div key={hh.id} style={{ ...card, borderLeft: `4px solid ${activo ? '#22c55e' : hh.activo ? 'var(--yellow)' : 'var(--border)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      {activo && <span style={{ background: '#22c55e', color: '#000', fontWeight: 900, fontSize: '0.55rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: '0.2rem 0.5rem', borderRadius: 2 }}>🟢 ACTIVO AHORA</span>}
                      <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.95rem' }}>{hh.nombre}</span>
                      <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1rem' }}>{hh.descuento_porcentaje}% OFF</span>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 900 }}>
                      🕐 {fmtHora(hh.hora_inicio)} – {fmtHora(hh.hora_fin)}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                      {DIAS.map((d, i) => (
                        <span key={i} style={{ padding: '0.15rem 0.4rem', borderRadius: 2, fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', background: hh.dias_semana.includes(i) ? 'rgba(240,168,0,0.15)' : 'var(--dark)', color: hh.dias_semana.includes(i) ? 'var(--yellow)' : 'var(--muted)', border: `1px solid ${hh.dias_semana.includes(i) ? 'rgba(240,168,0,0.4)' : 'var(--border)'}` }}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0 }}>
                    <button onClick={() => abrirForm(hh)} style={{ padding: '0.35rem 0.65rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer' }}>✏️ Editar</button>
                    <button onClick={() => toggleActivo(hh)} style={{ padding: '0.35rem 0.65rem', background: hh.activo ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${hh.activo ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 2, color: hh.activo ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer' }}>
                      {hh.activo ? 'Pausar' : 'Activar'}
                    </button>
                    <button onClick={() => eliminar(hh.id)} style={{ padding: '0.35rem 0.65rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 2, color: 'rgba(239,68,68,0.6)', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer' }}>🗑</button>
                  </div>
                </div>
              </div>
            )
          })}

        {/* Modal form */}
        {showForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowForm(false)}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', borderRadius: 2, padding: '1.5rem', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>{editId ? '✏️ Editar' : '+ Nuevo'} Happy Hour</div>
              <form onSubmit={guardar}>
                <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre (ej: Tarde feliz)" required style={inp} />
                <input type="number" min="1" max="100" value={descuento} onChange={e => setDescuento(e.target.value)} placeholder="Descuento %" required style={inp} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Hora inicio</label>
                    <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Hora fin</label>
                    <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                  </div>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.4rem' }}>Días de la semana</label>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {DIAS.map((d, i) => (
                      <button key={i} type="button" onClick={() => toggleDia(i)} style={{ flex: 1, padding: '0.4rem 0', background: dias.includes(i) ? 'var(--yellow)' : 'var(--dark)', color: dias.includes(i) ? '#000' : 'var(--muted)', border: `1px solid ${dias.includes(i) ? 'var(--yellow)' : 'var(--border)'}`, borderRadius: 2, fontWeight: 900, fontSize: '0.6rem', cursor: 'pointer' }}>{d}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                  <button type="submit" disabled={guardando || dias.length === 0} style={{ flex: 1, padding: '0.65rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer', opacity: dias.length === 0 ? 0.5 : 1 }}>
                    {guardando ? 'Guardando...' : editId ? 'Actualizar' : 'Crear'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
