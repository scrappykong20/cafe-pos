/**
 * telegramBridge.ts — Canal de comandos remotos desde Telegram al POS
 *
 * Flujo:
 *  1. El dueño escribe en Telegram → Edge Function inserta en pos_comandos
 *  2. El POS escucha pos_comandos via Supabase Realtime
 *  3. El POS ejecuta la acción y responde al dueño via Telegram Bot API
 */

import toast from 'react-hot-toast'
import { supabase } from '../supabase'
import { listarImpresoras, getSlot, setSlot, imprimirPorTipo, crearTicket, limpiarColaImpresion, reiniciarPrintServer } from './printer'
import { syncOfflineQueue, getPendingCount, clearSynced } from './offlineQueue'
import { logger } from './logger'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PosComando {
  id: string
  chat_id: number
  mensaje_original: string
  accion: string
  parametros: Record<string, unknown> | null
  estado: string
}

// ─── Telegram API (respuesta desde el POS) ───────────────────────────────────

const BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined

async function tgResponder(chatId: number, texto: string) {
  if (!BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
      }),
    })
  } catch {
    // No interrumpir el POS si falla Telegram
  }
}

// ─── Marcar comando como completado/error ────────────────────────────────────

async function marcarComando(id: string, respuesta: string, ok: boolean) {
  await supabase.from('pos_comandos').update({
    estado: ok ? 'completado' : 'error',
    respuesta,
    procesado_at: new Date().toISOString(),
  }).eq('id', id)
}

// ─── Ejecución de comandos ───────────────────────────────────────────────────

