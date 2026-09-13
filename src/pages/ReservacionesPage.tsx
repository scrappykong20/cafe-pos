import React, { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabase'
import type { UsuarioPerfil, Mesa } from '../types'

interface Props {
  cajero: UsuarioPerfil
  onClose: () => void
}

type TabReserv = 'hoy' | 'proximas' | 'historial'
type EstadoReserv = 'pendiente' | 'confirmada' | 'cancelada' | 'completada'

interface Reservacion {
  id: string
  cliente_nombre: string
  telefono: string | null
  personas: number
  fecha: string
  hora: string
  mesa_id: string | null
  mesa_nombre: string | null
  notas: string | null
  estado: EstadoReserv
  created_at: string
}

interface FormData {
  cliente_nombre: string
  telefono: string
  personas: number
  fecha: string
  hora: string
  mesa_id: string
  notas: string
}

function getHoyStr(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function getHoraRedondeada(): string {
  const d = new Date()
  const min = d.getMinutes()
  const rounded = min < 30 ? 30 : 0
  const h = rounded === 0 ? d.getHours() + 1 : d.getHours()
  return `${String(h % 24).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`
}

function fmtFechaHora(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y} ${hora}`
}

const ESTADO_BADGE: Record<EstadoReserv, { label: string; color: string; bg: string }> = {
  pendiente:   { label: 'PENDIENTE',   color: 'var(--black)', bg: 'var(--yellow)' },
  confirmada:  { label: 'CONFIRMADA',  color: '#052e16',      bg: '#4ADE80' },
  cancelada:   { label: 'CANCELADA',   color: '#fff',         bg: '#F87171' },
  completada:  { label: 'COMPLETADA',  color: 'var(--text)',  bg: 'var(--charcoal)' },
}

export default function ReservacionesPage({ cajero: _cajero, onClose }: Props) {
  const [tab, setTab] = useState<TabReserv>('hoy')
  const [reservaciones, setReservaciones] = useState<Reservacion[]>([])
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [loading, setLoading] = useState(true)
  const [moduloNoExiste, setModuloNoExiste] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [savingForm, setSavingForm] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const defaultForm: FormData = {
    cliente_nombre: '',
    telefono: '',
    personas: 2,
    fecha: getHoyStr(),
    hora: getHoraRedondeada(),
    mesa_id: '',
    notas: '',
  }
  const [form, setForm] = useState<FormData>(defaultForm)

  // Cargar mesas disponibles
  useEffect(() => {
    async function cargarMesas() {
      try {
        const { data, error } = await supabase
          .from('mesas')
          .select('id, numero, nombre, capacidad, estado, orden_id')
          .order('numero', { ascending: true })
        if (error) {
          toast.error('Error al cargar mesas')
          return
        }
        setMesas(data ?? [])
      } catch (err) {
        toast.error('Error inesperado al cargar mesas')
      }
    }
    cargarMesas()
  }, [])

  const cargarReservaciones = useCallback(async () => {
    setLoading(true)
    const hoy = getHoyStr()

    try {
      let query = supabase
        .from('reservaciones')
        .select('id, cliente_nombre, telefono, personas, fecha, hora, mesa_id, mesa_nombre, notas, estado, created_at')

      if (tab === 'hoy') {
        query = query.eq('fecha', hoy).order('hora', { ascending: true })
      } else if (tab === 'proximas') {
        query = query.gt('fecha', hoy).order('fecha', { ascending: true }).order('hora', { ascending: true })
      } else {
        query = query
          .in('estado', ['cancelada', 'completada'])
          .order('created_at', { ascending: false })
          .limit(30)
      }

      const { data, error } = await query

      if (error) {
        const msg = error.message ?? ''
        if (
          msg.includes('does not exist') ||
          msg.includes('relation') ||
          msg.includes('42P01')
        ) {
          setModuloNoExiste(true)
          setReservaciones([])
          setLoading(false)
          return
        }
        toast.error('Error al cargar reservaciones')
        setReservaciones([])
        setLoading(false)
        return
      }

      setModuloNoExiste(false)
      setReservaciones(data ?? [])
    } catch {
      setModuloNoExiste(true)
      setReservaciones([])
    }

    setLoading(false)
  }, [tab])

  useEffect(() => {
    cargarReservaciones()
  }, [cargarReservaciones])

  async function guardarReservacion() {
    if (savingForm) return
    if (!form.cliente_nombre.trim()) {
      toast.error('El nombre del cliente es requerido')
      return
    }

    // Validar capacidad de la mesa seleccionada
    if (form.mesa_id) {
      const mesaSeleccionada = mesas.find(m => m.id === form.mesa_id)
      if (mesaSeleccionada && form.personas > mesaSeleccionada.capacidad) {
        const ok = window.confirm(
          `La mesa "${mesaSeleccionada.nombre || `Mesa ${mesaSeleccionada.numero}`}" tiene capacidad para ${mesaSeleccionada.capacidad} personas, pero la reservación es para ${form.personas}.\n\n¿Continuar de todas formas?`
        )
        if (!ok) return
      }
    }

    // Bloquear doble submit antes de la consulta de conflicto
    setSavingForm(true)

    // Validar conflicto de horario si hay mesa seleccionada
    if (form.mesa_id) {
      const { data: conflicto, error: conflictoError } = await supabase
        .from('reservaciones')
        .select('id')
        .eq('mesa_id', form.mesa_id)
        .eq('fecha', form.fecha)
        .eq('hora', form.hora)
        .not('estado', 'in', '(cancelada,completada)')
        .maybeSingle()

      if (conflictoError) {
        toast.error('Error al verificar disponibilidad')
        setSavingForm(false)
        return
      }

      if (conflicto) {
        toast.error('Ya hay una reservación para esa mesa en ese horario')
        setSavingForm(false)
        return
      }
    }
    try {
      const mesaObj = mesas.find(m => m.id === form.mesa_id)
      const { error } = await supabase.from('reservaciones').insert({
        cliente_nombre: form.cliente_nombre.trim(),
        telefono: form.telefono.trim() || null,
        personas: form.personas,
        fecha: form.fecha,
        hora: form.hora,
        mesa_id: form.mesa_id || null,
        mesa_nombre: mesaObj ? (mesaObj.nombre || `Mesa ${mesaObj.numero}`) : null,
        notas: form.notas.trim() || null,
        estado: 'pendiente',
      })

      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01')) {
          setModuloNoExiste(true)
          toast.error('Módulo de reservaciones no configurado')
        } else {
          toast.error(`Error: ${error.message}`, { duration: 8000 })
        }
        setSavingForm(false)
        return
      }

      toast.success('Reservación creada')
      // Ofrecer confirmación por WhatsApp si hay teléfono
      if (form.telefono.trim()) {
        const tel = form.telefono.replace(/\D/g, '')
        const [yr, mo, dy] = form.fecha.split('-').map(Number)
        const fechaFmt = new Date(yr, mo - 1, dy).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
        const msg = `¡Hola ${form.cliente_nombre}! Tu reservación en El Café del Constructor está confirmada para el ${fechaFmt} a las ${form.hora} (${form.personas} persona${form.personas !== 1 ? 's' : ''}). ¡Te esperamos!`
        const telLimpio = tel.replace(/^\+?52/, '').replace(/\D/g, '')
        const waUrl = `https://wa.me/52${telLimpio}?text=${encodeURIComponent(msg)}`
        const abrirWa = window.confirm(`¿Enviar confirmación por WhatsApp a ${form.telefono}?`)
        if (abrirWa) window.open(waUrl, '_blank')
      }
      setForm(defaultForm)
      setShowForm(false)
      cargarReservaciones()
    } catch {
      toast.error('Error inesperado')
    }
    setSavingForm(false)
  }

  async function cambiarEstado(id: string, nuevoEstado: EstadoReserv) {
    setUpdatingId(id)
    try {
      const { error } = await supabase
        .from('reservaciones')
        .update({ estado: nuevoEstado })
        .eq('id', id)
      if (error) {
        toast.error('No se pudo actualizar el estado')
      } else {
        toast.success(`Reservación ${ESTADO_BADGE[nuevoEstado].label.toLowerCase()}`)
        cargarReservaciones()
      }
    } catch {
      toast.error('Error inesperado')
    }
    setUpdatingId(null)
  }

  const tabs: { key: TabReserv; label: string }[] = [
    { key: 'hoy',      label: 'HOY' },
    { key: 'proximas', label: 'PRÓXIMAS' },
    { key: 'historial', label: 'HISTORIAL' },
  ]

  return (
    <div style={s.root}>
      {/* HEADER */}
      <header style={s.header}>
        <div style={s.headerCenter}>
          <span style={s.headerIcon}>📅</span>
          <h1 style={s.headerTitle}>RESERVACIONES</h1>
        </div>
        <button onClick={onClose} style={s.closeBtn}>✕</button>
      </header>

      {/* TOOLBAR */}
      <div style={s.toolbar}>
        {/* TABS */}
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
        {/* NEW BUTTON */}
        <button
          onClick={() => { setShowForm(v => !v); setForm(defaultForm) }}
          style={s.newBtn}
        >
          ➕ NUEVA RESERVACIÓN
        </button>
      </div>

      {/* INLINE FORM */}
      {showForm && (
        <div style={s.formPanel}>
          <div style={s.formTitle}>NUEVA RESERVACIÓN</div>
          <div style={s.formGrid}>
            {/* Nombre */}
            <div style={s.formField}>
              <label style={s.formLabel}>NOMBRE DEL CLIENTE *</label>
              <input
                type="text"
                value={form.cliente_nombre}
                onChange={e => setForm(p => ({ ...p, cliente_nombre: e.target.value }))}
                style={s.formInput}
                placeholder="NOMBRE COMPLETO"
              />
            </div>

            {/* Teléfono */}
            <div style={s.formField}>
              <label style={s.formLabel}>TELÉFONO</label>
              <input
                type="tel"
                value={form.telefono}
                onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                style={s.formInput}
                placeholder="OPCIONAL"
              />
            </div>

            {/* Personas */}
            <div style={s.formField}>
              <label style={s.formLabel}>PERSONAS</label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.personas}
                onChange={e => setForm(p => ({ ...p, personas: parseInt(e.target.value) || 1 }))}
                style={s.formInput}
              />
            </div>

            {/* Fecha */}
            <div style={s.formField}>
              <label style={s.formLabel}>FECHA</label>
              <input
                type="date"
                value={form.fecha}
                onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))}
                style={s.formInput}
              />
            </div>

            {/* Hora */}
            <div style={s.formField}>
              <label style={s.formLabel}>HORA</label>
              <input
                type="time"
                value={form.hora}
                onChange={e => setForm(p => ({ ...p, hora: e.target.value }))}
                style={s.formInput}
              />
            </div>

            {/* Mesa */}
            <div style={s.formField}>
              <label style={s.formLabel}>MESA PREFERIDA</label>
              <select
                value={form.mesa_id}
                onChange={e => setForm(p => ({ ...p, mesa_id: e.target.value }))}
                style={s.formInput}
              >
                <option value="">SIN PREFERENCIA</option>
                {mesas.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.nombre || `Mesa ${m.numero}`} — Cap. {m.capacidad}
                    {m.estado === 'ocupada' ? ' (ocupada)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Notas (full width) */}
            <div style={{ ...s.formField, gridColumn: '1 / -1' }}>
              <label style={s.formLabel}>NOTAS</label>
              <textarea
                value={form.notas}
                onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
                style={{ ...s.formInput, resize: 'vertical', minHeight: 60 }}
                placeholder="INSTRUCCIONES ESPECIALES, ALERGIAS, ETC."
              />
            </div>
          </div>

          {/* FORM ACTIONS */}
          <div style={s.formActions}>
            <button
              onClick={() => setShowForm(false)}
              style={s.cancelBtn}
            >
              CANCELAR
            </button>
            <button
              onClick={guardarReservacion}
              disabled={savingForm}
              style={{ ...s.saveBtn, opacity: savingForm ? 0.5 : 1 }}
            >
              {savingForm ? 'GUARDANDO...' : '✓ GUARDAR RESERVACIÓN'}
            </button>
          </div>
        </div>
      )}

      {/* MAIN */}
      <main style={s.main}>
        {moduloNoExiste ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <div style={s.emptyTitle}>MÓDULO NO CONFIGURADO</div>
            <div style={s.emptySubtitle}>MÓDULO DE RESERVACIONES NO CONFIGURADO</div>
          </div>
        ) : loading ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>⚙️</div>
            <p style={s.loadingText}>CARGANDO RESERVACIONES...</p>
          </div>
        ) : reservaciones.length === 0 ? (
          <div style={s.emptyWrap}>
            <div style={s.emptyIcon}>📅</div>
            <div style={s.emptyTitle}>SIN RESERVACIONES</div>
            <div style={s.emptySubtitle}>
              {tab === 'hoy' && 'NO HAY RESERVACIONES PARA HOY'}
              {tab === 'proximas' && 'NO HAY RESERVACIONES PRÓXIMAS'}
              {tab === 'historial' && 'EL HISTORIAL ESTÁ VACÍO'}
            </div>
          </div>
        ) : (
          <div style={s.listWrap}>
            {reservaciones.map((r, idx) => {
              const badge = ESTADO_BADGE[r.estado] ?? ESTADO_BADGE.pendiente
              const isUpdating = updatingId === r.id

              return (
                <div
                  key={r.id}
                  style={{
                    ...s.card,
                    borderTop: idx === 0 ? '1px solid var(--border)' : 'none',
                    opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  {/* CARD HEADER ROW */}
                  <div style={s.cardTop}>
                    <div style={s.cardLeft}>
                      <div style={s.cardNombre}>{r.cliente_nombre.toUpperCase()}</div>
                      {r.telefono && (
                        <div style={s.cardMeta}>📞 {r.telefono}</div>
                      )}
                      <div style={s.cardMeta}>
                        👤 {r.personas} persona{r.personas !== 1 ? 's' : ''}
                        {r.mesa_nombre ? `  ·  🪑 ${r.mesa_nombre}` : ''}
                      </div>
                      <div style={s.cardFecha}>
                        📅 {fmtFechaHora(r.fecha, r.hora)}
                      </div>
                      {r.notas && (
                        <div style={s.cardNotas}>💬 {r.notas}</div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <span style={{ ...s.estadoBadge, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {/* ACTIONS */}
                  {r.estado !== 'cancelada' && r.estado !== 'completada' && (
                    <div style={s.cardActions}>
                      {r.estado === 'pendiente' && (
                        <button
                          onClick={() => cambiarEstado(r.id, 'confirmada')}
                          disabled={isUpdating}
                          style={s.btnConfirmar}
                        >
                          ✓ CONFIRMAR
                        </button>
                      )}
                      <button
                        onClick={() => cambiarEstado(r.id, 'completada')}
                        disabled={isUpdating}
                        style={s.btnCompletar}
                      >
                        ✓ COMPLETADA
                      </button>
                      <button
                        onClick={() => cambiarEstado(r.id, 'cancelada')}
                        disabled={isUpdating}
                        style={s.btnCancelar}
                      >
                        ✗ CANCELAR
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* FOOTER SUMMARY */}
      {!loading && !moduloNoExiste && reservaciones.length > 0 && (
        <footer style={s.footer}>
          <div style={s.footerItem}>
            <div style={s.footerLabel}>RESERVACIONES</div>
            <div style={s.footerValue}>{reservaciones.length}</div>
          </div>
          <div style={s.footerDivider} />
          <div style={s.footerItem}>
            <div style={s.footerLabel}>PERSONAS TOTALES</div>
            <div style={{ ...s.footerValue, color: 'var(--yellow)' }}>
              {reservaciones.reduce((sum, r) => sum + r.personas, 0)}
            </div>
          </div>
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
    padding: '7px 14px',
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

  // FORM
  formPanel: {
    background: 'var(--charcoal)',
    borderBottom: '2px solid var(--yellow)',
    padding: '16px 20px',
    flexShrink: 0,
  },
  formTitle: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--yellow)',
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 10,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  formLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  formInput: {
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '7px 10px',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'inherit',
    outline: 'none',
    borderRadius: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  formActions: {
    display: 'flex',
    gap: 10,
    marginTop: 14,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    padding: '8px 18px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },
  saveBtn: {
    background: 'var(--yellow)',
    border: '1px solid var(--yellow)',
    color: 'var(--black)',
    padding: '8px 20px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.15em',
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
    borderLeft: '3px solid var(--border)',
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
  },
  cardFecha: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--yellow)',
  },
  cardNotas: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: 'var(--muted)',
    fontStyle: 'italic',
    marginTop: 2,
  },
  estadoBadge: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    padding: '3px 10px',
    display: 'inline-block',
  },
  cardActions: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  btnConfirmar: {
    background: 'rgba(74,222,128,0.15)',
    border: '1px solid #4ADE80',
    color: '#4ADE80',
    padding: '5px 14px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },
  btnCompletar: {
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    padding: '5px 14px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
  },
  btnCancelar: {
    background: 'rgba(248,113,113,0.12)',
    border: '1px solid #F87171',
    color: '#F87171',
    padding: '5px 14px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    borderRadius: 0,
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
