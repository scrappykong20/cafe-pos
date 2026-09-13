-- ============================================================
-- CAFE POS — FIX COMPLETO DE POLÍTICAS RLS
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- La app usa una cuenta de servicio (VITE_POS_EMAIL) que se
-- autentica como "authenticated". Todas las tablas del negocio
-- necesitan acceso total para este rol.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. CAJA Y FINANZAS
-- ──────────────────────────────────────────────────────────────

-- cortes_caja
DROP POLICY IF EXISTS "pos_all_cortes_caja" ON public.cortes_caja;
CREATE POLICY "pos_all_cortes_caja" ON public.cortes_caja
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- movimientos_caja
DROP POLICY IF EXISTS "pos_all_movimientos_caja" ON public.movimientos_caja;
CREATE POLICY "pos_all_movimientos_caja" ON public.movimientos_caja
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- gastos
DROP POLICY IF EXISTS "pos_all_gastos" ON public.gastos;
CREATE POLICY "pos_all_gastos" ON public.gastos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- gastos_recurrentes
DROP POLICY IF EXISTS "pos_all_gastos_recurrentes" ON public.gastos_recurrentes;
CREATE POLICY "pos_all_gastos_recurrentes" ON public.gastos_recurrentes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- adelantos
DROP POLICY IF EXISTS "pos_all_adelantos" ON public.adelantos;
CREATE POLICY "pos_all_adelantos" ON public.adelantos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- fiados
DROP POLICY IF EXISTS "pos_all_fiados" ON public.fiados;
CREATE POLICY "pos_all_fiados" ON public.fiados
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- fiados_movimientos
DROP POLICY IF EXISTS "pos_all_fiados_movimientos" ON public.fiados_movimientos;
CREATE POLICY "pos_all_fiados_movimientos" ON public.fiados_movimientos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 2. VENTAS Y ÓRDENES
-- ──────────────────────────────────────────────────────────────

-- ventas
DROP POLICY IF EXISTS "pos_all_ventas" ON public.ventas;
CREATE POLICY "pos_all_ventas" ON public.ventas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- venta_items
DROP POLICY IF EXISTS "pos_all_venta_items" ON public.venta_items;
CREATE POLICY "pos_all_venta_items" ON public.venta_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ordenes
DROP POLICY IF EXISTS "pos_all_ordenes" ON public.ordenes;
CREATE POLICY "pos_all_ordenes" ON public.ordenes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- orden_items
DROP POLICY IF EXISTS "pos_all_orden_items" ON public.orden_items;
CREATE POLICY "pos_all_orden_items" ON public.orden_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- devoluciones
DROP POLICY IF EXISTS "pos_all_devoluciones" ON public.devoluciones;
CREATE POLICY "pos_all_devoluciones" ON public.devoluciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- consumos_empleados
DROP POLICY IF EXISTS "pos_all_consumos_empleados" ON public.consumos_empleados;
CREATE POLICY "pos_all_consumos_empleados" ON public.consumos_empleados
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ordenes_compra
DROP POLICY IF EXISTS "pos_all_ordenes_compra" ON public.ordenes_compra;
CREATE POLICY "pos_all_ordenes_compra" ON public.ordenes_compra
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ordenes_compra_items
DROP POLICY IF EXISTS "pos_all_ordenes_compra_items" ON public.ordenes_compra_items;
CREATE POLICY "pos_all_ordenes_compra_items" ON public.ordenes_compra_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 3. MESAS Y RESERVACIONES
-- ──────────────────────────────────────────────────────────────

-- mesas
DROP POLICY IF EXISTS "pos_all_mesas" ON public.mesas;
CREATE POLICY "pos_all_mesas" ON public.mesas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- reservaciones
DROP POLICY IF EXISTS "pos_all_reservaciones" ON public.reservaciones;
CREATE POLICY "pos_all_reservaciones" ON public.reservaciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 4. MENÚ E INVENTARIO
-- ──────────────────────────────────────────────────────────────

