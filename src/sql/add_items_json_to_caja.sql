-- Añadir soporte para metadatos de productos vendidos en el flujo de caja
-- Esto permite revertir el stock automáticamente cuando se anula una venta
ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS items_json jsonb;
