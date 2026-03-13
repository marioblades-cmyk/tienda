-- Add reprint flag to catalogo_productos
ALTER TABLE catalogo_productos ADD COLUMN IF NOT EXISTS es_reimpresion BOOLEAN DEFAULT FALSE;

-- Optional: Comments for documentation
COMMENT ON COLUMN catalogo_productos.es_reimpresion IS 'Indica si el producto fue marcado como reimpresión en la última carga.';
