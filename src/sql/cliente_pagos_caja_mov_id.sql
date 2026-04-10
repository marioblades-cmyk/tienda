-- Agregar columna caja_mov_id a cliente_pagos
-- Permite sincronizar la eliminación de un abono con caja_movimientos
ALTER TABLE cliente_pagos
    ADD COLUMN IF NOT EXISTS caja_mov_id UUID REFERENCES caja_movimientos(id) ON DELETE SET NULL;
