-- Script para añadir el nivel de precio N2 al Catálogo Maestro
-- Ejecuta este script en el SQL Editor de Supabase (Dashboard)

ALTER TABLE catalogo_productos 
ADD COLUMN IF NOT EXISTS precio_n2_bs NUMERIC;

COMMENT ON COLUMN catalogo_productos.precio_n2_bs IS 'Precio intermedio N2 (-10% del Retail)';
