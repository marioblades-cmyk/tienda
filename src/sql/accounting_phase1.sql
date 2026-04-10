-- ==========================================
-- FASE 1: SISTEMA CONTABLE UNIFICADO
-- Ejecutar en el editor SQL de Supabase
-- ==========================================

-- 1. Añadir metodo_pago y origen a caja_movimientos
ALTER TABLE caja_movimientos
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'Tienda';

-- 2. Añadir metodo_pago y referencia a cliente_pagos
ALTER TABLE cliente_pagos
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
  ADD COLUMN IF NOT EXISTS referencia TEXT;

-- Comentario: metodo_pago válidos: 'Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Otros'
-- Comentario: origen válidos: 'Pedidos', 'Tienda', 'Envios', 'Proveedores'
