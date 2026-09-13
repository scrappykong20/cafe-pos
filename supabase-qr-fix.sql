-- ============================================================
-- FIX QR CANJE — El Café del Constructor
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- Problemas que resuelve:
--   1. "Es para acumular engranajes" al escanear QR de canje
--   2. Engranajes = 0 al escanear QR de cliente
--   3. POS no puede leer tokens_qr ni recompensas
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. RLS: Permitir al POS leer tokens_qr y recompensas
-- ──────────────────────────────────────────────────────────────

-- tokens_qr — el POS necesita leer y actualizar tokens al canjear
DROP POLICY IF EXISTS "pos_all_tokens_qr" ON public.tokens_qr;
CREATE POLICY "pos_all_tokens_qr" ON public.tokens_qr
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- recompensas — el POS necesita leer el catálogo
DROP POLICY IF EXISTS "pos_all_recompensas" ON public.recompensas;
CREATE POLICY "pos_all_recompensas" ON public.recompensas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 2. Verificar estructura de tokens_qr
-- ──────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tokens_qr'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ──────────────────────────────────────────────────────────────
-- 3. Reparar función preview_qr_token (SECURITY DEFINER)
--    Funciona con reward_ids como JSONB array o UUID[]
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_qr_token(p_token_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token      RECORD;
  v_usuario    RECORD;
  v_rewards    JSONB := '[]'::JSONB;
  v_total_cost INTEGER := 0;
  v_reward_ids UUID[];
BEGIN
  -- Buscar el token (no expirado y no usado)
  SELECT * INTO v_token
  FROM tokens_qr
  WHERE id = p_token_id
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (usado IS NULL OR usado = false)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Token no encontrado, expirado o ya usado');
  END IF;

  -- Buscar usuario
  SELECT id, nombre, last_name, correo, telefono, engranajes, nivel, racha_dias,
         ultima_visita, cumple_anio, fecha_nac, es_empleado
  INTO v_usuario
  FROM usuarios
  WHERE id = v_token.usuario_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;

  -- Obtener reward_ids del token (soporta JSONB array y UUID[])
  BEGIN
    IF v_token.reward_ids IS NOT NULL THEN
      -- Intentar como JSONB array de UUIDs
      SELECT array_agg(r::UUID)
      INTO v_reward_ids
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(v_token.reward_ids) = 'array' THEN v_token.reward_ids
          ELSE to_jsonb(v_token.reward_ids)
        END
      ) r;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_reward_ids := NULL;
  END;

  -- Si tiene reward_ids, traer las recompensas
  IF v_reward_ids IS NOT NULL AND array_length(v_reward_ids, 1) > 0 THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',     r.id,
        'nombre', r.nombre,
        'emoji',  r.emoji,
        'costo',  r.costo
      )
    ), COALESCE(SUM(r.costo), 0)
    INTO v_rewards, v_total_cost
    FROM recompensas r
    WHERE r.id = ANY(v_reward_ids);

    IF v_rewards IS NULL THEN v_rewards := '[]'::JSONB; END IF;
  END IF;

  -- Si tipo = 'recompensa' y no se encontraron rewards por reward_ids,
  -- intentar buscar por token_reward_ids (columna alternativa)
  IF (v_token.tipo = 'recompensa' OR v_total_cost > 0) AND jsonb_array_length(v_rewards) = 0 THEN
    -- Intentar columna alternativa p_reward_ids
    BEGIN
      SELECT jsonb_agg(
        jsonb_build_object('id', r.id, 'nombre', r.nombre, 'emoji', r.emoji, 'costo', r.costo)
      ), COALESCE(SUM(r.costo), 0)
      INTO v_rewards, v_total_cost
      FROM recompensas r
      WHERE r.id = ANY(
        SELECT (elem::TEXT)::UUID
        FROM jsonb_array_elements_text(
          COALESCE(v_token.reward_ids, '[]'::JSONB)
        ) elem
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'token_id',   p_token_id,
    'tipo',       COALESCE(v_token.tipo, 'engranaje'),
    'usuario', jsonb_build_object(
      'id',        v_usuario.id,
      'nombre',    v_usuario.nombre,
      'last_name', v_usuario.last_name,
      'correo',    v_usuario.correo
    ),
    'engranajes',  COALESCE(v_usuario.engranajes, 0),
    'rewards',     COALESCE(v_rewards, '[]'::JSONB),
    'total_costo', COALESCE(v_total_cost, 0)
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. Reparar función process_qr_redemption (SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_qr_redemption(p_token_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_preview    JSONB;
  v_usuario_id UUID;
  v_total_cost INTEGER;
  v_engranajes INTEGER;
  v_nuevo_saldo INTEGER;
BEGIN
  -- Obtener preview del token
  v_preview := public.preview_qr_token(p_token_id);

  IF v_preview ? 'error' THEN
    RETURN v_preview;
  END IF;

  v_usuario_id := (v_preview->'usuario'->>'id')::UUID;
  v_total_cost := (v_preview->>'total_costo')::INTEGER;
  v_engranajes := (v_preview->>'engranajes')::INTEGER;

  IF v_total_cost <= 0 THEN
    RETURN jsonb_build_object('error', 'Este token no es de canje de recompensa');
  END IF;

  IF v_engranajes < v_total_cost THEN
    RETURN jsonb_build_object('error', 'Engranajes insuficientes');
  END IF;

  v_nuevo_saldo := v_engranajes - v_total_cost;

  -- Descontar engranajes
  UPDATE usuarios
  SET engranajes = v_nuevo_saldo
  WHERE id = v_usuario_id;

  -- Registrar en historial
  INSERT INTO historial (usuario_id, tipo, titulo, engranajes)
  VALUES (v_usuario_id, 'canje', 'Canje de recompensa', -v_total_cost);

  -- Marcar token como usado
  UPDATE tokens_qr
  SET usado = true
  WHERE id = p_token_id;

  RETURN jsonb_build_object(
    'exito',        true,
    'usuario',      v_preview->'usuario',
    'rewards',      v_preview->'rewards',
    'total_costo',  v_total_cost,
    'antes',        v_engranajes,
    'despues',      v_nuevo_saldo
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. Dar permisos de ejecución a usuarios autenticados
-- ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.preview_qr_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_qr_token(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.process_qr_redemption(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ──────────────────────────────────────────────────────────────
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('preview_qr_token', 'process_qr_redemption', 'create_qr_token');
