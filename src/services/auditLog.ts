import { supabase } from '../supabase'

/**
 * D3 — Audit Log
 * Inserta una acción en la tabla `audit_log`.
 * Si hay error, solo hace console.warn — nunca lanza excepción.
 */
export async function registrarAccion(
  accion: string,
  detalle: Record<string, unknown>,
  usuarioNombre?: string,
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      accion,
      detalle,
      usuario_nombre: usuarioNombre ?? 'Sistema',
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[auditLog] Error al registrar acción:', accion, err)
  }
}
