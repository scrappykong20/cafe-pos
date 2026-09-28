/**
 * AI Error Recovery — usa Claude API para analizar errores del POS
 * y aplicar correcciones automáticas sin interrumpir al cajero.
 *
 * Flujo:
 *  1. logger.ts llama recuperarError() en cada error
 *  2. Se consulta el caché (mismo error → misma acción por 5 min)
 *  3. Si no está en caché, Claude (Haiku) analiza y devuelve una acción JSON
 *  4. Se ejecuta la acción automáticamente
 *  5. Se registra la recuperación en logs_pos
 */

import Anthropic from '@anthropic-ai/sdk'
import toast from 'react-hot-toast'
import { syncOfflineQueue, getPendingCount, clearSynced } from './offlineQueue'
import { cancelarIntentoAtascado, liberarTerminal } from './mercadopago'
import { supabase } from '../supabase'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AccionTipo =
  | 'retry_print'        // Reintentar conexión al servidor de impresión
  | 'sync_offline'       // Forzar sincronización de cola offline
  | 'release_terminal'   // Liberar terminal MercadoPago (STANDALONE → PDV)
  | 'cancel_mp_intent'   // Cancelar intent MercadoPago atascado
  | 'reconnect_supabase' // Refrescar sesión / reconexión Supabase
  | 'clear_synced_queue' // Limpiar ventas ya sincronizadas del localStorage
  | 'notify_user'        // Mostrar aviso al cajero
  | 'ignore'             // Error ignorable, no hacer nada

export interface RecoveryAction {
  accion: AccionTipo
  mensaje?: string  // Texto para el cajero (≤ 80 chars)
  delay?: number    // ms de espera antes de ejecutar
}

// ─── Caché de errores ─────────────────────────────────────────────────────────
// Evita llamar a Claude varias veces por el mismo error en menos de 5 minutos.

const CACHE_TTL_MS = 5 * 60 * 1000
const errorCache = new Map<string, { ts: number; action: RecoveryAction }>()

// ─── Prompt del sistema (se cachea en Anthropic) ──────────────────────────────

const SYSTEM_PROMPT = `Eres el sistema de recuperación automática de errores de un POS (Point of Sale) para una cafetería mexicana.

ARQUITECTURA:
- POS: React 18 + Electron 43 en Windows 10 Pro
- Base de datos: Supabase (PostgreSQL) con RLS
- Pagos: MercadoPago Point Smart — terminal física NEWLAND N950 en modo PDV
- Impresoras: ESC/POS vía servidor HTTP local en puerto 3002 (Node.js + winspool.drv)
- Offline: cola de ventas en localStorage → sincroniza al volver conexión

MÓDULOS QUE GENERAN ERRORES:
- "impresora": servidor de impresión, ESC/POS, impresoras USB/red (IP:9100)
- "mercadopago" / "MP": terminal física, intents de pago, polling estado
- "offline-sync": sincronización de ventas offline
- "global": errores JavaScript no manejados (unhandledrejection, error)
- "supabase" / "auth": base de datos, autenticación, RLS
- "login": PIN de empleado, sesión

ACCIONES DISPONIBLES — elige exactamente UNA:
- retry_print: Reintenta conexión al servidor de impresión. Usa cuando: "No se pudo conectar al servidor de impresión", "fetch failed" en módulo impresora.
- sync_offline: Fuerza sincronización de ventas pendientes en cola offline. Usa cuando: error al sincronizar, ventas offline atascadas, "Error insertando items".
- release_terminal: Libera terminal MercadoPago (STANDALONE → PDV) para desatascar. Usa cuando: terminal sin responder, pago que no avanza del estado OPEN/ON_TERMINAL.
- cancel_mp_intent: Cancela el último intent de pago guardado en localStorage. Usa cuando: intent duplicado, "ya existe un pago en proceso".
- reconnect_supabase: Refresca sesión de Supabase. Usa cuando: errores 401/403 de Supabase, "JWT expired", sesión caducada.
- clear_synced_queue: Limpia ventas ya sincronizadas del localStorage para liberar espacio. Usa cuando: localStorage lleno, cola muy grande (> 50 ventas synced).
- notify_user: Solo muestra mensaje informativo al cajero. Usa cuando: el cajero debe actuar manualmente (revisar impresora física, llamar a soporte).
- ignore: No hacer nada. Usa cuando: error de baja severidad, ya manejado internamente, falso positivo, error de UI no crítico.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "accion": "<una de las 8 acciones>",
  "mensaje": "<frase corta en español para el cajero, máx 80 chars — omitir si 'ignore'>",
  "delay": <ms de espera opcional, omitir si no aplica>
}

Criterios: prioriza acciones automáticas que no interrumpan al cajero. Usa notify_user solo cuando la acción requiere intervención humana. Usa ignore para errores menores o ya recuperados.`

// ─── Análisis con IA ──────────────────────────────────────────────────────────

