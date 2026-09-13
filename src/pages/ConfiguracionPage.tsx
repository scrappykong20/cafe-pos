import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'
import {
  getSlot, setSlot, type PrinterSlot, hayImpresora,
  imprimirPorTipo, pingImpresora,
  listarImpresoras, buildComandaHTML, buildReciboHTML,
} from '../services/printer'

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

type ConfigMap = Record<string, string>
type ConfigTab = 'config' | 'personal'

const ROL_COLORS: Record<string, string> = {
  admin: '#a855f7',
  cajero: '#F0A800',
  cocinero: '#ef4444',
  mesero: '#22c55e',
  barista: '#3b82f6',
  gerente: '#a855f7',
}

interface Section {
  key: string
  label: string
  fields: { clave: string; label: string; type: 'text' | 'number' | 'toggle' }[]
}

const SECTIONS: Section[] = [
  {
    key: 'local',
    label: 'Local',
    fields: [
      { clave: 'rest_nombre',    label: 'Nombre del Local', type: 'text' },
      { clave: 'rfc',            label: 'RFC',              type: 'text' },
      { clave: 'rest_direccion', label: 'Dirección',        type: 'text' },
      { clave: 'rest_telefono',  label: 'Teléfono',         type: 'text' },
    ],
  },
  {
    key: 'fiscal',
    label: 'Fiscal',
    fields: [
      { clave: 'iva_incluido', label: 'IVA Incluido en Precio', type: 'toggle' },
      { clave: 'iva_porcentaje', label: 'Porcentaje de IVA', type: 'number' },
    ],
  },
  {
    key: 'sistema',
    label: 'Sistema',
    fields: [
      { clave: 'printer_url', label: 'URL de Impresora', type: 'text' },
      { clave: 'whatsapp_template', label: 'Plantilla WhatsApp', type: 'text' },
    ],
  },
]

const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  background: 'var(--dark)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontWeight: 700,
  boxSizing: 'border-box',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--muted)',
  fontSize: '0.65rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  fontWeight: 900,
  marginBottom: '0.35rem',
}

