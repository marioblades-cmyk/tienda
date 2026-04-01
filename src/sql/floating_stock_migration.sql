-- MIGRACIÓN PARA GESTIÓN DE STOCK FLOTANTE Y RECEPCIÓN

-- 1. Añadir stock físico base al catálogo
ALTER TABLE catalogo_productos ADD COLUMN IF NOT EXISTS stock_fisico INTEGER DEFAULT 0;

-- 2. Añadir campos de seguimiento a las semanas
ALTER TABLE semanas ADD COLUMN IF NOT EXISTS fecha_estimada_llegada DATE;
ALTER TABLE semanas ADD COLUMN IF NOT EXISTS estado_recepcion TEXT DEFAULT 'pendiente';

-- 3. Crear tabla para registro de recepciones parciales/totales
-- Esto se vincula por título para facilitar la comparación con master_confirmaciones
CREATE TABLE IF NOT EXISTS pedido_items_recepcion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id UUID REFERENCES semanas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  ean TEXT,
  cantidad_recibida INTEGER DEFAULT 0,
  cantidad_faltante INTEGER DEFAULT 0,
  fecha_recepcion TIMESTAMPTZ DEFAULT NOW(),
  comentarios TEXT
);

-- 4. Habilitar RLS para la nueva tabla
ALTER TABLE pedido_items_recepcion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a autenticados en recepcion" 
  ON pedido_items_recepcion FOR ALL USING (auth.role() = 'authenticated');

-- 5. Trigger para autocalcular fecha estimada (NOW + 22 días) al insertar una semana
CREATE OR REPLACE FUNCTION set_default_arrival_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fecha_estimada_llegada IS NULL THEN
    NEW.fecha_estimada_llegada := (NEW.created_at + INTERVAL '22 days')::DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_arrival_date ON semanas;
CREATE TRIGGER trigger_set_arrival_date
BEFORE INSERT ON semanas
FOR EACH ROW EXECUTE FUNCTION set_default_arrival_date();

-- 6. Actualizar las semanas existentes con la lógica de los 22 días si no tienen fecha
UPDATE semanas SET fecha_estimada_llegada = (created_at + INTERVAL '22 days')::DATE 
WHERE fecha_estimada_llegada IS NULL;
