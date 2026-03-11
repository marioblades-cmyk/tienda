-- TABLAS PARA SINCRONIZACIÓN DE ANÁLISIS DE PRECIOS

-- 1. Configuraciones por Editorial (o 'GLOBAL_SETTINGS' para valores por defecto)
CREATE TABLE IF NOT EXISTS price_analysis_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial TEXT UNIQUE, 
  flete NUMERIC DEFAULT 6,
  tcf NUMERIC DEFAULT 0.014,
  tca NUMERIC DEFAULT 0.0068,
  margen_venta NUMERIC DEFAULT 0.40,
  margen_mayoreo NUMERIC DEFAULT 0.30,
  descuento_proveedor NUMERIC,
  dto_niveles JSONB DEFAULT '[5, 10, 15]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Agregar columna si la tabla ya existía sin ella (idempotente)
ALTER TABLE price_analysis_settings ADD COLUMN IF NOT EXISTS descuento_proveedor NUMERIC;

-- 2. Ajustes Manuales de Precios
CREATE TABLE IF NOT EXISTS price_analysis_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial TEXT NOT NULL,
  precio_ars NUMERIC NOT NULL,
  pv_ajuste NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(editorial, precio_ars)
);

-- 3. Histórico/Snapshots de Resultados (para consulta rápida)
CREATE TABLE IF NOT EXISTS price_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id UUID REFERENCES semanas(id) ON DELETE CASCADE,
  editorial TEXT NOT NULL,
  datos_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(semana_id, editorial)
);

-- Habilitar RLS
ALTER TABLE price_analysis_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_analysis_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_analysis_results ENABLE ROW LEVEL SECURITY;

-- Políticas (Idempotentes usando DROP IF EXISTS)
DO $$ 
BEGIN
    -- Settings
    DROP POLICY IF EXISTS "Permitir lectura a autenticados" ON price_analysis_settings;
    CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_settings FOR SELECT USING (auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "Permitir escritura a autenticados" ON price_analysis_settings;
    CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_settings FOR ALL USING (auth.role() = 'authenticated');

    -- Adjustments
    DROP POLICY IF EXISTS "Permitir lectura a autenticados" ON price_analysis_adjustments;
    CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_adjustments FOR SELECT USING (auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "Permitir escritura a autenticados" ON price_analysis_adjustments;
    CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_adjustments FOR ALL USING (auth.role() = 'authenticated');

    -- Results
    DROP POLICY IF EXISTS "Permitir lectura a autenticados" ON price_analysis_results;
    CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_results FOR SELECT USING (auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "Permitir escritura a autenticados" ON price_analysis_results;
    CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_results FOR ALL USING (auth.role() = 'authenticated');
END $$;