-- menu
DROP POLICY IF EXISTS "pos_all_menu" ON public.menu;
CREATE POLICY "pos_all_menu" ON public.menu
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- inventario
DROP POLICY IF EXISTS "pos_all_inventario" ON public.inventario;
CREATE POLICY "pos_all_inventario" ON public.inventario
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- historial_inventario
DROP POLICY IF EXISTS "pos_all_historial_inventario" ON public.historial_inventario;
CREATE POLICY "pos_all_historial_inventario" ON public.historial_inventario
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- recetas
DROP POLICY IF EXISTS "pos_all_recetas" ON public.recetas;
CREATE POLICY "pos_all_recetas" ON public.recetas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- merma
DROP POLICY IF EXISTS "pos_all_merma" ON public.merma;
CREATE POLICY "pos_all_merma" ON public.merma
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- proveedores
DROP POLICY IF EXISTS "pos_all_proveedores" ON public.proveedores;
CREATE POLICY "pos_all_proveedores" ON public.proveedores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 5. MODIFICADORES
-- ──────────────────────────────────────────────────────────────

-- menu_modificadores
DROP POLICY IF EXISTS "pos_all_menu_modificadores" ON public.menu_modificadores;
CREATE POLICY "pos_all_menu_modificadores" ON public.menu_modificadores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- modificadores_grupo
DROP POLICY IF EXISTS "pos_all_modificadores_grupo" ON public.modificadores_grupo;
CREATE POLICY "pos_all_modificadores_grupo" ON public.modificadores_grupo
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- modificadores_opcion
DROP POLICY IF EXISTS "pos_all_modificadores_opcion" ON public.modificadores_opcion;
CREATE POLICY "pos_all_modificadores_opcion" ON public.modificadores_opcion
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 6. PERSONAL Y TURNOS
-- ──────────────────────────────────────────────────────────────

-- personal
DROP POLICY IF EXISTS "pos_all_personal" ON public.personal;
CREATE POLICY "pos_all_personal" ON public.personal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- turnos_personal
DROP POLICY IF EXISTS "pos_all_turnos_personal" ON public.turnos_personal;
CREATE POLICY "pos_all_turnos_personal" ON public.turnos_personal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 7. CLIENTES Y RECOMPENSAS
-- ──────────────────────────────────────────────────────────────

-- usuarios (clientes del programa de lealtad)
DROP POLICY IF EXISTS "pos_all_usuarios" ON public.usuarios;
CREATE POLICY "pos_all_usuarios" ON public.usuarios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- historial (puntos/engranajes)
DROP POLICY IF EXISTS "pos_all_historial" ON public.historial;
CREATE POLICY "pos_all_historial" ON public.historial
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- recompensas
DROP POLICY IF EXISTS "pos_all_recompensas" ON public.recompensas;
CREATE POLICY "pos_all_recompensas" ON public.recompensas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 8. PROMOCIONES Y CUPONES
-- ──────────────────────────────────────────────────────────────

-- cupones
DROP POLICY IF EXISTS "pos_all_cupones" ON public.cupones;
CREATE POLICY "pos_all_cupones" ON public.cupones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- promociones
DROP POLICY IF EXISTS "pos_all_promociones" ON public.promociones;
CREATE POLICY "pos_all_promociones" ON public.promociones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- happy_hours
DROP POLICY IF EXISTS "pos_all_happy_hours" ON public.happy_hours;
CREATE POLICY "pos_all_happy_hours" ON public.happy_hours
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 9. CONFIGURACIÓN Y AUDITORÍA
-- ──────────────────────────────────────────────────────────────

-- configuracion
DROP POLICY IF EXISTS "pos_all_configuracion" ON public.configuracion;
CREATE POLICY "pos_all_configuracion" ON public.configuracion
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- log_auditoria
DROP POLICY IF EXISTS "pos_all_log_auditoria" ON public.log_auditoria;
CREATE POLICY "pos_all_log_auditoria" ON public.log_auditoria
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- encuestas
DROP POLICY IF EXISTS "pos_all_encuestas" ON public.encuestas;
CREATE POLICY "pos_all_encuestas" ON public.encuestas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 10. STORAGE — Bucket merma-fotos
-- ──────────────────────────────────────────────────────────────

-- Política de SELECT (ver fotos)
DROP POLICY IF EXISTS "pos_select_merma_fotos" ON storage.objects;
CREATE POLICY "pos_select_merma_fotos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'merma-fotos');

-- Política de INSERT (subir fotos)
DROP POLICY IF EXISTS "pos_insert_merma_fotos" ON storage.objects;
CREATE POLICY "pos_insert_merma_fotos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'merma-fotos');

-- ──────────────────────────────────────────────────────────────
-- VERIFICACIÓN: Lista todas las políticas creadas
-- ──────────────────────────────────────────────────────────────
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE policyname LIKE 'pos_%'
ORDER BY tablename, cmd;
