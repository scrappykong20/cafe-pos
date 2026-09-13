export type Categoria = 'cafe' | 'bebida_fria' | 'panaderia' | 'alimento'

export interface MenuItem {
  id: string
  nombre: string
  descripcion: string
  emoji: string
  categoria: Categoria
  precio: number
  disponible: boolean
  destaque: boolean
  orden: number
}

export interface CartItem {
  menu_id: string
  producto_id?: string  // ID real del producto (sin notas concatenadas); se usa al guardar en venta_items
  nombre: string
  emoji: string
  precio: number
  cantidad: number
  notas?: string
}

export interface Mesa {
  id: string
  numero: number
  nombre: string
  capacidad: number
  estado: 'libre' | 'ocupada'
  orden_id: string | null
}

export interface OrdenItem {
  id: string
  orden_id: string
  menu_id: string | null
  nombre: string
  emoji: string
  precio: number
  cantidad: number
  notas: string | null
  created_at: string
}

export interface Orden {
  id: string
  mesa_id: string | null
  cajero_id: string
  cajero_nombre: string
  usuario_id: string | null
  estado: 'abierta' | 'pagada' | 'cancelada'
  notas: string | null
  created_at: string
  orden_items?: OrdenItem[]
}

export interface Cliente {
  id: string
  nombre: string
  last_name: string
  correo: string
  engranajes: number
}

export interface UsuarioPerfil {
  id: string
  nombre: string
  last_name: string
  correo?: string
  es_admin: boolean
  es_cajero: boolean
  turno?: 'mañana' | 'tarde'
}

export interface Venta {
  id: string
  orden_id: string | null
  mesa_nombre: string | null
  cajero_nombre: string
  usuario_id: string | null
  subtotal: number
  descuento: number
  total: number
  metodo_pago: 'efectivo' | 'tarjeta' | 'mixto'
  efectivo_recibido: number | null
  cambio: number | null
  engranajes_ganados: number
  estado: 'completada' | 'devuelta' | 'cancelada'
  created_at: string
}

export const CATEGORIAS: { key: Categoria | 'todas'; label: string; emoji: string }[] = [
  { key: 'todas', label: 'Todo', emoji: '🍽️' },
  { key: 'cafe', label: 'Cafés', emoji: '☕' },
  { key: 'bebida_fria', label: 'Frías', emoji: '🧊' },
  { key: 'panaderia', label: 'Panadería', emoji: '🥐' },
  { key: 'alimento', label: 'Alimentos', emoji: '🍳' },
]
