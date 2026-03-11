-- TABLAS PARA SINCRONIZACIÓN DE ANÁLISIS DE PRECIOS

-- 1. Configuraciones por Editorial (o Globales si editorial es null)
CREATE TABLE IF NOT EXISTS price_analysis_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial TEXT UNIQUE, -- Se usa 'GLOBAL_SETTINGS' para la configuración por defecto
  flete NUMERIC DEFAULT 6,
  tcf NUMERIC DEFAULT 0.014,
  tca NUMERIC DEFAULT 0.0068,
  margen_venta NUMERIC DEFAULT 0.40,
  margen_mayoreo NUMERIC DEFAULT 0.30,
  dto_niveles JSONB DEFAULT '[5, 10, 15]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ajustes Manuales de Precios
CREATE TABLE IF NOT EXISTS price_analysis_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial TEXT NOT NULL,
  precio_ars NUMERIC NOT NULL,
  pv_ajuste NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(editorial, precio_ars)
);

-- 3. Histórico/Snapshots de Resultados (Opcional, para consulta rápida)
CREATE TABLE IF NOT EXISTS price_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id UUID REFERENCES semanas(id) ON DELETE CASCADE,
  editorial TEXT NOT NULL,
  datos_json JSONB NOT NULL, -- Array de objetos calculados
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Políticas de Seguridad (RLS)
ALTER TABLE price_analysis_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_analysis_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_settings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_settings FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_adjustments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_adjustments FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir lectura a autenticados" ON price_analysis_results FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir escritura a autenticados" ON price_analysis_results FOR ALL USING (auth.role() = 'authenticated');
