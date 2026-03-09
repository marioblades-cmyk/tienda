-- ESQUEMA DE BASE DE DATOS PARA BASE MASTER (CONFIRMACIONES)

-- 1. Tabla Principal de Confirmaciones Históricas
CREATE TABLE IF NOT EXISTS master_confirmaciones (
  id SERIAL PRIMARY KEY,
  semana_id INTEGER REFERENCES semanas(id) ON DELETE CASCADE,
  titulo_despacho TEXT NOT NULL,
  total_ars NUMERIC DEFAULT 0,
  datos_json JSONB NOT NULL, -- Array con {titulo, precio, cant, total}
  fecha_subida TIMESTAMPTZ DEFAULT NOW(),
  -- Evitar que una semana tenga múltiples bases maestras (opcional, pero recomendado)
  CONSTRAINT unique_semana_master UNIQUE (semana_id)
);

-- 2. Políticas de Seguridad (RLS)
ALTER TABLE master_confirmaciones ENABLE ROW LEVEL SECURITY;
-- Permitir acceso a autenticados (Idealmente solo admin, simplificado por ahora)
CREATE POLICY "Permitir todo a autenticados en confirmaciones" 
  ON master_confirmaciones FOR ALL USING (auth.role() = 'authenticated');