async function analizarConIA(
  modulo: string,
  mensaje: string,
  detalle?: Record<string, unknown>,
): Promise<RecoveryAction> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
  if (!apiKey) return { accion: 'ignore' }

  try {
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true, // App Electron local — no es browser público
    })

    const contexto = JSON.stringify(
      { modulo, mensaje: mensaje.slice(0, 300), detalle: detalle ?? null },
      null,
      2,
    )

    // Haiku 4.5: rápido y económico, ideal para clasificación de errores en tiempo real
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, // System prompt estático → se cachea
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Error del POS:\n\`\`\`json\n${contexto}\n\`\`\`\n¿Qué acción tomar?`,
        },
      ],
    })

    const texto = response.content.find(b => b.type === 'text')?.text ?? ''

    // Extraer JSON de la respuesta
    const jsonMatch = texto.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return { accion: 'ignore' }

    const parsed = JSON.parse(jsonMatch[0]) as RecoveryAction

    // Validar que la acción sea una de las permitidas
    const accionesValidas: AccionTipo[] = [
      'retry_print', 'sync_offline', 'release_terminal', 'cancel_mp_intent',
      'reconnect_supabase', 'clear_synced_queue', 'notify_user', 'ignore',
    ]
    if (!accionesValidas.includes(parsed.accion)) return { accion: 'ignore' }

    return parsed
  } catch {
    // Si la IA falla, no romper el POS — simplemente ignorar
    return { accion: 'ignore' }
  }
}

// ─── Ejecución de acciones ────────────────────────────────────────────────────

async function ejecutarAccion(action: RecoveryAction): Promise<void> {
  if (action.accion === 'ignore') return

  // Espera opcional antes de ejecutar
  if (action.delay && action.delay > 0) {
    await new Promise(r => setTimeout(r, action.delay))
  }

  switch (action.accion) {

    case 'retry_print': {
      // El servidor de impresión se reconecta en el siguiente intento de impresión.
      // Aquí notificamos al cajero para que reintente si es necesario.
      if (action.mensaje) {
        toast(action.mensaje, { icon: '🖨️', duration: 4000 })
      }
      break
    }

    case 'sync_offline': {
      const pending = getPendingCount()
      if (pending > 0) {
        const toastId = toast.loading(`Recuperando ${pending} venta(s) offline...`)
        try {
          const synced = await syncOfflineQueue()
          if (synced > 0) {
            toast.success(`${synced} venta(s) sincronizada(s) ✓`, { id: toastId, duration: 4000 })
            clearSynced()
          } else {
            toast.dismiss(toastId)
          }
        } catch {
          toast.error('Reintento de sync fallido — se intentará de nuevo', { id: toastId, duration: 3000 })
        }
      }
      break
    }

    case 'release_terminal': {
      const toastId = toast.loading('Liberando terminal de pago...')
      try {
        await liberarTerminal()
        toast.success('Terminal liberada — puede intentar el pago de nuevo', { id: toastId, duration: 4000 })
      } catch {
        toast.error('No se pudo liberar la terminal automáticamente', { id: toastId, duration: 4000 })
      }
      break
    }

    case 'cancel_mp_intent': {
      try {
        await cancelarIntentoAtascado()
        if (action.mensaje) {
          toast(action.mensaje, { icon: '💳', duration: 3000 })
        }
      } catch {
        // Silently fail — el usuario no debe ver este error
      }
      break
    }

    case 'reconnect_supabase': {
      try {
        await supabase.auth.refreshSession()
        if (action.mensaje) {
          toast(action.mensaje, { icon: '🔄', duration: 3000 })
        }
      } catch {
        // Si falla el refresh, el usuario tendrá que reloguear manualmente
      }
      break
    }

    case 'clear_synced_queue': {
      clearSynced()
      if (action.mensaje) {
        toast(action.mensaje, { icon: '🗑️', duration: 2000 })
      }
      break
    }

    case 'notify_user': {
      if (action.mensaje) {
        toast(action.mensaje, {
          icon: '⚠️',
          duration: 6000,
          style: { maxWidth: '380px' },
        })
      }
      break
    }

  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Analiza un error con IA y aplica la corrección automáticamente.
 *
 * - Usa caché: mismo error → misma acción por 5 minutos (sin llamar Claude de nuevo)
 * - No lanza excepciones — si algo falla, simplemente no hace nada
 * - Logs de la recuperación van a logs_pos bajo módulo "ai-recovery"
 */
export async function recuperarError(
  modulo: string,
  mensaje: string,
  detalle?: Record<string, unknown>,
): Promise<void> {
  // No recuperar errores del propio módulo de recuperación (evitar recursión)
  if (modulo === 'ai-recovery') return

  try {
    const cacheKey = `${modulo}:${mensaje.slice(0, 60)}`
    const cached = errorCache.get(cacheKey)

    let action: RecoveryAction

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      // Reusar acción cacheada — no llamar Claude de nuevo
      action = cached.action
    } else {
      // Consultar a Claude
      action = await analizarConIA(modulo, mensaje, detalle)
      errorCache.set(cacheKey, { ts: Date.now(), action })
    }

    // Ejecutar la acción (async, no bloqueante para el flujo principal)
    await ejecutarAccion(action)

    // Registrar la recuperación (solo si hizo algo útil)
    if (action.accion !== 'ignore') {
      void supabase.from('logs_pos').insert({
        pc_nombre: localStorage.getItem('pos_pc_nombre') ?? 'PC-desconocida',
        nivel: 'info',
        modulo: 'ai-recovery',
        mensaje: `Auto-fix aplicado: ${action.accion}`,
        detalle: {
          modulo_origen: modulo,
          error_original: mensaje.slice(0, 200),
          accion: action.accion,
          mensaje_usuario: action.mensaje ?? null,
        },
      })
    }
  } catch {
    // Si la recuperación falla completamente, no romper nada
  }
}
