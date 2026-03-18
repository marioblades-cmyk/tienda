-- SCHEMA PARA MÓDULO DE COTIZACIONES
-- Ejecutar en el SQL Editor de Supabase

CREATE TABLE IF NOT EXISTS cotizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_nombre TEXT,
  cliente_celular TEXT,
  nota TEXT,
  tipo_precio TEXT DEFAULT 'retail',  -- retail | n2 | n3 | mayoreo
  descuento_pct NUMERIC DEFAULT 0,
  costo_envio NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'borrador',     -- borrador | enviada | aceptada | rechazada
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para búsqueda rápida por usuario
CREATE INDEX IF NOT EXISTS idx_cotizaciones_usuario ON cotizaciones(usuario_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_cotizaciones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_cotizaciones_ts
    BEFORE UPDATE ON cotizaciones
    FOR EACH ROW
    EXECUTE FUNCTION update_cotizaciones_updated_at();

-- RLS: Solo el dueño puede ver y editar sus cotizaciones
ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios ven sus cotizaciones" ON cotizaciones;
CREATE POLICY "Usuarios ven sus cotizaciones" ON cotizaciones
  FOR ALL USING (auth.uid() = usuario_id);
