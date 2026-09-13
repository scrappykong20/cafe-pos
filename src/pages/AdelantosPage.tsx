import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import toast from 'react-hot-toast'

interface Props { cajero: CajeroActivo; onVolver: () => void }

interface Empleado { id: string; nombre: string; apellido: string; tipo: string; rol?: string }
interface Adelanto {
  id: string
  empleado_id: string
  monto: number
  concepto: string | null
  fecha: string
  registrado_por: string | null
  pagado: boolean
  pagado_at: string | null
  created_at: string
  emp_nombre?: string
}

const TIPO_COLORS: Record<string, string> = {
  cajero: '#22c55e', mesero: '#f59e0b', cocinero: '#ef4444', barista: '#f97316', otro: '#6b7280',
}

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtFecha = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

export default function AdelantosPage({ cajero, onVolver }: Props) {
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [adelantos, setAdelantos] = useState<Adelanto[]>([])
  const [loading, setLoading] = useState(true)

  // Form
  const [empId, setEmpId] = useState('')
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [guardando, setGuardando] = useState(false)

  // Confirmación pago inline
  const [confirmPago, setConfirmPago] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [empRes, adelRes] = await Promise.all([
        supabase.from('personal').select('id, nombre, apellido, rol').eq('activo', true).order('nombre'),
        supabase.from('adelantos').select('*').order('created_at', { ascending: false }).limit(50),
      ])
      if (empRes.error) { toast.error('Error al cargar empleados'); return; }
      if (adelRes.error) { toast.error('Error al cargar adelantos'); return; }
      const emps = ((empRes.data ?? []) as any[]).map(e => ({ ...e, tipo: e.rol ?? e.tipo ?? 'otro' })) as Empleado[]
      const adels = (adelRes.data ?? []) as Adelanto[]
      setEmpleados(emps)
      setAdelantos(adels.map(a => {
        const emp = emps.find(e => e.id === a.empleado_id)
        return { ...a, emp_nombre: emp ? `${emp.nombre} ${emp.apellido}` : 'Desconocido' }
      }))
    } catch {
      toast.error('Error de conexión al cargar adelantos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function registrar() {
    if (guardando) return;
    if (!empId) { toast.error('Selecciona un empleado'); return }
    const montoNum = parseFloat(monto)
    if (isNaN(montoNum) || montoNum <= 0) { toast.error('Monto inválido'); return }

    setGuardando(true)
    try {
      const { error } = await supabase.from('adelantos').insert({
        empleado_id: empId,
        monto: montoNum,
        concepto: concepto.trim() || null,
        fecha,
        registrado_por: `${cajero.nombre} ${cajero.last_name}`,
        pagado: false,
      })
      if (error) {
        toast.error('Error al registrar: ' + error.message)
      } else {
        toast.success(`✅ Adelanto de ${fmt(montoNum)} registrado`)
        setMonto('')
        setConcepto('')
        setEmpId('')
        cargar()
      }
    } catch {
      toast.error('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function marcarPagado(id: string) {
    if (procesando) return;
    setProcesando(true)
    setConfirmPago(null)   // cerrar inmediatamente para evitar doble submit
    try {
      const { error } = await supabase.from('adelantos')
        .update({ pagado: true, pagado_at: new Date().toISOString() })
        .eq('id', id)
      if (error) { toast.error('Error al actualizar'); return }
      toast.success('Marcado como pagado')
      cargar()
    } finally {
      setProcesando(false)
    }
  }

  const totalSemana = adelantos.filter(a => !a.pagado).reduce((s, a) => s + Number(a.monto), 0)
  const pendientes = adelantos.filter(a => !a.pagado)

  const empSelec = empleados.find(e => e.id === empId)

  return (
    <div style={s.root}>
      {/* Header */}
      <header style={s.header}>
        <button onClick={onVolver} style={s.backBtn}>← VOLVER</button>
        <div style={s.headerCenter}>
          <p style={s.headerSlug}>// Adelantos</p>
          <h1 style={s.headerTitle}>Adelantos a empleados</h1>
        </div>
        <div style={{ width: 110 }} />
      </header>

      <main style={s.main}>
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px 16px 32px' }}>

          {/* Stats rápidas */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={s.statCard}>
              <p style={s.statLabel}>💵 Pendiente de cobrar</p>
              <p style={{ ...s.statVal, color: '#ef4444' }}>{fmt(totalSemana)}</p>
            </div>
            <div style={s.statCard}>
              <p style={s.statLabel}>⏳ Adelantos sin cobrar</p>
              <p style={{ ...s.statVal, color: '#f59e0b' }}>{pendientes.length}</p>
            </div>
            <div style={s.statCard}>
              <p style={s.statLabel}>✅ Cobrados</p>
              <p style={{ ...s.statVal, color: '#22c55e' }}>{adelantos.filter(a => a.pagado).length}</p>
            </div>
          </div>

          {/* Formulario nuevo adelanto */}
          <div style={s.card}>
            <p style={s.cardTitle}>+ REGISTRAR ADELANTO</p>

            {/* Selector de empleado */}
            <div style={{ marginBottom: 12 }}>
              <p style={s.fieldLabel}>EMPLEADO</p>
              <select
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                style={s.select}
                disabled={guardando}
              >
                <option value="">— Seleccionar empleado —</option>
                {empleados.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.nombre} {e.apellido} ({e.tipo})
                  </option>
                ))}
              </select>
              {empSelec && (
                <span style={{
                  display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 900,
                  padding: '2px 8px', letterSpacing: '0.1em', textTransform: 'uppercase',
                  background: `${TIPO_COLORS[empSelec.tipo] ?? '#6b7280'}20`,
                  border: `1px solid ${TIPO_COLORS[empSelec.tipo] ?? '#6b7280'}50`,
                  color: TIPO_COLORS[empSelec.tipo] ?? '#6b7280',
                }}>
                  {empSelec.tipo}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {/* Monto */}
              <div>
                <p style={s.fieldLabel}>MONTO ($)</p>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontWeight: 900 }}>$</span>
                  <input
                    type="number"
                    min={1}
                    step={0.50}
                    placeholder="0.00"
                    value={monto}
                    onChange={e => setMonto(e.target.value)}
                    style={{ ...s.input, paddingLeft: 24 }}
                    disabled={guardando}
                    onKeyDown={e => e.key === 'Enter' && registrar()}
                  />
                </div>
              </div>

              {/* Fecha */}
              <div>
                <p style={s.fieldLabel}>FECHA</p>
                <input
                  type="date"
                  value={fecha}
                  onChange={e => setFecha(e.target.value)}
                  style={s.input}
                  disabled={guardando}
                />
              </div>
            </div>

            {/* Concepto */}
            <div style={{ marginBottom: 14 }}>
              <p style={s.fieldLabel}>CONCEPTO (OPCIONAL)</p>
              <input
                placeholder="ej. Urgencia médica, renta..."
                value={concepto}
                onChange={e => setConcepto(e.target.value)}
                style={s.input}
                disabled={guardando}
                onKeyDown={e => e.key === 'Enter' && registrar()}
              />
            </div>

            <button
              onClick={registrar}
              disabled={guardando || !empId || !monto}
              style={{
                ...s.btnYellow,
                opacity: guardando || !empId || !monto ? 0.4 : 1,
                cursor: guardando || !empId || !monto ? 'not-allowed' : 'pointer',
              }}
            >
              {guardando ? 'REGISTRANDO...' : '💵 REGISTRAR ADELANTO'}
            </button>
          </div>

          {/* Lista de adelantos */}
          <div style={{ marginTop: 20 }}>
            <p style={s.cardTitle}>HISTORIAL RECIENTE</p>

            {loading ? (
              <p style={s.emptyText}>Cargando...</p>
            ) : adelantos.length === 0 ? (
              <p style={s.emptyText}>SIN ADELANTOS REGISTRADOS</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {adelantos.map(a => (
                  <div key={a.id} style={{
                    ...s.adelRow,
                    borderLeft: `3px solid ${a.pagado ? '#22c55e' : '#ef4444'}`,
                    opacity: a.pagado ? 0.65 : 1,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={s.adelNombre}>{a.emp_nombre}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 900, padding: '2px 6px',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          background: a.pagado ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          border: `1px solid ${a.pagado ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
                          color: a.pagado ? '#22c55e' : '#ef4444',
                        }}>
                          {a.pagado ? 'COBRADO' : 'PENDIENTE'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={s.adelMeta}>{fmtFecha(a.fecha)}</span>
                        {a.concepto && <span style={s.adelMeta}>{a.concepto}</span>}
                        <span style={s.adelMeta}>Registró: {a.registrado_por ?? '—'}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: a.pagado ? 'var(--muted)' : '#ef4444', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(a.monto)}
                      </span>
                      {!a.pagado && (
                        confirmPago === a.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setConfirmPago(null)} style={s.btnCancel}>Cancelar</button>
                            <button onClick={() => marcarPagado(a.id)} style={s.btnConfirm}>✓ Sí, cobrado</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmPago(a.id)} style={s.btnPagar}>
                            Marcar cobrado
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--dark)', color: 'var(--text)', overflow: 'hidden' },
  header: { height: 60, background: 'var(--black)', borderBottom: '2px solid var(--yellow)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 },
  backBtn: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 14px', cursor: 'pointer', fontWeight: 900, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', width: 110, borderRadius: 0 },
  headerCenter: { textAlign: 'center' },
  headerSlug: { margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.25em', color: 'var(--yellow)', textTransform: 'uppercase' },
  headerTitle: { margin: 0, fontSize: 16, fontWeight: 900, letterSpacing: '0.15em', color: 'var(--text)', textTransform: 'uppercase' },
  main: { flex: 1, overflowY: 'auto' },

  statCard: { flex: '1 1 140px', background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '2px solid var(--border)', padding: '12px 14px' },
  statLabel: { margin: 0, fontSize: 9, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)' },
  statVal: { margin: '6px 0 0', fontSize: 20, fontWeight: 900 },

  card: { background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 0 },
  cardTitle: { margin: '0 0 14px', fontSize: 10, fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--yellow)' },

  fieldLabel: { margin: '0 0 5px', fontSize: 9, fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)' },
  select: { width: '100%', padding: '9px 12px', background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer', appearance: 'none', boxSizing: 'border-box', borderRadius: 0 },
  input: { width: '100%', padding: '9px 12px', background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, fontWeight: 700, outline: 'none', boxSizing: 'border-box', borderRadius: 0 },
  btnYellow: { width: '100%', padding: '12px', background: 'var(--yellow)', border: 'none', color: '#000', fontWeight: 900, fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', borderRadius: 0 },

  adelRow: { background: 'var(--charcoal)', border: '1px solid var(--border)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  adelNombre: { fontSize: 13, fontWeight: 900, letterSpacing: '0.05em', color: 'var(--text)', textTransform: 'uppercase' },
  adelMeta: { fontSize: 10, color: 'var(--muted)', fontWeight: 700 },

  btnPagar: { fontSize: 10, fontWeight: 900, padding: '4px 10px', background: 'transparent', border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 0 },
  btnCancel: { fontSize: 10, fontWeight: 900, padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 0 },
  btnConfirm: { fontSize: 10, fontWeight: 900, padding: '4px 10px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.6)', color: '#22c55e', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 0 },
  emptyText: { fontSize: 11, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', padding: '40px 0' },
}
