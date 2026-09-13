import React, { useEffect, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabase'
import type { UsuarioPerfil } from '../types'

interface Props {
  cajero: UsuarioPerfil
  onClose: () => void
}

type TabTurno = 'activos' | 'historial' | 'tardanzas'

interface Turno {
  id: string
  cajero_nombre: string
  hora_entrada: string
  hora_salida: string | null
  horas_trabajadas: number | null
  created_at: string
}

interface PersonalEmpleado {
  id: string
  nombre: string
  apellido: string
  rol: string
  hora_entrada_esperada: string | null  // 'HH:MM' en hora local
  tolerancia_minutos: number | null
  descuento_tardanza: number | null
}

interface Tardanza {
  id: string
  personal_id: string | null
  personal_nombre: string
  fecha: string
  hora_esperada: string
  hora_real: string
  minutos_tarde: number
  descuento: number
  turno: string | null
  created_at: string
}

interface ResumenEmpleado {
  nombre: string
  totalHoras: number
}

// ── Helpers de fecha ──────────────────────────────────────────
function getHoyISO(): { desde: string; hasta: string } {
  const ahora = new Date()
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  return {
    desde: hoy.toISOString(),
    hasta: new Date(hoy.getTime() + 86400000).toISOString(),
  }
}

function getSemanaISO(): { desde: string; hasta: string } {
  const now = new Date()
  const dow = now.getDay() // 0=Dom, 1=Lun...
  const lunes = new Date(now)
  lunes.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
  lunes.setHours(0, 0, 0, 0)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 7)
  return {
    desde: lunes.toISOString().split('T')[0],
    hasta: domingo.toISOString().split('T')[0],
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

function ahoraHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
export default function TurnosPage({ cajero, onClose }: Props) {
  const [tab, setTab] = useState<TabTurno>('activos')
  const [activos, setActivos] = useState<Turno[]>([])
  const [historial, setHistorial] = useState<Turno[]>([])
  const [personal, setPersonal] = useState<PersonalEmpleado[]>([])
  const [tardanzas, setTardanzas] = useState<Tardanza[]>([])
  const [loading, setLoading] = useState(true)
  const [moduloNoExiste, setModuloNoExiste] = useState(false)
  const [registrandoEntrada, setRegistrandoEntrada] = useState<string | null>(null)
  const [registrandoSalida, setRegistrandoSalida] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  // Guard sincrónico para evitar doble-registro aunque se haga click rápido
  const enProcesoRef = useRef<Set<string>>(new Set())

  // Modal de configurar horario
  const [showHorarioModal, setShowHorarioModal] = useState(false)
  const [editEmpleado, setEditEmpleado] = useState<PersonalEmpleado | null>(null)
  const [editHora, setEditHora] = useState('')
  const [editTolerancia, setEditTolerancia] = useState('10')
  const [editDescuento, setEditDescuento] = useState('50')
  const [guardandoHorario, setGuardandoHorario] = useState(false)

  const esAdmin = (cajero as any).es_admin || (cajero as any).rol === 'admin' || (cajero as any).rol === 'gerente'

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])
  void tick

  // ── Carga de datos ───────────────────────────────────────────
  const cargarActivos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turnos_personal')
        .select('id, cajero_nombre, hora_entrada, hora_salida, horas_trabajadas, created_at')
        .is('hora_salida', null)
        .order('hora_entrada', { ascending: true })

      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01')) {
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
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01')) {
          setModuloNoExiste(true)
          return
        }
        return
      }
      setHistorial(data ?? [])
    } catch {
      setModuloNoExiste(true)
    }
  }, [])

  const cargarPersonal = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('personal')
        .select('id, nombre, apellido, rol, hora_entrada_esperada, tolerancia_minutos, descuento_tardanza')
        .eq('activo', true)
        .order('nombre')
      setPersonal((data as PersonalEmpleado[]) ?? [])
    } catch {
      // silencioso
    }
  }, [])

  const cargarTardanzas = useCallback(async () => {
    try {
      const { desde, hasta } = getSemanaISO()
      const { data } = await supabase
        .from('tardanzas')
        .select('*')
        .gte('fecha', desde)
        .lt('fecha', hasta)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
      setTardanzas((data as Tardanza[]) ?? [])
    } catch {
      // silencioso — la tabla puede no existir aún
    }
  }, [])

  const cargarTodo = useCallback(async () => {
    setLoading(true)
    await Promise.all([cargarActivos(), cargarHistorial(), cargarPersonal(), cargarTardanzas()])
    setLoading(false)
  }, [cargarActivos, cargarHistorial, cargarPersonal, cargarTardanzas])

  useEffect(() => { cargarTodo() }, [cargarTodo])

  // Real-time subscription
  useEffect(() => {
    if (moduloNoExiste) return
    const channel = supabase
      .channel('turnos_personal_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos_personal' }, () => {
        cargarActivos()
        cargarHistorial()
      })
      .subscribe()
    subRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [moduloNoExiste, cargarActivos, cargarHistorial])

  // ── Registrar entrada ────────────────────────────────────────
  async function registrarEntrada(nombreEmpleado?: string) {
    const nombre = nombreEmpleado ?? `${cajero.nombre} ${cajero.last_name}`.trim()

    // Guard 1: sincrónico (useRef) — bloquea aunque React no haya re-renderizado aún
    if (enProcesoRef.current.has(nombre)) return
    enProcesoRef.current.add(nombre)
    setRegistrandoEntrada(nombre)

    try {
      // Guard 2: verificar directamente en BD (no en estado local que puede estar desactualizado)
      const { data: existente } = await supabase
        .from('turnos_personal')
        .select('id')
        .eq('cajero_nombre', nombre)
        .is('hora_salida', null)
        .maybeSingle()

      if (existente) {
        toast('Ya tiene turno activo', { icon: 'ℹ️' })
        return
      }

      const ahora = new Date()
      const { error } = await supabase.from('turnos_personal').insert({
        cajero_nombre: nombre,
        hora_entrada: ahora.toISOString(),
        hora_salida: null,
        horas_trabajadas: null,
        fecha: ahora.toISOString().split('T')[0],
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
        setRegistrandoEntrada(null)
        return
      }

      // ── Verificar tardanza ──────────────────────────────────
      const empleado = personal.find(p => `${p.nombre} ${p.apellido}`.trim() === nombre)
      if (empleado?.hora_entrada_esperada) {
        const [hh, mm] = empleado.hora_entrada_esperada.split(':').map(Number)
        const esperadaBase = new Date(ahora)
        esperadaBase.setHours(hh, mm, 0, 0)
        const tolerancia = empleado.tolerancia_minutos ?? 10
        const esperadaConTolerancia = new Date(esperadaBase.getTime() + tolerancia * 60000)

        if (ahora > esperadaConTolerancia) {
          const minutosTarde = Math.floor((ahora.getTime() - esperadaBase.getTime()) / 60000)
          const descuento = empleado.descuento_tardanza ?? 50

          // Registrar tardanza en DB
          await supabase.from('tardanzas').insert({
            personal_id: empleado.id,
            personal_nombre: nombre,
            fecha: ahora.toISOString().split('T')[0],
            hora_esperada: `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`,
            hora_real: ahoraHHMM(),
            minutos_tarde: minutosTarde,
            descuento,
          })

          toast.error(
            `⏰ ${nombre.split(' ')[0]} llegó ${minutosTarde} min tarde\nDescuento: $${descuento.toFixed(2)}`,
            { duration: 6000 }
          )
          await cargarTardanzas()
        } else {
          toast.success(`Entrada registrada — ${nombre}`)
        }
      } else {
        toast.success(`Entrada registrada — ${nombre}`)
      }

      await cargarActivos()
    } catch {
      toast.error('Error inesperado')
    } finally {
      enProcesoRef.current.delete(nombre)
      setRegistrandoEntrada(null)
    }
  }

  // ── Registrar salida ─────────────────────────────────────────
  async function registrarSalida(turno: Turno) {
    if (registrandoSalida !== null) return
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

  // ── Guardar horario de empleado ──────────────────────────────
  async function guardarHorario() {
    if (!editEmpleado) return
    setGuardandoHorario(true)
    try {
      const tolerancia = parseInt(editTolerancia) || 10
      const descuento  = parseFloat(editDescuento) || 50
      const hora = editHora || null

      const { error } = await supabase
        .from('personal')
        .update({
          hora_entrada_esperada: hora,
          tolerancia_minutos: tolerancia,
          descuento_tardanza: descuento,
        })
        .eq('id', editEmpleado.id)

      if (error) {
        toast.error('Error al guardar horario: ' + error.message)
      } else {
        toast.success(`Horario guardado para ${editEmpleado.nombre}`)
        setShowHorarioModal(false)
        await cargarPersonal()
      }
    } finally {
      setGuardandoHorario(false)
    }
  }

  function abrirHorarioModal(emp: PersonalEmpleado) {
    setEditEmpleado(emp)
    setEditHora(emp.hora_entrada_esperada ?? '')
    setEditTolerancia(String(emp.tolerancia_minutos ?? 10))
    setEditDescuento(String(emp.descuento_tardanza ?? 50))
    setShowHorarioModal(true)
  }

  // ── Cálculos ─────────────────────────────────────────────────
  const { desde: desdeHoy, hasta: hastaHoy } = getHoyISO()
  const hoysHistorial = historial.filter(t => {
    if (!t.hora_salida) return false
    const ts = new Date(t.hora_salida).getTime()
    return ts >= new Date(desdeHoy).getTime() && ts < new Date(hastaHoy).getTime()
  })
  const totalHorasHoy = hoysHistorial.reduce((sum, t) => sum + (t.horas_trabajadas ?? 0), 0)
  const empleadosActivos = activos.length

  const resumenPorEmpleado: ResumenEmpleado[] = Object.values(
    historial.reduce<Record<string, ResumenEmpleado>>((acc, t) => {
      const nombre = t.cajero_nombre
      if (!acc[nombre]) acc[nombre] = { nombre, totalHoras: 0 }
      acc[nombre].totalHoras += t.horas_trabajadas ?? 0
      return acc
    }, {})
  ).sort((a, b) => b.totalHoras - a.totalHoras)

  // Tardanzas: resumen por empleado para semana actual
  const resumenTardanzas = tardanzas.reduce<Record<string, { nombre: string; veces: number; minutosTotales: number; descuentoTotal: number }>>((acc, t) => {
    if (!acc[t.personal_nombre]) {
      acc[t.personal_nombre] = { nombre: t.personal_nombre, veces: 0, minutosTotales: 0, descuentoTotal: 0 }
    }
    acc[t.personal_nombre].veces++
    acc[t.personal_nombre].minutosTotales += t.minutos_tarde
    acc[t.personal_nombre].descuentoTotal += Number(t.descuento)
    return acc
  }, {})
  const descuentoTotalSemana = tardanzas.reduce((s, t) => s + Number(t.descuento), 0)

  // ── Tabs ─────────────────────────────────────────────────────
  const tabs: { key: TabTurno; label: string }[] = [
    { key: 'activos',    label: 'ACTIVOS'    },
    { key: 'historial',  label: 'HISTORIAL'  },
    { key: 'tardanzas',  label: 'TARDANZAS'  },
  ]

  // ─────────────────────────────────────────────────────────────
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
          <div style={s.resumenDivider} />
          <div style={s.resumenItem}>
            <div style={{ ...s.resumenNum, color: tardanzas.length > 0 ? '#F87171' : 'var(--muted)' }}>
              {tardanzas.length}
            </div>
            <div style={s.resumenLabel}>TARDANZAS ESTA SEMANA</div>
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
              {t.key === 'tardanzas' && tardanzas.length > 0 && (
                <span style={s.badge}>{tardanzas.length}</span>
              )}
            </button>
          ))}
        </div>
        {tab === 'activos' && (
          <button
            onClick={() => registrarEntrada()}
            disabled={registrandoEntrada !== null}
            style={{ ...s.newBtn, opacity: registrandoEntrada !== null ? 0.5 : 1 }}
          >
            {registrandoEntrada !== null ? 'REGISTRANDO...' : '➕ MI ENTRADA'}
          </button>
        )}
      </div>

      {/* MAIN */}
      <main style={s.main}>
        {moduloNoExiste ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <div style={s.emptyTitle}>MÓDULO NO CONFIGURADO</div>
            <div style={s.emptySubtitle}>Ejecuta el SQL en Supabase para activar este módulo</div>
          </div>
        ) : loading ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <p style={s.loadingText}>CARGANDO...</p>
          </div>

        /* ── TAB: ACTIVOS ──────────────────────────────────── */
        ) : tab === 'activos' ? (
          <>
            {activos.length === 0 && (
              <div style={s.emptyWrap}>
                <div style={s.emptyIcon}>👷</div>
                <div style={s.emptyTitle}>SIN TURNOS ACTIVOS</div>
                <div style={s.emptySubtitle}>REGISTRA ENTRADA A UN EMPLEADO ABAJO</div>
              </div>
            )}

            {/* Lista rápida de empleados */}
            {personal.length > 0 && (
              <div style={{ padding: '0.75rem 1rem 0', borderBottom: '1px solid var(--border)' }}>
                <p style={s.seccionLabel}>EMPLEADOS — Click para registrar entrada</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', paddingBottom: '0.75rem' }}>
                  {personal.map(emp => {
                    const nombreCompleto = `${emp.nombre} ${emp.apellido}`.trim()
                    const estaActivo = activos.some(a => a.cajero_nombre === nombreCompleto)
                    const cargando = registrandoEntrada === nombreCompleto
                    const tieneHorario = !!emp.hora_entrada_esperada
                    return (
                      <button
                        key={emp.id}
                        onClick={() => !estaActivo && registrarEntrada(nombreCompleto)}
                        disabled={estaActivo || cargando}
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.7rem',
                          fontWeight: 900,
                          background: estaActivo ? 'rgba(34,197,94,0.1)' : 'var(--dark)',
                          border: `1.5px solid ${estaActivo ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                          color: estaActivo ? '#22c55e' : 'var(--text)',
                          borderRadius: 0,
                          cursor: estaActivo ? 'default' : 'pointer',
                          opacity: cargando ? 0.5 : 1,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          position: 'relative',
                        }}
                      >
                        {cargando ? '...' : estaActivo ? `✓ ${emp.nombre}` : `+ ${emp.nombre}`}
                        <span style={{ fontSize: '0.6rem', opacity: 0.6, marginLeft: '0.25rem' }}>{emp.rol}</span>
                        {tieneHorario && !estaActivo && !cargando && (
                          <span style={{ fontSize: '0.55rem', color: 'var(--yellow)', marginLeft: '0.2rem' }}>
                            {emp.hora_entrada_esperada}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Botones de configuración de horario (solo admin) */}
                {esAdmin && (
                  <div style={{ paddingBottom: '0.75rem' }}>
                    <p style={{ ...s.seccionLabel, color: 'var(--yellow)', marginBottom: '0.4rem' }}>
                      // CONFIGURAR HORARIOS
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {personal.map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => abrirHorarioModal(emp)}
                          style={{
                            padding: '0.25rem 0.55rem',
                            fontSize: '0.65rem',
                            fontWeight: 900,
                            background: emp.hora_entrada_esperada ? 'rgba(240,168,0,0.1)' : 'var(--dark)',
                            border: `1px solid ${emp.hora_entrada_esperada ? 'rgba(240,168,0,0.4)' : 'var(--border)'}`,
                            color: emp.hora_entrada_esperada ? 'var(--yellow)' : 'var(--muted)',
                            borderRadius: 0,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          ⚙ {emp.nombre}
                          {emp.hora_entrada_esperada
                            ? ` · ${emp.hora_entrada_esperada} ±${emp.tolerancia_minutos ?? 10}m`
                            : ' · sin horario'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activos.length > 0 && (
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
                          <div style={s.cardMeta}>ENTRADA: {fmtHora(turno.hora_entrada)} — {fmtFecha(turno.hora_entrada)}</div>
                          <div style={s.cardHoras}>⏱ {horasTranscurridas(turno.hora_entrada)} EN TURNO</div>
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
            )}
          </>

        /* ── TAB: HISTORIAL ────────────────────────────────── */
        ) : tab === 'historial' ? (
          historial.length === 0 ? (
            <div style={s.emptyWrap}>
              <div style={s.emptyIcon}>📋</div>
              <div style={s.emptyTitle}>SIN HISTORIAL</div>
              <div style={s.emptySubtitle}>NO HAY TURNOS CERRADOS REGISTRADOS</div>
            </div>
          ) : (
            <div style={s.listWrap}>
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
                      <div style={s.cardMeta}>📅 {fmtFecha(turno.hora_entrada)}</div>
                      <div style={s.cardMetaRow}>
                        <span style={s.cardMeta}>ENTRADA: {fmtHora(turno.hora_entrada)}</span>
                        <span style={s.cardMetaSep}>→</span>
                        <span style={s.cardMeta}>SALIDA: {turno.hora_salida ? fmtHora(turno.hora_salida) : '—'}</span>
                      </div>
                    </div>
                    <div style={s.horasBadge}>
                      <div style={s.horasNum}>{turno.horas_trabajadas != null ? turno.horas_trabajadas.toFixed(2) : '—'}</div>
                      <div style={s.horasLabel}>HORAS</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )

        /* ── TAB: TARDANZAS ────────────────────────────────── */
        ) : (
          <div style={s.listWrap}>
            {/* Banner semana + total descuento */}
            <div style={s.tardanzaBanner}>
              <div>
                <p style={s.tardanzaBannerTitle}>REPORTE SEMANA ACTUAL</p>
                <p style={s.tardanzaBannerSub}>
                  {(() => {
                    const { desde, hasta } = getSemanaISO()
                    const d1 = new Date(desde + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
                    const d2 = new Date(hasta + 'T00:00:00')
                    d2.setDate(d2.getDate() - 1)
                    return `${d1} — ${d2.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}`
                  })()}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={s.tardanzaTotal}>${descuentoTotalSemana.toFixed(2)}</div>
                <div style={s.tardanzaTotalLabel}>DESCUENTO TOTAL SEMANA</div>
              </div>
            </div>

            {tardanzas.length === 0 ? (
              <div style={s.emptyWrap}>
                <div style={s.emptyIcon}>✅</div>
                <div style={s.emptyTitle}>SIN TARDANZAS</div>
                <div style={s.emptySubtitle}>NINGÚN EMPLEADO HA LLEGADO TARDE ESTA SEMANA</div>
              </div>
            ) : (
              <>
                {/* Resumen por empleado (para día de pago) */}
                <div style={s.resumenEmpleados}>
                  <div style={s.resumenEmpleadosTitle}>// RESUMEN DÍA DE PAGO — DESCUENTOS ACUMULADOS</div>
                  <div style={s.resumenEmpleadosGrid}>
                    {Object.values(resumenTardanzas).sort((a, b) => b.descuentoTotal - a.descuentoTotal).map(r => (
                      <div key={r.nombre} style={s.resumenEmpItem}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={s.resumenEmpNombre}>{r.nombre.toUpperCase()}</span>
                          <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.05em' }}>
                            {r.veces} tardanza{r.veces !== 1 ? 's' : ''} · {r.minutosTotales} min tarde en total
                          </span>
                        </div>
                        <span style={{ ...s.resumenEmpHoras, color: '#F87171' }}>−${r.descuentoTotal.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Lista de tardanzas individuales */}
                <div style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ ...s.seccionLabel, padding: '8px 20px 4px' }}>DETALLE DE TARDANZAS</p>
                </div>
                {tardanzas.map((t, idx) => (
                  <div
                    key={t.id}
                    style={{
                      ...s.card,
                      borderLeft: '3px solid #F87171',
                      borderTop: idx === 0 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={s.cardTop}>
                      <div style={s.cardLeft}>
                        <div style={s.cardNombre}>{t.personal_nombre.toUpperCase()}</div>
                        <div style={s.cardMeta}>
                          📅 {new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'short' })}
                        </div>
                        <div style={s.cardMetaRow}>
                          <span style={s.cardMeta}>ESPERADA: {t.hora_esperada}</span>
                          <span style={s.cardMetaSep}>→</span>
                          <span style={{ ...s.cardMeta, color: '#F87171' }}>LLEGÓ: {t.hora_real}</span>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#F87171', marginTop: 2, letterSpacing: '0.08em' }}>
                          ⏰ {t.minutos_tarde} minutos tarde
                        </div>
                      </div>
                      <div style={{
                        background: 'rgba(248,113,113,0.1)',
                        border: '1px solid #F87171',
                        padding: '6px 12px',
                        flexShrink: 0,
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#F87171', letterSpacing: '0.05em' }}>
                          −${Number(t.descuento).toFixed(2)}
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 900, color: '#F87171', letterSpacing: '0.15em' }}>DESCUENTO</div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      {!loading && !moduloNoExiste && (
        <footer style={s.footer}>
          {tab === 'activos' ? (
            <div style={s.footerItem}>
              <div style={s.footerLabel}>EN TURNO AHORA</div>
              <div style={{ ...s.footerValue, color: '#4ADE80' }}>{empleadosActivos}</div>
            </div>
          ) : tab === 'historial' ? (
            <>
              <div style={s.footerItem}>
                <div style={s.footerLabel}>TURNOS EN PERÍODO</div>
                <div style={s.footerValue}>{historial.length}</div>
              </div>
              <div style={s.footerDivider} />
              <div style={s.footerItem}>
                <div style={s.footerLabel}>TOTAL HORAS (PERÍODO)</div>
                <div style={{ ...s.footerValue, color: 'var(--yellow)' }}>
                  {historial.reduce((sum, t) => sum + (t.horas_trabajadas ?? 0), 0).toFixed(2)}h
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={s.footerItem}>
                <div style={s.footerLabel}>TARDANZAS SEMANA</div>
                <div style={{ ...s.footerValue, color: '#F87171' }}>{tardanzas.length}</div>
              </div>
              <div style={s.footerDivider} />
              <div style={s.footerItem}>
                <div style={s.footerLabel}>DESCUENTO TOTAL</div>
                <div style={{ ...s.footerValue, color: '#F87171' }}>−${descuentoTotalSemana.toFixed(2)}</div>
              </div>
            </>
          )}
        </footer>
      )}

      {/* MODAL: Configurar horario del empleado */}
      {showHorarioModal && editEmpleado && (
        <div style={s.modalOverlay} onClick={() => setShowHorarioModal(false)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ color: 'var(--yellow)', fontWeight: 900, letterSpacing: '0.1em' }}>
                ⚙ HORARIO — {editEmpleado.nombre.toUpperCase()} {editEmpleado.apellido.toUpperCase()}
              </span>
              <button onClick={() => setShowHorarioModal(false)} style={{ ...s.closeBtn, background: 'transparent' }}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.modalField}>
                <label style={s.modalLabel}>Hora de entrada esperada</label>
                <input
                  type="time"
                  value={editHora}
                  onChange={e => setEditHora(e.target.value)}
                  style={s.modalInput}
                />
                <span style={s.modalHint}>Ej: 15:00 para las 3 PM. Dejar vacío para sin control.</span>
              </div>
              <div style={s.modalField}>
                <label style={s.modalLabel}>Tolerancia (minutos)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={editTolerancia}
                  onChange={e => setEditTolerancia(e.target.value)}
                  style={s.modalInput}
                />
                <span style={s.modalHint}>Minutos de gracia antes de contar tardanza. Ej: 10</span>
              </div>
              <div style={s.modalField}>
                <label style={s.modalLabel}>Descuento por tardanza ($)</label>
                <input
                  type="number"
                  min="0"
                  value={editDescuento}
                  onChange={e => setEditDescuento(e.target.value)}
                  style={s.modalInput}
                />
                <span style={s.modalHint}>Monto que se descontará al empleado por cada tardanza.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setShowHorarioModal(false)}
                  style={{ ...s.btnSalida, flex: 1, padding: '0.65rem' }}
                >
                  CANCELAR
                </button>
                <button
                  onClick={guardarHorario}
                  disabled={guardandoHorario}
                  style={{
                    flex: 2,
                    padding: '0.65rem',
                    background: 'var(--yellow)',
                    border: 'none',
                    color: '#000',
                    fontWeight: 900,
                    fontSize: '0.75rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    cursor: guardandoHorario ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    borderRadius: 0,
                    opacity: guardandoHorario ? 0.7 : 1,
                  }}
                >
                  {guardandoHorario ? 'GUARDANDO...' : '✓ GUARDAR HORARIO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────
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
  headerCenter: { display: 'flex', alignItems: 'center', gap: 10 },
  headerIcon: { fontSize: 20 },
  headerTitle: {
    margin: 0, fontSize: 18, fontWeight: 900,
    letterSpacing: '0.2em', color: 'var(--yellow)', textTransform: 'uppercase',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    width: 36, height: 36,
    cursor: 'pointer', fontWeight: 900, fontSize: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 0,
  },
  resumen: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '10px 20px',
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0, gap: 0,
  },
  resumenItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 20px' },
  resumenNum: { fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '0.05em', lineHeight: 1.1 },
  resumenLabel: { fontSize: 8, fontWeight: 900, letterSpacing: '0.15em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center' },
  resumenDivider: { width: 1, height: 32, background: 'var(--border)' },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px',
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0, gap: 12, flexWrap: 'wrap',
  },
  tabs: { display: 'flex', gap: 0 },
  tab: {
    background: 'var(--charcoal)', border: '1px solid var(--border)', borderRight: 'none',
    color: 'var(--muted)', padding: '7px 16px',
    cursor: 'pointer', fontWeight: 900, fontSize: 10, letterSpacing: '0.12em',
    textTransform: 'uppercase', fontFamily: 'inherit', borderRadius: 0,
    position: 'relative',
  },
  tabActive: {
    background: 'var(--yellow)', color: 'var(--black)',
    border: '1px solid var(--yellow)', borderRight: 'none',
  },
  badge: {
    position: 'absolute', top: -4, right: -4,
    background: '#F87171', color: '#fff',
    borderRadius: '50%', width: 14, height: 14,
    fontSize: 8, fontWeight: 900,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  newBtn: {
    background: 'var(--yellow)', border: '1px solid var(--yellow)',
    color: 'var(--black)', padding: '7px 16px',
    cursor: 'pointer', fontWeight: 900, fontSize: 10, letterSpacing: '0.12em',
    textTransform: 'uppercase', fontFamily: 'inherit', borderRadius: 0,
  },
  main: { flex: 1, overflowY: 'auto', overflowX: 'hidden' },
  emptyWrap: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '50vh', gap: 12,
  },
  emptyIcon: { fontSize: 48, opacity: 0.3 },
  emptyTitle: {
    fontSize: 16, fontWeight: 900, letterSpacing: '0.25em',
    color: 'var(--muted)', textTransform: 'uppercase',
  },
  emptySubtitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.15em',
    color: 'var(--muted)', textTransform: 'uppercase', opacity: 0.6,
    textAlign: 'center', maxWidth: 360,
  },
  loadingText: {
    color: 'var(--muted)', fontWeight: 900,
    letterSpacing: '0.2em', fontSize: 11, margin: 0,
  },
  seccionLabel: {
    fontSize: '0.65rem', fontWeight: 900, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem',
  },
  listWrap: { display: 'flex', flexDirection: 'column', paddingBottom: 80 },
  card: {
    background: 'var(--charcoal)', borderBottom: '1px solid var(--border)',
    padding: '14px 20px', transition: 'opacity 0.15s',
  },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardLeft: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  cardNombre: {
    fontSize: 14, fontWeight: 900, letterSpacing: '0.1em', color: 'var(--text)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  cardMeta: { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' },
  cardMetaRow: { display: 'flex', alignItems: 'center', gap: 6 },
  cardMetaSep: { color: 'var(--muted)', opacity: 0.4, fontSize: 10 },
  cardHoras: { fontSize: 12, fontWeight: 900, letterSpacing: '0.1em', color: '#4ADE80', marginTop: 2 },
  cardActions: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btnSalida: {
    background: 'rgba(248,113,113,0.12)', border: '1px solid #F87171', color: '#F87171',
    padding: '6px 18px', cursor: 'pointer', fontWeight: 900, fontSize: 9,
    letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'inherit', borderRadius: 0,
  },
  activoBadge: {
    fontSize: 8, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase',
    padding: '3px 10px',
    background: 'rgba(74,222,128,0.15)', border: '1px solid #4ADE80', color: '#4ADE80',
    flexShrink: 0, alignSelf: 'flex-start',
  },
  horasBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    background: 'var(--dark)', border: '1px solid var(--border)',
    padding: '6px 12px', flexShrink: 0, alignSelf: 'center',
  },
  horasNum: { fontSize: 16, fontWeight: 900, color: 'var(--yellow)', letterSpacing: '0.05em', lineHeight: 1.1 },
  horasLabel: { fontSize: 8, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase' },
  resumenEmpleados: { background: 'var(--dark)', borderBottom: '1px solid var(--border)', padding: '14px 20px' },
  resumenEmpleadosTitle: { fontSize: 9, fontWeight: 900, letterSpacing: '0.25em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 },
  resumenEmpleadosGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  resumenEmpItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '4px 0', borderBottom: '1px dashed var(--border)',
  },
  resumenEmpNombre: { fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', color: 'var(--text)' },
  resumenEmpHoras: { fontSize: 13, fontWeight: 900, letterSpacing: '0.05em', color: 'var(--yellow)' },
  // Tardanza banner
  tardanzaBanner: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px',
    background: 'rgba(248,113,113,0.06)',
    borderBottom: '2px solid #F87171',
    flexShrink: 0,
  },
  tardanzaBannerTitle: { fontSize: 9, fontWeight: 900, letterSpacing: '0.25em', color: '#F87171', textTransform: 'uppercase', margin: 0 },
  tardanzaBannerSub: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '3px 0 0', letterSpacing: '0.05em' },
  tardanzaTotal: { fontSize: 22, fontWeight: 900, color: '#F87171', letterSpacing: '0.05em', lineHeight: 1.1 },
  tardanzaTotalLabel: { fontSize: 8, fontWeight: 900, color: '#F87171', letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.8 },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 0, height: 60,
    background: 'var(--black)', borderTop: '2px solid var(--yellow)',
    flexShrink: 0, position: 'sticky', bottom: 0,
  },
  footerItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 32px' },
  footerLabel: { fontSize: 9, fontWeight: 900, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase' },
  footerValue: { fontSize: 16, fontWeight: 900, color: 'var(--text)', letterSpacing: '0.05em' },
  footerDivider: { width: 1, height: 32, background: 'var(--border)' },
  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: 16,
  },
  modalBox: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderTop: '3px solid var(--yellow)',
    width: '100%', maxWidth: 400,
    display: 'flex', flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--black)',
    fontSize: 11, letterSpacing: '0.1em',
  },
  modalBody: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  modalField: { display: 'flex', flexDirection: 'column', gap: 4 },
  modalLabel: { fontSize: 10, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  modalInput: {
    background: 'var(--dark)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '8px 10px',
    fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
    outline: 'none', borderRadius: 0, width: '100%', boxSizing: 'border-box',
  },
  modalHint: { fontSize: 9, color: 'var(--muted)', letterSpacing: '0.05em' },
}