export default function ConfiguracionPage({ cajero, onVolver }: Props) {
  const [config, setConfig] = useState<ConfigMap>({})
  const [localEdits, setLocalEdits] = useState<ConfigMap>({})
  const [loading, setLoading] = useState(true)
  // feedback per section key: 'ok' | 'error' | null
  const [feedback, setFeedback] = useState<Record<string, 'ok' | 'error' | null>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  // Impresoras (localStorage)
  const [slot1, setSlot1State] = useState<PrinterSlot>(() => getSlot(1))
  const [slot2, setSlot2State] = useState<PrinterSlot>(() => getSlot(2))
  const [impresoras, setImpresoras] = useState<string[]>([])
  const [detectando, setDetectando] = useState(false)
  const [pingState, setPingState] = useState<{[k: number]: 'idle'|'checking'|'ok'|'error'}>({1: 'idle', 2: 'idle'})
  const [slotFeedback, setSlotFeedback] = useState<{[k: number]: 'ok'|'error'|null}>({1: null, 2: null})

  // Config tabs
  const [configTab, setConfigTab] = useState<ConfigTab>('config')

  // Personal
  const [personalList, setPersonalList] = useState<{ id: string; nombre: string; apellido: string; rol: string; pin: string | null; activo: boolean; fecha_nacimiento: string | null; sueldo_semana: number | null; porcentaje_propina: number | null }[]>([])
  const [loadingPersonal, setLoadingPersonal] = useState(false)
  const [showAddPersonal, setShowAddPersonal] = useState(false)
  const [editingPersonal, setEditingPersonal] = useState<string | null>(null)
  const [formPersonal, setFormPersonal] = useState({ nombre: '', apellido: '', rol: 'cajero', pin: '', activo: true, fecha_nacimiento: '', sueldo_semana: '', porcentaje_propina: '70' })
  const [savingPersonal, setSavingPersonal] = useState(false)

  // Porcentaje de propina por defecto según rol
  const propinaPorRol: Record<string, string> = { cocinero: '30', cajero: '70', mesero: '70', gerente: '0' }

  function updateSlot(n: 1 | 2, patch: Partial<PrinterSlot>) {
    if (n === 1) {
      const updated = { ...slot1, ...patch }
      setSlot1State(updated)
      setSlot(1, updated)
    } else {
      const updated = { ...slot2, ...patch }
      setSlot2State(updated)
      setSlot(2, updated)
    }
  }

  async function detectarImpresoras() {
    setDetectando(true)
    try {
      const lista = await listarImpresoras()
      setImpresoras(lista)
      // Auto-asignar primera Epson al slot vacío si no hay ninguno configurado
      if (!hayImpresora('caja') && lista.length > 0) {
        const epson = lista.find(p => p.toLowerCase().includes('tm-t') || p.toLowerCase().includes('receipt'))
        if (epson) {
          const s1 = getSlot(1)
          if (!s1.nombre && !s1.ip) updateSlot(1, { tipo: 'caja', modo: 'cable', nombre: epson })
        }
      }
    } catch {
      // error al listar impresoras
    } finally {
      setDetectando(false)
    }
  }

  async function hacerPing(n: 1 | 2) {
    const slot = n === 1 ? slot1 : slot2
    const ip = slot.ip.trim()
    if (!ip) return
    setPingState(prev => ({ ...prev, [n]: 'checking' }))
    const ok = await pingImpresora(ip)
    setPingState(prev => ({ ...prev, [n]: ok ? 'ok' : 'error' }))
    setTimeout(() => setPingState(prev => ({ ...prev, [n]: 'idle' })), 5000)
  }

  async function probarSlot(n: 1 | 2) {
    const slot = n === 1 ? slot1 : slot2
    const tipo = slot.tipo as 'caja' | 'cocina'
    if (!tipo) return
    const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const merged = { ...config, ...localEdits }
    let html: string
    if (tipo === 'caja') {
      html = buildReciboHTML({
        fecha: hora, ordenStr: '#001', mesaNombre: 'Mesa 1',
        items: [{ emoji: '☕', nombre: 'Capuccino', cantidad: 1, precio: 55 }],
        canjeItems: [], subtotalBase: 55, descuentoTotal: 0, propinaMonto: 0,
        totalACobrar: 55, metodoPagoLabel: 'Efectivo', cambioFinal: 0,
        metodoPago: 'efectivo', engranajeFinal: 0, saldoFinal: 0,
        nombreLocal: merged['rest_nombre'],
        direccionLocal: merged['rest_direccion'],
        telefonoLocal: merged['rest_telefono'],
      })
    } else {
      html = buildComandaHTML({
        ordenStr: '#001', mesaNombre: 'Mesa 1', cajeroNombre: cajero.nombre,
        tipo: 'comedor', hora,
        items: [{ emoji: '☕', nombre: 'Capuccino', cantidad: 1, notas: 'Sin azúcar' }],
      })
    }
    const ok = await imprimirPorTipo(tipo, html)
    setSlotFeedback(prev => ({ ...prev, [n]: ok ? 'ok' : 'error' }))
    setTimeout(() => setSlotFeedback(prev => ({ ...prev, [n]: null })), 3000)
  }

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('configuracion').select('clave, valor')
      if (error) throw error
      const map: ConfigMap = {}
      ;(data || []).forEach((row: { clave: string; valor: string }) => {
        map[row.clave] = row.valor ?? ''
      })
      setConfig(map)
      setLocalEdits(map)
    } catch {
      toast.error('Error al cargar configuración — revisa la conexión')
    } finally {
      setLoading(false)
    }
  }

  async function cargarPersonal() {
    setLoadingPersonal(true)
    try {
      const { data, error } = await supabase.from('personal').select('id, nombre, apellido, rol, pin, activo, fecha_nacimiento, sueldo_semana, porcentaje_propina').order('nombre')
      if (error) { toast.error('Error cargando personal'); return }
      setPersonalList((data as any[]) ?? [])
    } finally {
      setLoadingPersonal(false)
    }
  }

  async function guardarPersonal() {
    if (savingPersonal) return
    if (!formPersonal.nombre.trim()) return
    const pinTrim = formPersonal.pin.trim()
    if (pinTrim !== '' && !/^\d{4}$/.test(pinTrim)) {
      toast.error('El PIN debe tener exactamente 4 dígitos numéricos')
      return
    }
    setSavingPersonal(true)
    try {
      const payload = {
        nombre: formPersonal.nombre.trim(),
        apellido: formPersonal.apellido.trim(),
        rol: formPersonal.rol,
        pin: formPersonal.pin.trim() || null,
        activo: formPersonal.activo,
        fecha_nacimiento: formPersonal.fecha_nacimiento || null,
        sueldo_semana: formPersonal.sueldo_semana !== '' ? parseFloat(formPersonal.sueldo_semana) : null,
        porcentaje_propina: formPersonal.porcentaje_propina !== '' ? parseFloat(formPersonal.porcentaje_propina) : 0,
      }
      let opError
      if (editingPersonal) {
        const { error } = await supabase.from('personal').update(payload).eq('id', editingPersonal)
        opError = error
      } else {
        const { error } = await supabase.from('personal').insert(payload)
        opError = error
      }
      if (opError) { toast.error('Error al guardar empleado: ' + opError.message); return }
      setShowAddPersonal(false)
      setEditingPersonal(null)
      setFormPersonal({ nombre: '', apellido: '', rol: 'cajero', pin: '', activo: true, fecha_nacimiento: '', sueldo_semana: '', porcentaje_propina: '70' })
      await cargarPersonal()
    } finally {
      setSavingPersonal(false)
    }
  }

  async function toggleActivo(id: string, activo: boolean) {
    const { error } = await supabase.from('personal').update({ activo: !activo }).eq('id', id)
    if (error) { toast.error('Error al actualizar empleado'); return }
    await cargarPersonal()
  }

  function handleChange(clave: string, value: string) {
    setLocalEdits((prev) => ({ ...prev, [clave]: value }))
  }

  async function saveSection(section: Section) {
    setSaving((prev) => ({ ...prev, [section.key]: true }))
    setFeedback((prev) => ({ ...prev, [section.key]: null }))
    try {
      const upserts = section.fields.map((f) => ({
        clave: f.clave,
        valor: localEdits[f.clave] ?? '',
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('configuracion')
        .upsert(upserts, { onConflict: 'clave' })
      if (error) throw error
      // Sync saved values
      const newConfig = { ...config }
      section.fields.forEach((f) => {
        newConfig[f.clave] = localEdits[f.clave] ?? ''
      })
      setConfig(newConfig)
      setFeedback((prev) => ({ ...prev, [section.key]: 'ok' }))
      setTimeout(() => setFeedback((prev) => ({ ...prev, [section.key]: null })), 3000)
    } catch {
      setFeedback((prev) => ({ ...prev, [section.key]: 'error' }))
    } finally {
      setSaving((prev) => ({ ...prev, [section.key]: false }))
    }
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: 'var(--yellow)',
            fontWeight: 900,
            fontSize: '1rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          Cargando...
        </span>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark)', padding: '1.5rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '2rem',
          }}
        >
          <button
            onClick={onVolver}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 0,
              padding: '0.4rem 0.75rem',
              color: 'var(--muted)',
              fontWeight: 900,
              fontSize: '0.75rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            ← Volver
          </button>
          <h1
            style={{
              color: 'var(--yellow)',
              fontWeight: 900,
              fontSize: '1.1rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            Configuración
          </h1>
        </div>

        {/* Tab switcher */}
        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            marginBottom: '1.5rem',
            background: 'var(--charcoal)',
            border: '1px solid var(--border)',
            borderRadius: 0,
            padding: '0.25rem',
          }}
        >
          {([
            { key: 'config', label: '⚙️ Configuración' },
            { key: 'personal', label: '👥 Personal' },
          ] as { key: ConfigTab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setConfigTab(t.key)
                if (t.key === 'personal') cargarPersonal()
              }}
              style={{
                flex: 1,
                padding: '0.5rem',
                background: configTab === t.key ? 'var(--yellow)' : 'transparent',
                color: configTab === t.key ? 'var(--black)' : 'var(--muted)',
                border: 'none',
                borderRadius: 0,
                fontWeight: 900,
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {configTab === 'config' && (<>

        {/* Admin note */}
        {!cajero.es_admin && (
          <div
            style={{
              background: 'var(--charcoal)',
              border: '1px solid #f59e0b',
              borderLeft: '4px solid #f59e0b',
              borderRadius: 0,
              padding: '0.75rem 1rem',
              marginBottom: '1.5rem',
              color: '#f59e0b',
              fontSize: '0.75rem',
              fontWeight: 900,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Solo administradores pueden guardar cambios
          </div>
        )}

        {/* Sección impresoras — 2 slots, cable o red */}
        <div style={{ background:'var(--charcoal)', border:'1px solid var(--border)', borderTop:'3px solid #3b82f6', borderRadius:0, padding:'1.25rem', marginBottom:'1.25rem' }}>
          <div style={{ color:'#3b82f6', fontSize:'0.7rem', letterSpacing:'0.25em', textTransform:'uppercase', fontWeight:900, marginBottom:'0.6rem' }}>
            🖨️ Impresoras térmicas
          </div>
          <p style={{ color:'var(--muted)', fontSize:'0.7rem', marginBottom:'1rem', letterSpacing:'0.05em' }}>
            Configura hasta 2 impresoras. Elige si es de caja o cocina, y si se conecta por cable USB o por red (IP).
          </p>

          {/* Detectar impresoras USB */}
          <button
            onClick={detectarImpresoras}
            disabled={detectando}
            style={{ width:'100%', padding:'0.55rem', background:'var(--dark)', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:0, fontWeight:900, fontSize:'0.7rem', letterSpacing:'0.15em', textTransform:'uppercase', cursor:'pointer', marginBottom:'0.85rem' }}
          >
            {detectando ? 'Detectando...' : '🔍 Detectar impresoras USB / local'}
          </button>

          {impresoras.length > 0 && (
            <div style={{ padding:'0.6rem 0.75rem', background:'rgba(34,197,94,0.06)', border:'1px solid #22c55e33', borderRadius:0, marginBottom:'1rem' }}>
              <div style={{ color:'#22c55e', fontSize:'0.65rem', fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:'0.5rem' }}>Impresoras detectadas:</div>
              {impresoras.map(p => (
                <div key={p} style={{ display:'flex', gap:'0.4rem', marginBottom:'0.35rem', alignItems:'center' }}>
                  <button onClick={() => updateSlot(1, { nombre: p, modo: 'cable' })} style={{ padding:'0.25rem 0.5rem', background:'var(--dark)', color:'var(--muted)', border:'1px solid var(--border)', fontSize:'0.6rem', fontWeight:900, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em', whiteSpace:'nowrap' }}>→ Slot 1</button>
                  <button onClick={() => updateSlot(2, { nombre: p, modo: 'cable' })} style={{ padding:'0.25rem 0.5rem', background:'var(--dark)', color:'var(--muted)', border:'1px solid var(--border)', fontSize:'0.6rem', fontWeight:900, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em', whiteSpace:'nowrap' }}>→ Slot 2</button>
                  <span style={{ flex:1, color:'var(--text)', fontSize:'0.7rem', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</span>
                </div>
              ))}
            </div>
          )}

          {/* Slot 1 y Slot 2 */}
          {([1, 2] as const).map((n) => {
            const slot = n === 1 ? slot1 : slot2
            const ping = pingState[n]
            const fb   = slotFeedback[n]
            const borderColor = slot.tipo === 'caja' ? '#F0A800' : slot.tipo === 'cocina' ? '#ef4444' : 'var(--border)'
            return (
              <div key={n} style={{ background:'var(--dark)', border:'1px solid var(--border)', borderLeft:`3px solid ${borderColor}`, padding:'1rem', marginBottom:'0.85rem' }}>
                <div style={{ color:'var(--muted)', fontSize:'0.65rem', fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:'0.75rem' }}>
                  Impresora {n}
                </div>

                {/* Función (rol) */}
                <div style={{ marginBottom:'0.65rem' }}>
                  <label style={labelStyle}>Función</label>
                  <div style={{ display:'flex', gap:'0.35rem' }}>
                    {(['caja', 'cocina', ''] as const).map((tipo, idx) => (
                      <button
                        key={idx}
                        onClick={() => updateSlot(n, { tipo })}
                        style={{
                          flex:1, padding:'0.4rem',
                          background: slot.tipo === tipo
                            ? tipo === 'caja' ? '#F0A800' : tipo === 'cocina' ? '#ef4444' : '#555'
                            : 'var(--charcoal)',
                          color: slot.tipo === tipo ? '#fff' : 'var(--muted)',
                          border: `1px solid ${slot.tipo === tipo ? 'transparent' : 'var(--border)'}`,
                          fontSize:'0.65rem', fontWeight:900, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em',
                        }}
                      >
                        {tipo === 'caja' ? '🖨️ Caja' : tipo === 'cocina' ? '🍳 Cocina' : '— Ninguna'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modo de conexión */}
                <div style={{ marginBottom:'0.65rem' }}>
                  <label style={labelStyle}>Conexión</label>
                  <div style={{ display:'flex', gap:'0.35rem' }}>
                    {(['cable', 'red'] as const).map(modo => (
                      <button
                        key={modo}
                        onClick={() => updateSlot(n, { modo })}
                        style={{
                          flex:1, padding:'0.4rem',
                          background: slot.modo === modo ? '#3b82f6' : 'var(--charcoal)',
                          color: slot.modo === modo ? '#fff' : 'var(--muted)',
                          border: `1px solid ${slot.modo === modo ? '#3b82f6' : 'var(--border)'}`,
                          fontSize:'0.65rem', fontWeight:900, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.1em',
                        }}
                      >
                        {modo === 'cable' ? '🔌 Cable / USB' : '📡 Red / IP'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Campo según modo */}
                {slot.modo === 'cable' ? (
                  <div style={{ marginBottom:'0.65rem' }}>
                    <label style={labelStyle}>Nombre de impresora (Windows)</label>
                    <input
                      value={slot.nombre}
                      onChange={e => updateSlot(n, { nombre: e.target.value })}
                      placeholder="Ej: EPSON TM-T20IV Receipt6"
                      style={inputBase}
                    />
                  </div>
                ) : (
                  <div style={{ marginBottom:'0.65rem' }}>
                    <label style={labelStyle}>Dirección IP</label>
                    <div style={{ display:'flex', gap:'0.4rem' }}>
                      <input
                        value={slot.ip}
                        onChange={e => updateSlot(n, { ip: e.target.value })}
                        placeholder="Ej: 192.168.1.100"
                        style={{ ...inputBase, flex:1 }}
                      />
                      <button
                        onClick={() => hacerPing(n)}
                        disabled={ping === 'checking' || !slot.ip.trim()}
                        style={{
                          padding:'0.6rem 0.75rem',
                          background: ping === 'ok' ? '#22c55e' : ping === 'error' ? '#ef4444' : 'var(--charcoal)',
                          color: ping === 'ok' || ping === 'error' ? '#fff' : 'var(--muted)',
                          border: `1px solid ${ping === 'ok' ? '#22c55e' : ping === 'error' ? '#ef4444' : 'var(--border)'}`,
                          fontSize:'0.65rem', fontWeight:900, cursor: ping === 'checking' || !slot.ip.trim() ? 'not-allowed' : 'pointer',
                          letterSpacing:'0.1em', textTransform:'uppercase', whiteSpace:'nowrap',
                        }}
                      >
                        {ping === 'checking' ? '...' : ping === 'ok' ? '✓ OK' : ping === 'error' ? '✗ Sin resp.' : 'Probar'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Probar impresión */}
                <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                  <button
                    onClick={() => probarSlot(n)}
                    disabled={!slot.tipo || (slot.modo === 'cable' ? !slot.nombre.trim() : !slot.ip.trim())}
                    style={{
                      flex:1, padding:'0.55rem',
                      background:'var(--charcoal)', color:'var(--muted)',
                      border:'1px solid var(--border)', fontSize:'0.65rem', fontWeight:900,
                      cursor: !slot.tipo ? 'not-allowed' : 'pointer',
                      letterSpacing:'0.15em', textTransform:'uppercase',
                    }}
                  >
                    Probar impresión
                  </button>
                  {fb === 'ok' && <span style={{ color:'#22c55e', fontSize:'0.75rem', fontWeight:900 }}>✓ Impreso</span>}
                  {fb === 'error' && <span style={{ color:'#ef4444', fontSize:'0.75rem', fontWeight:900 }}>✗ Error</span>}
                </div>
                <div style={{ color:'var(--muted)', fontSize:'0.6rem', marginTop:'0.4rem', letterSpacing:'0.05em' }}>
                  Se guarda automáticamente en este equipo
                </div>
              </div>
            )
          })}
        </div>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <div
            key={section.key}
            style={{
              background: 'var(--charcoal)',
              border: '1px solid var(--border)',
              borderTop: '3px solid var(--yellow)',
              borderRadius: 0,
              padding: '1.25rem',
              marginBottom: '1.25rem',
            }}
          >
            {/* Section header */}
            <div
              style={{
                color: 'var(--yellow)',
                fontSize: '0.7rem',
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                fontWeight: 900,
                marginBottom: '1rem',
              }}
            >
              {section.label}
            </div>

            {/* Fields */}
            {section.fields.map((field) => (
              <div key={field.clave} style={{ marginBottom: '0.85rem' }}>
                <label style={labelStyle}>{field.label}</label>
                {field.type === 'toggle' ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['true', 'false'].map((val) => (
                      <button
                        key={val}
                        onClick={() => handleChange(field.clave, val)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          background:
                            (localEdits[field.clave] ?? 'false') === val
                              ? 'var(--yellow)'
                              : 'var(--dark)',
                          color:
                            (localEdits[field.clave] ?? 'false') === val
                              ? 'var(--black)'
                              : 'var(--muted)',
                          border: '1px solid var(--border)',
                          borderRadius: 0,
                          fontWeight: 900,
                          fontSize: '0.75rem',
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        {val === 'true' ? 'Sí' : 'No'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type={field.type}
                    value={localEdits[field.clave] ?? ''}
                    onChange={(e) => handleChange(field.clave, e.target.value)}
                    style={inputBase}
                    min={field.type === 'number' ? '0' : undefined}
                    step={field.type === 'number' ? '0.01' : undefined}
                  />
                )}
              </div>
            ))}

            {/* Feedback */}
            {feedback[section.key] === 'ok' && (
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid #22c55e',
                  borderRadius: 0,
                  color: '#22c55e',
                  fontSize: '0.7rem',
                  fontWeight: 900,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                }}
              >
                Cambios guardados correctamente
              </div>
            )}
            {feedback[section.key] === 'error' && (
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid #ef4444',
                  borderRadius: 0,
                  color: '#ef4444',
                  fontSize: '0.7rem',
                  fontWeight: 900,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                }}
              >
                Error al guardar. Intenta de nuevo.
              </div>
            )}

            {/* Save button */}
            <button
              onClick={() => saveSection(section)}
              disabled={saving[section.key] || !cajero.es_admin}
              style={{
                width: '100%',
                padding: '0.65rem',
                background: cajero.es_admin ? 'var(--yellow)' : 'var(--border)',
                color: cajero.es_admin ? 'var(--black)' : 'var(--muted)',
                border: 'none',
                borderRadius: 0,
                fontWeight: 900,
                fontSize: '0.75rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                cursor: saving[section.key] || !cajero.es_admin ? 'not-allowed' : 'pointer',
                opacity: saving[section.key] ? 0.7 : 1,
              }}
            >
              {saving[section.key] ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        ))}

        </>)}

        {/* --- TAB: PERSONAL --- */}
        {configTab === 'personal' && (
          <div>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900 }}>
                {personalList.length} empleado{personalList.length !== 1 ? 's' : ''}
              </div>
              {!showAddPersonal && !editingPersonal && (
                <button
                  onClick={() => { setShowAddPersonal(true); setEditingPersonal(null); setFormPersonal({ nombre: '', apellido: '', rol: 'cajero', pin: '', activo: true, fecha_nacimiento: '', sueldo_semana: '', porcentaje_propina: '70' }) }}
                  style={{
                    padding: '0.45rem 0.85rem',
                    background: 'var(--yellow)',
                    color: 'var(--black)',
                    border: 'none',
                    borderRadius: 0,
                    fontWeight: 900,
                    fontSize: '0.75rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  + Agregar empleado
                </button>
              )}
            </div>

            {/* Inline form */}
            {(showAddPersonal || editingPersonal) && (
              <div
                style={{
                  background: 'var(--charcoal)',
                  border: '1px solid var(--border)',
                  borderTop: '3px solid var(--yellow)',
                  borderRadius: 0,
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ color: 'var(--yellow)', fontSize: '0.7rem', letterSpacing: '0.25em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '1rem' }}>
                  {editingPersonal ? 'Editar empleado' : 'Nuevo empleado'}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={labelStyle}>Nombre</label>
                    <input
                      type="text"
                      value={formPersonal.nombre}
                      onChange={(e) => setFormPersonal(p => ({ ...p, nombre: e.target.value }))}
                      placeholder="Nombre"
                      style={inputBase}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Apellido</label>
                    <input
                      type="text"
                      value={formPersonal.apellido}
                      onChange={(e) => setFormPersonal(p => ({ ...p, apellido: e.target.value }))}
                      placeholder="Apellido"
                      style={inputBase}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={labelStyle}>Rol</label>
                    <select
                      value={formPersonal.rol}
                      onChange={(e) => setFormPersonal(p => ({ ...p, rol: e.target.value, porcentaje_propina: propinaPorRol[e.target.value] ?? '0' }))}
                      style={{ ...inputBase, cursor: 'pointer' }}
                    >
                      {['gerente', 'cajero', 'cocinero', 'mesero'].map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>PIN (4 dígitos)</label>
                    <input
                      type="text"
                      value={formPersonal.pin}
                      onChange={(e) => setFormPersonal(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      placeholder="0000"
                      maxLength={4}
                      pattern="\d{4}"
                      style={inputBase}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={labelStyle}>Sueldo semanal ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formPersonal.sueldo_semana}
                      onChange={(e) => setFormPersonal(p => ({ ...p, sueldo_semana: e.target.value }))}
                      placeholder="0.00"
                      style={inputBase}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>% Propina</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={formPersonal.porcentaje_propina}
                      onChange={(e) => setFormPersonal(p => ({ ...p, porcentaje_propina: e.target.value }))}
                      placeholder="0"
                      style={inputBase}
                    />
                    <div style={{ color: 'var(--muted)', fontSize: '0.6rem', marginTop: 3 }}>
                      Cocineros: 30% · Cajero/Mesero: 70%
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Fecha de nacimiento</label>
                  <input
                    type="date"
                    value={formPersonal.fecha_nacimiento}
                    onChange={(e) => setFormPersonal(p => ({ ...p, fecha_nacimiento: e.target.value }))}
                    style={{ ...inputBase, colorScheme: 'dark' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                  <input
                    type="checkbox"
                    id="activo-check"
                    checked={formPersonal.activo}
                    onChange={(e) => setFormPersonal(p => ({ ...p, activo: e.target.checked }))}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="activo-check" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>Activo</label>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={guardarPersonal}
                    disabled={savingPersonal || !formPersonal.nombre.trim()}
                    style={{
                      flex: 2,
                      padding: '0.65rem',
                      background: 'var(--yellow)',
                      color: 'var(--black)',
                      border: 'none',
                      borderRadius: 0,
                      fontWeight: 900,
                      fontSize: '0.75rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      cursor: savingPersonal || !formPersonal.nombre.trim() ? 'not-allowed' : 'pointer',
                      opacity: savingPersonal || !formPersonal.nombre.trim() ? 0.6 : 1,
                    }}
                  >
                    {savingPersonal ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => { setShowAddPersonal(false); setEditingPersonal(null) }}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      background: 'var(--dark)',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      borderRadius: 0,
                      fontWeight: 900,
                      fontSize: '0.75rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            {loadingPersonal ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem', padding: '2rem' }}>
                Cargando...
              </div>
            ) : personalList.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem', padding: '2rem' }}>
                No hay empleados registrados
              </div>
            ) : (
              personalList.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--charcoal)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${p.activo ? (ROL_COLORS[p.rol] ?? 'var(--border)') : 'var(--border)'}`,
                    borderRadius: 0,
                    padding: '0.85rem 1rem',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    opacity: p.activo ? 1 : 0.5,
                  }}
                >
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                      {p.nombre} {p.apellido}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '0.15rem 0.5rem',
                          background: `${ROL_COLORS[p.rol] ?? '#666'}22`,
                          color: ROL_COLORS[p.rol] ?? '#666',
                          border: `1px solid ${ROL_COLORS[p.rol] ?? '#666'}`,
                          fontSize: '0.6rem',
                          fontWeight: 900,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {p.rol}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em' }}>
                        PIN: {p.pin ? '●'.repeat(p.pin.length) : 'Sin PIN'}
                      </span>
                      {p.sueldo_semana != null && p.sueldo_semana > 0 && (
                        <span style={{ color: '#22c55e', fontSize: '0.7rem', fontWeight: 700 }}>
                          💵 ${Number(p.sueldo_semana).toFixed(2)}/sem
                        </span>
                      )}
                      {p.porcentaje_propina != null && p.porcentaje_propina > 0 && (
                        <span style={{ color: '#a855f7', fontSize: '0.7rem', fontWeight: 700 }}>
                          💜 {p.porcentaje_propina}% prop.
                        </span>
                      )}
                      {p.fecha_nacimiento && (
                        <span style={{ color: 'var(--muted)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                          🎂 {new Date(p.fecha_nacimiento + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Activo toggle */}
                  <button
                    onClick={() => toggleActivo(p.id, p.activo)}
                    title={p.activo ? 'Desactivar' : 'Activar'}
                    style={{
                      padding: '0.3rem 0.55rem',
                      background: p.activo ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                      color: p.activo ? '#22c55e' : '#ef4444',
                      border: `1px solid ${p.activo ? '#22c55e' : '#ef4444'}`,
                      borderRadius: 0,
                      fontWeight: 900,
                      fontSize: '0.65rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => {
                      setEditingPersonal(p.id)
                      setShowAddPersonal(false)
                      setFormPersonal({ nombre: p.nombre, apellido: p.apellido, rol: p.rol, pin: p.pin ?? '', activo: p.activo, fecha_nacimiento: p.fecha_nacimiento ?? '', sueldo_semana: p.sueldo_semana != null ? String(p.sueldo_semana) : '', porcentaje_propina: p.porcentaje_propina != null ? String(p.porcentaje_propina) : propinaPorRol[p.rol] ?? '0' })
                    }}
                    style={{
                      padding: '0.3rem 0.55rem',
                      background: 'var(--dark)',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      borderRadius: 0,
                      fontWeight: 900,
                      fontSize: '0.65rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Editar
                  </button>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  )
}
