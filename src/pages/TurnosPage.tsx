import React, { useEffect, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabase'
import type { UsuarioPerfil } from '../types'

interface Props {
  cajero: UsuarioPerfil
  onClose: () => void
}

type TabTurno = 'activos' | 'historial'

interface Turno {
  id: string
  cajero_nombre: string
  hora_entrada: string
  hora_salida: string | null
  horas_trabajadas: number | null
  created_at: string
}

interface ResumenEmpleado {
  nombre: string
  totalHoras: number
}

function getHoyISO(): { desde: string; hasta: string } {
  const ahora = new Date()
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  return {
    desde: hoy.toISOString(),
    hasta: new Date(hoy.getTime() + 86400000).toISOString(),
  }
}

function horasTranscurridas(entrada: string): string {
  const diff = Date.now() - new Date(entrada).getTime()
  const totalMin = Math.floor(diff / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function fmtHora(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtFecha(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function calcHoras(entrada: string, salida: string): number {
  const diff = new Date(salida).getTime() - new Date(entrada).getTime()
  return Math.max(0, parseFloat((diff / 3600000).toFixed(2)))
}

export default function TurnosPage({ cajero, onClose }: Props) {
  const [tab, setTab] = useState<TabTurno>('activos')
  const [activos, setActivos] = useState<Turno[]>([])
  const [historial, setHistorial] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [moduloNoExiste, setModuloNoExiste] = useState(false)
  const [registrandoEntrada, setRegistrandoEntrada] = useState(false)
  const [registrandoSalida, setRegistrandoSalida] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Tick cada minuto para actualizar horas transcurridas
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  // Suprimir warning de 'tick' no usado directamente — se usa solo para re-render
  void tick

  const cargarActivos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turnos_personal')
        .select('id, cajero_nombre, hora_entrada, hora_salida, horas_trabajadas, created_at')
        .is('hora_salida', null)
        .order('hora_entrada', { ascending: true })

      if (error) {
        const msg = error.message ?? ''
        if (
          msg.includes('does not exist') ||
          msg.includes('relation') ||
          msg.includes('42P01')
        ) {
          setModuloNoExiste(true)
          return
        }
        toast.error('Error al cargar turnos activos')
        return
      }
      setModuloNoExiste(false)
      setActivos(data ?? [])
    } catch {
      setModuloNoExiste(true)
    }
  }, [])

  const cargarHistorial = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turnos_personal')
        .select('id, cajero_nombre, hora_entrada, hora_salida, horas_trabajadas, created_at')
        .not('hora_salida', 'is', null)
        .order('hora_salida', { ascending: false })
        .limit(50)

      if (error) {
        const msg = error.message ?? ''
        if (
          msg.includes('does not exist') ||
          msg.includes('relation') ||
          msg.includes('42P01')
        ) {
          setModuloNoExiste(true)
          return
        }
        toast.error('Error al cargar historial de turnos')
        return
      }
      setModuloNoExiste(false)
      setHistorial(data ?? [])
    } catch {
      setModuloNoExiste(true)
    }
  }, [])

  const cargarTodo = useCallback(async () => {
    setLoading(true)
    await Promise.all([cargarActivos(), cargarHistorial()])
    setLoading(false)
  }, [cargarActivos, cargarHistorial])

  useEffect(() => {
    cargarTodo()
  }, [cargarTodo])

  // Real-time subscription
  useEffect(() => {
    if (moduloNoExiste) return

    const channel = supabase
      .channel('turnos_personal_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turnos_personal' },
        () => {
          cargarActivos()
          cargarHistorial()
        }
      )
      .subscribe()

    subRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [moduloNoExiste, cargarActivos, cargarHistorial])

  async function registrarEntrada() {
    setRegistrandoEntrada(true)
    try {
      const { error } = await supabase.from('turnos_personal').insert({
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`.trim(),
        hora_entrada: new Date().toISOString(),
        hora_salida: null,
        horas_trabajadas: null,
        fecha: new Date().toISOString().split('T')[0],
        tipo: 'normal',
      })

      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01')) {
          setModuloNoExiste(true)
          toast.error('Módulo de turnos no configurado')
        } else {
          toast.error('Error al registrar entrada')
        }
        setRegistrandoEntrada(false)
        return
      }

      toast.success('Entrada registrada')
      cargarActivos()
    } catch {
      toast.error('Error inesperado')
    }
    setRegistrandoEntrada(false)
  }

  async function registrarSalida(turno: Turno) {
    setRegistrandoSalida(turno.id)
    try {
      const ahora = new Date().toISOString()
      const horas = calcHoras(turno.hora_entrada, ahora)

      const { error } = await supabase
        .from('turnos_personal')
        .update({ hora_salida: ahora, horas_trabajadas: horas })
        .eq('id', turno.id)

      if (error) {
        toast.error('Error al registrar salida')
      } else {
        toast.success(`Salida registrada — ${horas.toFixed(2)}h trabajadas`)
        cargarActivos()
        cargarHistorial()
      }
    } catch {
      toast.error('Error inesperado')
    }
    setRegistrandoSalida(null)
  }

  // Calcular resumen de hoy para footer
  const { desde: desdeHoy, hasta: hastaHoy } = getHoyISO()
  const hoysHistorial = historial.filter(t => {
    if (!t.hora_salida) return false
    const salidaTs = new Date(t.hora_salida).getTime()
    return salidaTs >= new Date(desdeHoy).getTime() && salidaTs < new Date(hastaHoy).getTime()
  })
  const totalHorasHoy = hoysHistorial.reduce((sum, t) => sum + (t.horas_trabajadas ?? 0), 0)
  const empleadosActivos = activos.length

  // Resumen por empleado en historial visible
  const resumenPorEmpleado: ResumenEmpleado[] = Object.values(
    historial.reduce<Record<string, ResumenEmpleado>>((acc, t) => {
      const nombre = t.cajero_nombre
      if (!acc[nombre]) acc[nombre] = { nombre, totalHoras: 0 }
      acc[nombre].totalHoras += t.horas_trabajadas ?? 0
      return acc
    }, {})
  ).sort((a, b) => b.totalHoras - a.totalHoras)

  const tabs: { key: TabTurno; label: string }[] = [
    { key: 'activos',   label: 'ACTIVOS' },
    { key: 'historial', label: 'HISTORIAL' },
  ]

  return (
    <div style={s.root}>
      {/* HEADER */}
      <header style={s.header}>
        <div style={s.headerCenter}>
          <span style={s.headerIcon}>👷</span>
          <h1 style={s.headerTitle}>TURNOS DEL PERSONAL</h1>
        </div>
        <button onClick={onClose} style={s.closeBtn}>✕</button>
      </header>

      {/* RESUMEN RÁPIDO */}
      {!moduloNoExiste && !loading && (
        <div style={s.resumen}>
          <div style={s.resumenItem}>
            <div style={s.resumenNum}>{empleadosActivos}</div>
            <div style={s.resumenLabel}>EMPLEADOS ACTIVOS AHORA</div>
          </div>
          <div style={s.resumenDivider} />
          <div style={s.resumenItem}>
            <div style={{ ...s.resumenNum, color: 'var(--yellow)' }}>{totalHorasHoy.toFixed(1)}h</div>
            <div style={s.resumenLabel}>HORAS TRABAJADAS HOY</div>
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div style={s.toolbar}>
        <div style={s.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'activos' && (
          <button
            onClick={registrarEntrada}
            disabled={registrandoEntrada}
            style={{ ...s.newBtn, opacity: registrandoEntrada ? 0.5 : 1 }}
          >
            {registrandoEntrada ? 'REGISTRANDO...' : '➕ REGISTRAR ENTRADA'}
          </button>
        )}
      </div>

      {/* MAIN */}
      <main style={s.main}>
        {moduloNoExiste ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <div style={s.emptyTitle}>MÓDULO NO CONFIGURADO</div>
            <div style={s.emptySubtitle}>MÓDULO DE TURNOS NO CONFIGURADO</div>
          </div>
        ) : loading ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <p style={s.loadingText}>CARGANDO TURNOS...</p>
          </div>
        ) : tab === 'activos' ? (
          activos.length === 0 ? (
            <div style={s.emptyWrap}>
              <div style={s.emptyIcon}>👷</div>
              <div style={s.emptyTitle}>SIN TURNOS ACTIVOS</div>
              <div style={s.emptySubtitle}>NO HAY EMPLEADOS EN TURNO AHORA</div>
            </div>
          ) : (
            <div style={s.listWrap}>
              {activos.map((turno, idx) => {
                const isSaving = registrandoSalida === turno.id
                return (
                  <div
                    key={turno.id}
                    style={{
                      ...s.card,
                      borderLeft: '3px solid #4ADE80',
                      borderTop: idx === 0 ? '1px solid var(--border)' : 'none',
                      opacity: isSaving ? 0.5 : 1,
                    }}
                  >
                    <div style={s.cardTop}>
                      <div style={s.cardLeft}>
                        <div style={s.cardNombre}>{turno.cajero_nombre.toUpperCase()}</div>
                        <div style={s.cardMeta}>
                          ENTRADA: {fmtHora(turno.hora_entrada)} — {fmtFecha(turno.hora_entrada)}
                        </div>
                        <div style={s.cardHoras}>
                          ⏱ {horasTranscurridas(turno.hora_entrada)} EN TURNO
                        </div>
                      </div>
                      <div style={s.activoBadge}>EN TURNO</div>
                    </div>
                    <div style={s.cardActions}>
                      <button
                        onClick={() => registrarSalida(turno)}
                        disabled={isSaving}
                        style={s.btnSalida}
                      >
                        {isSaving ? 'REGISTRANDO...' : '✓ REGISTRAR SALIDA'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          // HISTORIAL
          historial.length === 0 ? (
            <div style={s.emptyWrap}>
              <div style={s.emptyIcon}>📋</div>
              <div style={s.emptyTitle}>SIN HISTORIAL</div>
              <div style={s.emptySubtitle}>NO HAY TURNOS CERRADOS REGISTRADOS</div>
            </div>
          ) : (
            <div style={s.listWrap}>
              {/* Resumen por empleado */}
              {resumenPorEmpleado.length > 0 && (
                <div style={s.resumenEmpleados}>
                  <div style={s.resumenEmpleadosTitle}>RESUMEN POR EMPLEADO (PERÍODO VISIBLE)</div>
                  <div style={s.resumenEmpleadosGrid}>
                    {resumenPorEmpleado.map(emp => (
                      <div key={emp.nombre} style={s.resumenEmpItem}>
                        <span style={s.resumenEmpNombre}>{emp.nombre.toUpperCase()}</span>
                        <span style={s.resumenEmpHoras}>{emp.totalHoras.toFixed(2)}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lista de turnos */}
              {historial.map((turno, idx) => (
                <div
                  key={turno.id}
                  style={{
                    ...s.card,
                    borderLeft: '3px solid var(--border)',
                    borderTop: idx === 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={s.cardTop}>
                    <div style={s.cardLeft}>
                      <div style={s.cardNombre}>{turno.cajero_nombre.toUpperCase()}</div>
                      <div style={s.cardMeta}>
                        📅 {fmtFecha(turno.hora_entrada)}
                      </div>
                      <div style={s.cardMetaRow}>
                        <span style={s.cardMeta}>ENTRADA: {fmtHora(turno.hora_entrada)}</span>
                        <span style={s.cardMetaSep}>→</span>
                        <span style={s.cardMeta}>SALIDA: {turno.hora_salida ? fmtHora(turno.hora_salida) : '—'}</span>
                      </div>
                    </div>
                    <div style={s.horasBadge}>
                      <div style={s.horasNum}>
                        {turno.horas_trabajadas != null ? turno.horas_trabajadas.toFixed(2) : '—'}
                      </div>
                      <div style={s.horasLabel}>HORAS</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>

      {/* FOOTER */}
      {!loading && !moduloNoExiste && (
        <footer style={s.footer}>
          {tab === 'activos' ? (
            <>
              <div style={s.footerItem}>
                <div style={s.footerLabel}>EN TURNO AHORA</div>
                <div style={{ ...s.footerValue, color: '#4ADE80' }}>{empleadosActivos}</div>
              </div>
            </>
          ) : (
            <>
              <div style={s.footerItem}>
                <div style={s.footerLabel}>TURNOS EN PERÍODO</div>
                <div style={s.footerValue}>{historial.length}</div>
              </div>
              <div style={s.footerDivider} />
              <div style={s.footerItem}>
                <div style={s.footerLabel}>TOTAL HORAS (PERÍODO)</div>
                <div style={{ ...s.footerValue, color: 'var(--yellow)' }}>
                  {historial.reduce((s, t) => s + (t.horas_trabajadas ?? 0), 0).toFixed(2)}h
                </div>
              </div>
            </>
          )}
        </footer>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--dark)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    overflow: 'hidden',
  },

  // HEADER
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    height: 60,
    background: 'var(--black)',
    borderBottom: '2px solid var(--yellow)',
    flexShrink: 0,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    fontSize: 20,
  },
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--yellow)',
    textTransform: 'uppercase',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    width: 36,
    height: 36,
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
  },

  // RESUMEN RÁPIDO
  resumen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 20px',
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    gap: 0,
  },
  resumenItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '0 28px',
  },
  resumenNum: {
    fontSize: 22,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
    lineHeight: 1.1,
  },
  resumenLabel: {
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  resumenDivider: {
    width: 1,
    height: 32,
    background: 'var(--border)',
  },

  // TOOLBAR
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    gap: 12,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'flex',
    gap: 0,
  },
  tab: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRight: 'none',
    color: 'var(--muted)',
    padding: '7px 16px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },
  tabActive: {
    background: 'var(--yellow)',
    color: 'var(--black)',
    border: '1px solid var(--yellow)',
    borderRight: 'none',
  },
  newBtn: {
    background: 'var(--yellow)',
    border: '1px solid var(--yellow)',
    color: 'var(--black)',
    padding: '7px 16px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },

  // MAIN
  main: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  // EMPTY / LOADING
  emptyWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.3,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  emptySubtitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    opacity: 0.6,
    textAlign: 'center',
    maxWidth: 360,
  },
  loadingText: {
    color: 'var(--muted)',
    fontWeight: 900,
    letterSpacing: '0.2em',
    fontSize: 11,
    margin: 0,
  },

  // LIST
  listWrap: {
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: 80,
  },
  card: {
    background: 'var(--charcoal)',
    borderBottom: '1px solid var(--border)',
    padding: '14px 20px',
    transition: 'opacity 0.15s',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  cardNombre: {
    fontSize: 14,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  cardMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  cardMetaSep: {
    color: 'var(--muted)',
    opacity: 0.4,
    fontSize: 10,
  },
  cardHoras: {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: '#4ADE80',
    marginTop: 2,
  },
  cardActions: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  btnSalida: {
    background: 'rgba(248,113,113,0.12)',
    border: '1px solid #F87171',
    color: '#F87171',
    padding: '6px 18px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },
  activoBadge: {
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    padding: '3px 10px',
    background: 'rgba(74,222,128,0.15)',
    border: '1px solid #4ADE80',
    color: '#4ADE80',
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  horasBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    padding: '6px 12px',
    flexShrink: 0,
    alignSelf: 'center',
  },
  horasNum: {
    fontSize: 16,
    fontWeight: 900,
    color: 'var(--yellow)',
    letterSpacing: '0.05em',
    lineHeight: 1.1,
  },
  horasLabel: {
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // RESUMEN EMPLEADOS
  resumenEmpleados: {
    background: 'var(--dark)',
    borderBottom: '1px solid var(--border)',
    padding: '14px 20px',
  },
  resumenEmpleadosTitle: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  resumenEmpleadosGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  resumenEmpItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px dashed var(--border)',
  },
  resumenEmpNombre: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.08em',
    color: 'var(--text)',
  },
  resumenEmpHoras: {
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.05em',
    color: 'var(--yellow)',
  },

  // FOOTER
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    height: 60,
    background: 'var(--black)',
    borderTop: '2px solid var(--yellow)',
    flexShrink: 0,
    position: 'sticky',
    bottom: 0,
  },
  footerItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '0 32px',
  },
  footerLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  footerValue: {
    fontSize: 16,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
  },
  footerDivider: {
    width: 1,
    height: 32,
    background: 'var(--border)',
  },
}
