-- Añadir la columna catalog_id a cliente_items para vinculación segura con el catálogo
ALTER TABLE cliente_items 
ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES catalogo_productos(id) ON DELETE SET NULL;

-- Comentario para documentar la relación
COMMENT ON COLUMN cliente_items.catalog_id IS 'Referencia UUID al registro exacto en catalogo_productos';