async function ejecutarComando(cmd: PosComando): Promise<void> {
  // Marcar como "procesando" para evitar ejecución doble
  const { error: errUpdate } = await supabase
    .from('pos_comandos')
    .update({ estado: 'procesando' })
    .eq('id', cmd.id)
    .eq('estado', 'pendiente')

  if (errUpdate) return // Ya lo tomó otra instancia (o fue actualizado)

  let respuesta = ''
  let ok = true

  try {
    switch (cmd.accion) {

      // ── Mostrar aviso en pantalla ──────────────────────────────────────
      case 'aviso': {
        const msg = String(cmd.parametros?.mensaje ?? 'Mensaje del administrador')
        toast(msg, {
          icon: '📱',
          duration: 12000,
          style: { maxWidth: '400px', fontSize: '16px', fontWeight: 'bold' },
        })
        respuesta = `✅ Aviso mostrado en pantalla:\n"${msg}"`
        break
      }

      // ── Forzar sincronización offline ──────────────────────────────────
      case 'sync_offline': {
        const pending = getPendingCount()
        if (pending === 0) {
          respuesta = '✅ No hay ventas offline pendientes — todo sincronizado.'
        } else {
          const toastId = toast.loading(`Sincronizando ${pending} venta(s) offline...`)
          try {
            const synced = await syncOfflineQueue()
            if (synced > 0) {
              clearSynced()
              toast.success(`${synced} venta(s) sincronizada(s) ✓`, { id: toastId, duration: 4000 })
              respuesta = `✅ ${synced} venta(s) sincronizada(s) correctamente.`
            } else {
              toast.dismiss(toastId)
              respuesta = `⚠️ ${pending} ventas pendientes pero el servidor no las aceptó aún.`
            }
          } catch (err) {
            toast.error('Sync fallido — reintentando', { id: toastId })
            respuesta = `❌ Error al sincronizar: ${String(err).slice(0, 100)}`
            ok = false
          }
        }
        break
      }

      // ── Imprimir ticket de prueba ──────────────────────────────────────
      case 'impresora_prueba': {
        const data = crearTicket()
          .encabezado('EL CAFÉ DEL CONSTRUCTOR', 'PRUEBA REMOTA', {
            info: [
              'Prueba enviada desde Telegram',
              new Date().toLocaleString('es-MX'),
            ],
          })
          .sep()
          .centrar('Si ves este ticket,', false)
          .centrar('la impresora funciona ✓', false)
          .fin()

        const imprimio = await imprimirPorTipo('caja', data)
        if (imprimio) {
          toast.success('Imprimiendo ticket de prueba (Telegram)', { duration: 3000 })
          respuesta = '✅ Ticket de prueba impreso correctamente.'
        } else {
          respuesta = '❌ Error al imprimir — revisa que la impresora esté encendida y conectada.'
          ok = false
        }
        break
      }

      // ── Estado de impresoras ───────────────────────────────────────────
      case 'impresora_estado': {
        const slot1 = getSlot(1)
        const slot2 = getSlot(2)
        const instaladas = await listarImpresoras()

        const lineas = [`🖨️ <b>Impresoras configuradas</b>\n`]

        if (slot1.nombre || slot1.ip) {
          const ref = slot1.modo === 'red' ? `IP: ${slot1.ip}` : slot1.nombre
          const enWindows = instaladas.includes(slot1.nombre)
          lineas.push(`Slot 1 (${slot1.tipo}): ${ref} ${enWindows ? '✅' : '⚠️ no detectada'}`)
        } else {
          lineas.push('Slot 1: sin configurar')
        }

        if (slot2.nombre || slot2.ip) {
          const ref = slot2.modo === 'red' ? `IP: ${slot2.ip}` : slot2.nombre
          const enWindows = instaladas.includes(slot2.nombre)
          lineas.push(`Slot 2 (${slot2.tipo}): ${ref} ${enWindows ? '✅' : '⚠️ no detectada'}`)
        } else {
          lineas.push('Slot 2: sin configurar')
        }

        lineas.push(`\n📋 Instaladas en Windows: ${instaladas.length > 0 ? instaladas.join(', ') : 'ninguna detectada'}`)
        respuesta = lineas.join('\n')
        break
      }

      // ── Reiniciar app ──────────────────────────────────────────────────
      case 'reiniciar': {
        respuesta = '🔄 Reiniciando POS en 3 segundos...'
        toast('Reiniciando POS por orden del administrador...', { icon: '🔄', duration: 3000 })
        setTimeout(() => window.location.reload(), 3000)
        break
      }

      // ── Configurar impresora de un slot ───────────────────────────────
      case 'configurar_impresora': {
        const slot  = Number(cmd.parametros?.slot  ?? 1) as 1 | 2
        const tipo  = String(cmd.parametros?.tipo  ?? 'caja') as 'caja' | 'cocina'
        const nombre = String(cmd.parametros?.nombre ?? '')
        if (!nombre) {
          respuesta = '❌ Falta el nombre de la impresora.'
          ok = false
          break
        }
        setSlot(slot, { tipo, modo: 'cable', nombre, ip: '' })
        toast.success(`Impresora Slot ${slot} → "${nombre}"`, { duration: 5000 })
        respuesta = `✅ Slot ${slot} (${tipo}) configurado: "${nombre}"`
        break
      }

      // ── Limpiar cola de impresión ──────────────────────────────────────
      case 'limpiar_cola': {
        const impresora = String(cmd.parametros?.impresora ?? '')
        const colaOk = await limpiarColaImpresion(impresora || undefined)
        if (colaOk) {
          toast.success('Cola de impresión limpiada ✓', { duration: 4000 })
          respuesta = `✅ Cola de impresión ${impresora ? `"${impresora}"` : ''} limpiada.`
        } else {
          respuesta = '❌ No se pudo limpiar la cola de impresión.'
          ok = false
        }
        break
      }

      // ── Reiniciar servidor de impresión ───────────────────────────────
      case 'reiniciar_print_server': {
        const psOk = await reiniciarPrintServer()
        if (psOk) {
          toast.success('Servidor de impresión reiniciado ✓', { duration: 4000 })
          respuesta = '✅ Servidor de impresión reiniciado.'
        } else {
          respuesta = '❌ No se pudo reiniciar el servidor de impresión (¿corre en Electron?).'
        }
        break
      }

      default:
        respuesta = `❓ Acción desconocida: "${cmd.accion}"`
        ok = false
    }
  } catch (err) {
    respuesta = `❌ Error ejecutando "${cmd.accion}": ${String(err).slice(0, 150)}`
    ok = false
    void logger.error('telegram', `Error ejecutando comando remoto ${cmd.accion}`, { error: String(err) })
  }

  await tgResponder(cmd.chat_id, respuesta)
  await marcarComando(cmd.id, respuesta, ok)
}

// ─── Realtime subscription + polling fallback ────────────────────────────────

let channel: ReturnType<typeof supabase.channel> | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let realtimeOk = false

async function pollPendingCommands() {
  try {
    const { data } = await supabase
      .from('pos_comandos')
      .select('*')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(5)

    for (const cmd of data ?? []) {
      void ejecutarComando(cmd as PosComando)
    }
  } catch {
    // silencioso — no interrumpir el POS
  }
}

export function iniciarTelegramBridge() {
  if (!BOT_TOKEN) {
    void logger.warn('telegram', 'VITE_TELEGRAM_BOT_TOKEN no configurado — bridge inactivo')
    return
  }

  // ── Realtime (ideal) ──────────────────────────────────────────────────────
  channel = supabase
    .channel('pos-telegram-bridge')
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'pos_comandos',
      },
      (payload) => {
        realtimeOk = true
        const cmd = payload.new as PosComando
        if (cmd.estado === 'pendiente') {
          void ejecutarComando(cmd)
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        realtimeOk = true
        void logger.info('telegram', 'Bridge Telegram activo — escuchando comandos remotos')
      }
    })

  // ── Polling cada 6s — siempre activo como respaldo de Realtime ────────────
  pollInterval = setInterval(async () => {
    await pollPendingCommands()
  }, 6000)

  // Primer poll inmediato para comandos pendientes al arrancar
  void pollPendingCommands()
}

export function detenerTelegramBridge() {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  realtimeOk = false
}
