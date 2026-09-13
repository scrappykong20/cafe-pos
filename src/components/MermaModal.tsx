import { useState, useRef, useEffect } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

interface Props { cajeroNombre: string; onClose: () => void }

const UNIDADES = ['gramos', 'kg', 'litros', 'ml', 'piezas', 'porciones']
const MOTIVOS = [
  { id: 'vencimiento', label: '⏰ Vencimiento' },
  { id: 'accidente', label: '💥 Accidente' },
  { id: 'calidad', label: '⚠️ Mala calidad' },
  { id: 'sobrante', label: '🍽️ Sobrante de servicio' },
  { id: 'otro', label: '📝 Otro' },
]

export default function MermaModal({ cajeroNombre, onClose }: Props) {
  const [ingrediente, setIngrediente] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [unidad, setUnidad] = useState('gramos')
  const [motivo, setMotivo] = useState('vencimiento')
  const [notas, setNotas] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  function onFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setFoto(file)
    if (file) {
      const url = URL.createObjectURL(file)
      setFotoPreview(url)
    } else {
      setFotoPreview(null)
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    const cant = parseFloat(cantidad)
    if (!ingrediente.trim() || isNaN(cant) || cant <= 0) return
    setGuardando(true)

    try {
      let foto_url: string | null = null
      if (foto) {
        const ext = foto.name.split('.').pop() ?? 'jpg'
        const path = `merma/${Date.now()}.${ext}`
        const { data: upData, error: uploadError } = await supabase.storage
          .from('merma-fotos')
          .upload(path, foto, { upsert: false })
        if (uploadError) {
          toast.error('Error al subir foto: ' + uploadError.message)
        } else if (upData) {
          const { data: urlData } = supabase.storage.from('merma-fotos').getPublicUrl(path)
          foto_url = urlData.publicUrl
        }
      }

      const { error } = await supabase.from('merma').insert({
        ingrediente_nombre: ingrediente.trim(),
        cantidad: cant, unidad, motivo,
        cajero_nombre: cajeroNombre,
        notas: notas.trim() || null,
        ...(foto_url ? { foto_url } : {}),
      })
      if (error) { toast.error('Error al registrar merma'); return }
      setOk(true)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = setTimeout(onClose, 2000)
    } catch {
      toast.error('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="w-full max-w-sm animate-slide-up" style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #ef4444', borderRadius: 2 }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-black text-base uppercase tracking-widest" style={{ color: '#ef4444' }}>🗑 Registrar Merma</h3>
          <button onClick={onClose} className="text-base font-black" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        {ok ? (
          <div className="px-5 py-8 text-center">
            <div className="text-4xl mb-3">✓</div>
            <p className="font-black uppercase tracking-widest text-sm" style={{ color: '#22c55e' }}>Merma registrada</p>
          </div>
        ) : (
          <form onSubmit={guardar} className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Ingrediente / Producto</label>
              <input value={ingrediente} onChange={e => setIngrediente(e.target.value)} placeholder="Café, leche, azúcar..." required
                className="w-full px-3 py-2 text-sm font-bold" style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 2 }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Cantidad</label>
                <input type="number" min="0.01" step="0.01" value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="0" required
                  className="w-full px-3 py-2 text-sm font-bold" style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 2 }} />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Unidad</label>
                <select value={unidad} onChange={e => setUnidad(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold" style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 2 }}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Motivo</label>
              <div className="grid grid-cols-1 gap-1">
                {MOTIVOS.map(m => (
                  <button key={m.id} type="button" onClick={() => setMotivo(m.id)}
                    className="text-left px-3 py-2 text-xs font-black uppercase tracking-wide transition-all"
                    style={{ background: motivo === m.id ? 'rgba(239,68,68,0.15)' : 'var(--dark)', border: `1px solid ${motivo === m.id ? '#ef4444' : 'var(--border)'}`, color: motivo === m.id ? '#ef4444' : 'var(--muted)', borderRadius: 2, cursor: 'pointer' }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Foto (opcional)</label>
              <label
                className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-all"
                style={{ background: 'var(--dark)', border: `1px solid ${foto ? '#22c55e' : 'var(--border)'}`, borderRadius: 2 }}
              >
                <span className="text-base">{foto ? '✓' : '📷'}</span>
                <span className="text-xs font-bold" style={{ color: foto ? '#22c55e' : 'var(--muted)' }}>
                  {foto ? foto.name : 'Tomar foto o seleccionar...'}
                </span>
                <input type="file" accept="image/*" capture="environment" onChange={onFotoChange} className="hidden" />
              </label>
              {fotoPreview && (
                <div className="mt-2 relative">
                  <img src={fotoPreview} alt="preview" className="w-full object-cover" style={{ maxHeight: 120, border: '1px solid var(--border)' }} />
                  <button type="button" onClick={() => { setFoto(null); setFotoPreview(null) }}
                    className="absolute top-1 right-1 text-xs font-black px-1.5 py-0.5"
                    style={{ background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Notas (opcional)</label>
              <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Detalles adicionales..."
                className="w-full px-3 py-2 text-sm font-bold" style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 2 }} />
            </div>
            <button type="submit" disabled={guardando} className="w-full py-3 font-black text-sm uppercase tracking-widest transition-all"
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 2, cursor: guardando ? 'not-allowed' : 'pointer', opacity: guardando ? 0.7 : 1 }}>
              {guardando ? 'Guardando...' : '🗑 Registrar Merma'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
