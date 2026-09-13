import React, { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'

interface Props { cajero: CajeroActivo; onVolver: () => void }
interface Fiado { id: string; cliente_nombre: string; cliente_telefono: string | null; saldo: number; limite_credito: number; activo: boolean; notas: string | null; created_at: string }
interface Movimiento { id: string; tipo: string; monto: number; concepto: string | null; cajero_nombre: string | null; created_at: string }

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtFecha = (s: string) => new Date(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function FiadosPage({ cajero, onVolver }: Props) {
  const [fiados, setFiados] = useState<Fiado[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Fiado | null>(null)
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [showNuevo, setShowNuevo] = useState(false)
  const [showMov, setShowMov] = useState(false)
  const [nombre, setNombre] = useState(''); const [tel, setTel] = useState(''); const [limite, setLimite] = useState('500'); const [notaF, setNotaF] = useState('')
  const [movTipo, setMovTipo] = useState<'cargo' | 'abono'>('cargo'); const [movMonto, setMovMonto] = useState(''); const [movConcepto, setMovConcepto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => { cargar() }, [])
  useEffect(() => { if (selected) cargarMovs(selected.id) }, [selected])

  async function cargar() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('fiados').select('*').eq('activo', true).order('cliente_nombre')
      if (error) { toast.error('Error al cargar fiados'); return }
      setFiados((data as Fiado[]) ?? [])
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }

  async function cargarMovs(fiadoId: string) {
    const { data, error } = await supabase.from('fiados_movimientos').select('*').eq('fiado_id', fiadoId).order('created_at', { ascending: false }).limit(20)
    if (error) { toast.error('Error al cargar movimientos'); return }
    setMovs((data as Movimiento[]) ?? [])
  }

  async function crearFiado(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setGuardando(true)
    try {
      const { error } = await supabase.from('fiados').insert({ cliente_nombre: nombre.trim(), cliente_telefono: tel.trim() || null, limite_credito: parseFloat(limite) || 500, saldo: 0, notas: notaF.trim() || null })
      if (error) { toast.error('Error al crear fiado: ' + error.message); return }
      setNombre(''); setTel(''); setLimite('500'); setNotaF('')
      setShowNuevo(false); cargar()
    } catch {
      toast.error('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function agregarMov(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || guardando) return
    const m = parseFloat(movMonto)
    if (isNaN(m) || m <= 0) return

    // Validar abono mayor al saldo actual
    if (movTipo === 'abono' && m > (selected.saldo ?? 0)) {
      const ok = window.confirm(
        `El abono ($${m.toFixed(2)}) es mayor al saldo ($${(selected.saldo ?? 0).toFixed(2)}). El saldo quedará en $0. ¿Continuar?`
      )
      if (!ok) return
    }

    setGuardando(true)

    // Intentar RPC atómico primero
    const { data: rpcData, error: rpcErr } = await supabase.rpc('agregar_movimiento_fiado', {
      p_fiado_id: selected.id,
      p_monto: m,
      p_tipo: movTipo,
      p_descripcion: movConcepto.trim() || '',
    })

    if (!rpcErr && (rpcData as any)?.ok) {
      toast.success('Movimiento registrado')
      setMovMonto(''); setMovConcepto('')
      setShowMov(false); setGuardando(false)
      cargar()
      cargarMovs(selected.id)
      return
    }

    // Fallback: dos operaciones con rollback si falla el UPDATE de saldo
    const { data: movData, error: errMov } = await supabase.from('fiados_movimientos').insert({
      fiado_id: selected.id,
      tipo: movTipo,
      monto: m,
      concepto: movConcepto.trim() || null,
      cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
    }).select('id').single()
    if (errMov || !movData) { toast.error('Error al registrar movimiento'); setGuardando(false); return }

    const nuevoSaldo = movTipo === 'cargo'
      ? selected.saldo + m
      : Math.max(0, selected.saldo - m)
    const { error: errSaldo } = await supabase.from('fiados').update({ saldo: nuevoSaldo }).eq('id', selected.id)
    if (errSaldo) {
      // Rollback: eliminar el movimiento ya insertado para no dejar datos inconsistentes
      await supabase.from('fiados_movimientos').delete().eq('id', movData.id)
      toast.error('Error al actualizar saldo — movimiento revertido')
      setGuardando(false)
      return
    }

    toast.success('Movimiento registrado')
    setMovMonto(''); setMovConcepto('')
    setShowMov(false); setGuardando(false)
    cargar()
    const fiadoActualizado = { ...selected, saldo: nuevoSaldo }
    setSelected(fiadoActualizado)
    cargarMovs(selected.id)
  }

  const filtrados = fiados.filter(f => f.cliente_nombre.toLowerCase().includes(busqueda.toLowerCase()) || (f.cliente_telefono ?? '').includes(busqueda))
  const totalDeuda = fiados.reduce((s, f) => s + Number(f.saldo), 0)

  const s = { background: 'var(--dark)', minHeight: '100vh' }
  const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1.25rem', marginBottom: '0.75rem' }
  const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={selected ? () => setSelected(null) : onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← {selected ? 'Lista' : 'Volver'}</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>📒 Fiados</h1>
          {!selected && <button onClick={() => setShowNuevo(true)} style={{ marginLeft: 'auto', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, padding: '0.5rem 1rem', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>+ Nuevo</button>}
        </div>

        {!selected ? (
          <>
            {/* Resumen */}
            <div style={{ ...card, borderLeft: '4px solid #ef4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Total en deuda</div>
                <div style={{ color: '#ef4444', fontWeight: 900, fontSize: '1.5rem' }}>{fmt(totalDeuda)}</div>
              </div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.85rem' }}>{fiados.length} cuenta{fiados.length !== 1 ? 's' : ''}</div>
            </div>

            {/* Búsqueda */}
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar cliente..." style={{ ...inp, marginBottom: '1rem' }} />

            {/* Lista */}
            {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem', fontWeight: 900 }}>Cargando...</div> :
              filtrados.map(f => (
                <div key={f.id} style={{ ...card, cursor: 'pointer', borderLeft: `4px solid ${f.saldo > 0 ? '#ef4444' : '#22c55e'}` }} onClick={() => setSelected(f)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.95rem' }}>{f.cliente_nombre}</div>
                      {f.cliente_telefono && <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{f.cliente_telefono}</div>}
                      <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 900, marginTop: '0.2rem' }}>Límite: {fmt(f.limite_credito)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: f.saldo > 0 ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '1.1rem' }}>{fmt(f.saldo)}</div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 900 }}>{f.saldo > 0 ? 'DEBE' : 'AL DÍA'}</div>
                    </div>
                  </div>
                </div>
              ))}
          </>
        ) : (
          /* Detalle del fiado */
          <>
            <div style={{ ...card, borderLeft: `4px solid ${selected.saldo > 0 ? '#ef4444' : '#22c55e'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem' }}>{selected.cliente_nombre}</div>
                  {selected.cliente_telefono && <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{selected.cliente_telefono}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: selected.saldo > 0 ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '1.8rem' }}>{fmt(selected.saldo)}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900 }}>Saldo pendiente</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button onClick={() => { setMovTipo('cargo'); setShowMov(true) }} style={{ flex: 1, padding: '0.6rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 2, color: '#ef4444', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>+ Cargo</button>
                <button onClick={() => { setMovTipo('abono'); setShowMov(true) }} style={{ flex: 1, padding: '0.6rem', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 2, color: '#22c55e', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>✓ Abono</button>
              </div>
            </div>

            <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Últimos movimientos</div>
            {movs.length === 0 ? <div style={{ ...card, color: 'var(--muted)', textAlign: 'center' }}>Sin movimientos</div> :
              movs.map(m => (
                <div key={m.id} style={{ ...card, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.85rem' }}>{m.concepto ?? (m.tipo === 'cargo' ? 'Cargo' : 'Abono')}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 900 }}>{fmtFecha(m.created_at)}</div>
                  </div>
                  <span style={{ color: m.tipo === 'cargo' ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '0.95rem' }}>{m.tipo === 'cargo' ? '+' : '-'}{fmt(m.monto)}</span>
                </div>
              ))}
          </>
        )}

        {/* Modal nuevo fiado */}
        {showNuevo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowNuevo(false)}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', borderRadius: 2, padding: '1.5rem', width: '100%', maxWidth: 400 }} onClick={e => e.stopPropagation()}>
              <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Nueva cuenta de fiado</div>
              <form onSubmit={crearFiado}>
                <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del cliente" required style={inp} />
                <input value={tel} onChange={e => setTel(e.target.value)} placeholder="Teléfono (opcional)" style={inp} />
                <input type="number" value={limite} onChange={e => setLimite(e.target.value)} placeholder="Límite de crédito" style={inp} />
                <input value={notaF} onChange={e => setNotaF(e.target.value)} placeholder="Notas (opcional)" style={inp} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setShowNuevo(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                  <button type="submit" disabled={guardando} style={{ flex: 1, padding: '0.65rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>Crear</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal movimiento */}
        {showMov && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowMov(false)}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: `3px solid ${movTipo === 'cargo' ? '#ef4444' : '#22c55e'}`, borderRadius: 2, padding: '1.5rem', width: '100%', maxWidth: 360 }} onClick={e => e.stopPropagation()}>
              <div style={{ color: movTipo === 'cargo' ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                {movTipo === 'cargo' ? '+ Nuevo Cargo' : '✓ Registrar Abono'}
              </div>
              <form onSubmit={agregarMov}>
                <input type="number" min="0.01" step="0.01" value={movMonto} onChange={e => setMovMonto(e.target.value)} placeholder="Monto" required style={inp} />
                <input value={movConcepto} onChange={e => setMovConcepto(e.target.value)} placeholder="Concepto (opcional)" style={inp} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setShowMov(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                  <button type="submit" disabled={guardando} style={{ flex: 1, padding: '0.65rem', background: movTipo === 'cargo' ? '#ef4444' : '#22c55e', color: '#fff', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {movTipo === 'cargo' ? 'Cargar' : 'Abonar'}
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
