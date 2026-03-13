-- Actualización del Catálogo Maestro para incluir precios calculados en BS
-- Ejecuta este script en el SQL Editor de Supabase

ALTER TABLE catalogo_productos 
ADD COLUMN IF NOT EXISTS precio_venta_bs NUMERIC,
ADD COLUMN IF NOT EXISTS precio_n3_bs NUMERIC,
ADD COLUMN IF NOT EXISTS precio_mayoreo_bs NUMERIC;

-- Comentario para verificar las columnas
COMMENT ON COLUMN catalogo_productos.precio_venta_bs IS 'Precio de venta final calculado (G PV)';
COMMENT ON COLUMN catalogo_productos.precio_n3_bs IS 'Precio con descuento N3 (-15%)';
COMMENT ON COLUMN catalogo_productos.precio_mayoreo_bs IS 'Precio sugerido para mayoreo';
