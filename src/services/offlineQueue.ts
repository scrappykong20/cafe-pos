/**
 * Cola offline para ventas que no pudieron sincronizarse con Supabase.
 * Usa localStorage para persistir entre recargas.
 */

import { supabase } from '../supabase'

const QUEUE_KEY = 'pos_offline_queue'

export interface CartItemOffline {
  menu_id: string
  producto_id?: string
  nombre: string
  emoji: string
  precio: number
  cantidad: number
  notas?: string
}

export interface VentaOffline {
  id: string                    // UUID local
  timestamp: string
  cajero_id: string
  cajero_nombre: string
  mesa_nombre: string
  orden_id: string | null
  metodo_pago: 'efectivo' | 'tarjeta' | 'mixto'
  subtotal: number
  descuento: number
  total: number
  efectivo_recibido: number | null
  cambio: number | null
  propina: number
  engranajes_ganados: number
  usuario_id: string | null
  rfc_cliente?: string
  items: CartItemOffline[]
  synced: boolean
  // BUG 3: ID de la venta ya insertada en BD (para reintentar solo los items sin duplicar la venta)
  venta_id_bd?: string
}

function getQueue(): VentaOffline[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveQueue(queue: VentaOffline[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // localStorage lleno — nada que hacer
  }
}

export function addToQueue(venta: Omit<VentaOffline, 'id' | 'timestamp' | 'synced'>) {
  const queue = getQueue()
  queue.push({
    ...venta,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    synced: false,
  })
  saveQueue(queue)
}

export function getPendingCount(): number {
  return getQueue().filter(v => !v.synced).length
}

export function getPending(): VentaOffline[] {
  return getQueue().filter(v => !v.synced)
}

/**
 * Intenta sincronizar todas las ventas pendientes con Supabase.
 * Retorna cuántas se sincronizaron con éxito.
 */
export async function syncOfflineQueue(): Promise<number> {
  const queue = getQueue()
  const pending = queue.filter(v => !v.synced)
  if (pending.length === 0) return 0

  let syncCount = 0

  for (const venta of pending) {
    try {
      // BUG 3: Si la venta ya fue insertada en BD (guardamos su ID), saltar directo a insertar items
      let ventaIdBd: string | undefined = venta.venta_id_bd

      if (!ventaIdBd) {
        // 1. Insertar venta
        const ventaPayload: Record<string, unknown> = {
          mesa_nombre:      venta.mesa_nombre,
          cajero_id:        venta.cajero_id,
          cajero_nombre:    venta.cajero_nombre,
          usuario_id:       venta.usuario_id,
          subtotal:         venta.subtotal,
          descuento:        venta.descuento,
          total:            venta.total,
          metodo_pago:      venta.metodo_pago,
          efectivo_recibido: venta.efectivo_recibido,
          cambio:           venta.cambio,
          engranajes_ganados: venta.engranajes_ganados,
          estado:           'completada',
          created_at:       venta.timestamp,  // Preservar timestamp real
        }
        if (venta.propina > 0)      ventaPayload.propina    = venta.propina
        if (venta.orden_id)         ventaPayload.orden_id   = venta.orden_id
        if (venta.rfc_cliente)      ventaPayload.rfc_cliente = venta.rfc_cliente

        const { data: ventaData, error: ventaErr } = await supabase
          .from('ventas')
          .insert(ventaPayload)
          .select('id')
          .single()

        if (ventaErr || !ventaData) continue
        ventaIdBd = ventaData.id
        // Guardar el ID de BD para que si falla el siguiente paso no se duplique la venta
        venta.venta_id_bd = ventaIdBd
        saveQueue(queue)
      }

      // 2. Insertar items — si falla, NO marcar synced y reintentar después (sin duplicar la venta)
      const items = venta.items.map(i => ({
        venta_id: ventaIdBd,
        menu_id:  i.producto_id ?? i.menu_id?.split('__')[0] ?? i.menu_id,
        nombre:   i.nombre,
        emoji:    i.emoji,
        precio:   i.precio,
        cantidad: i.cantidad,
        subtotal: parseFloat((i.precio * i.cantidad).toFixed(2)),
      }))
      const { error: itemsErr } = await supabase.from('venta_items').insert(items)
      if (itemsErr) {
        console.error('[offline-sync] Error insertando items de venta', ventaIdBd, itemsErr.message)
        // BUG 3: NO marcar synced — en el próximo intento usará venta_id_bd para no duplicar la venta
        continue
      }

      // 3. Si había orden activa, marcarla pagada
      if (venta.orden_id) {
        await supabase.from('ordenes')
          .update({ estado: 'pagada', cerrada_at: venta.timestamp })
          .eq('id', venta.orden_id)
        await supabase.from('mesas')
          .update({ estado: 'libre', orden_id: null })
          .eq('orden_id', venta.orden_id)
      }

      // 3b. Descontar inventario (receta si existe, fallback directo)
      for (const item of venta.items) {
        const realMenuId = item.producto_id ?? item.menu_id?.split('__')[0] ?? item.menu_id
        const { data: recetaItems } = await supabase
          .from('recetas')
          .select('cantidad_por_unidad, inventario_id, inventario:inventario_id(id, stock_actual)')
          .eq('menu_id', realMenuId)
        if (recetaItems && recetaItems.length > 0) {
          for (const receta of recetaItems) {
            const inv = receta.inventario as unknown as { id: string; stock_actual: number | null } | null
            if (!inv) continue
            const cantDescuento = (receta.cantidad_por_unidad as number) * item.cantidad
            const nuevoStock = Math.max(0, (inv.stock_actual ?? 0) - cantDescuento)
            await supabase.from('inventario').update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() }).eq('id', inv.id)
            void supabase.from('historial_inventario').insert({
              inventario_id: inv.id, menu_id: realMenuId, tipo: 'venta',
              cantidad: -cantDescuento,
              nota: `Venta offline sincronizada — ${item.nombre} ×${item.cantidad}`,
              referencia_id: ventaIdBd,
            })
          }
        } else {
          const { data: inv } = await supabase
            .from('inventario').select('id, stock_actual').eq('menu_id', realMenuId).maybeSingle()
          if (inv) {
            const nuevoStock = Math.max(0, (inv.stock_actual ?? 0) - item.cantidad)
            await supabase.from('inventario').update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() }).eq('id', inv.id)
            void supabase.from('historial_inventario').insert({
              inventario_id: inv.id, menu_id: realMenuId, tipo: 'venta',
              cantidad: -item.cantidad,
              nota: `Venta offline sincronizada — ${item.nombre}`,
              referencia_id: ventaIdBd,
            })
          }
        }
      }

      // 4. Actualizar engranajes del cliente si aplica
      if (venta.usuario_id && venta.engranajes_ganados > 0) {
        const { data: ud } = await supabase
          .from('usuarios')
          .select('engranajes, engranajes_acumulados')
          .eq('id', venta.usuario_id)
          .single()
        if (ud) {
          await supabase.from('usuarios').update({
            engranajes:            (ud.engranajes ?? 0) + venta.engranajes_ganados,
            engranajes_acumulados: (ud.engranajes_acumulados ?? 0) + venta.engranajes_ganados,
          }).eq('id', venta.usuario_id)
          await supabase.from('historial').insert({
            usuario_id: venta.usuario_id,
            tipo: 'recarga',
            engranajes: venta.engranajes_ganados,
            titulo: `Venta offline sincronizada — ${venta.mesa_nombre}`,
          })
        }
      }

      // Marcar como sincronizada
      venta.synced = true
      syncCount++
    } catch {
      // Si falla, se reintentará en la próxima sincronización
    }
  }

  saveQueue(queue)
  return syncCount
}

export function clearSynced() {
  const queue = getQueue().filter(v => !v.synced)
  saveQueue(queue)
}
