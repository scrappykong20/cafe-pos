-- ============================================================
-- CONTROL DE TARDANZAS — El Café del Constructor
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Agregar columnas de horario a la tabla personal
ALTER TABLE personal
  ADD COLUMN IF NOT EXISTS hora_entrada_esperada TIME,
  ADD COLUMN IF NOT EXISTS tolerancia_minutos    INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS descuento_tardanza    NUMERIC  DEFAULT 50;

-- 2. Crear tabla de tardanzas
CREATE TABLE IF NOT EXISTS tardanzas (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  personal_id      UUID         REFERENCES personal(id) ON DELETE SET NULL,
  personal_nombre  TEXT         NOT NULL,
  fecha            DATE         NOT NULL DEFAULT CURRENT_DATE,
  hora_esperada    TEXT         NOT NULL,   -- 'HH:MM'
  hora_real        TEXT         NOT NULL,   -- 'HH:MM'
  minutos_tarde    INTEGER      NOT NULL DEFAULT 0,
  descuento        NUMERIC      NOT NULL DEFAULT 0,
  turno            TEXT,
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- 3. RLS
ALTER TABLE tardanzas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_all_tardanzas" ON tardanzas;
CREATE POLICY "pos_all_tardanzas" ON tardanzas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pos_all_personal_horario" ON personal;
CREATE POLICY "pos_all_personal_horario" ON personal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Índice para búsquedas por fecha
CREATE INDEX IF NOT EXISTS tardanzas_fecha_idx ON tardanzas (fecha);
CREATE INDEX IF NOT EXISTS tardanzas_personal_id_idx ON tardanzas (personal_id);

-- 5. Verificación
SELECT 'Columnas personal:' AS info;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'personal' AND table_schema = 'public'
  AND column_name IN ('hora_entrada_esperada','tolerancia_minutos','descuento_tardanza');

SELECT 'Tabla tardanzas:' AS info;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tardanzas' AND table_schema = 'public'
ORDER BY ordinal_position;
