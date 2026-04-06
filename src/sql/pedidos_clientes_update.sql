-- 1. Añadir campos adicionales a la tabla clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ci text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ciudad text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sucursal text;

-- 2. Asegurar que nombre sea opcional (quitar NOT NULL si existe)
ALTER TABLE clientes ALTER COLUMN nombre DROP NOT NULL;

-- 3. Añadir campo de descuento a cliente_items
ALTER TABLE cliente_items ADD COLUMN IF NOT EXISTS descuento numeric DEFAULT 0;
