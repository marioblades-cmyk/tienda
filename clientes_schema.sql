-- ============================================================
-- MÓDULO: PEDIDOS DE CLIENTES
-- ============================================================

-- 1. Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  celular text UNIQUE NOT NULL,
  direccion text,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- 2. Items pedidos por clientes
CREATE TABLE IF NOT EXISTS cliente_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  product_id text,
  semana_id uuid REFERENCES semanas(id) ON DELETE SET NULL,
  precio_venta numeric NOT NULL DEFAULT 0,
  monto_pagado numeric NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'PEDIDO'
    CHECK (estado IN ('PEDIDO','CONFIRMADO','LISTO','ENTREGADO','CANCELADO')),
  nota text,
  vendedor_id uuid REFERENCES vendedores(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Pagos generales a cuenta por cliente
CREATE TABLE IF NOT EXISTS cliente_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE CASCADE,
  monto numeric NOT NULL,
  concepto text,
  fecha date DEFAULT CURRENT_DATE,
  vendedor_id uuid REFERENCES vendedores(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_cliente_items_cliente ON cliente_items(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_items_semana ON cliente_items(semana_id);
CREATE INDEX IF NOT EXISTS idx_cliente_items_estado ON cliente_items(estado);
CREATE INDEX IF NOT EXISTS idx_cliente_pagos_cliente ON cliente_pagos(cliente_id);

-- RLS
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acceso total autenticados" ON clientes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Acceso total autenticados" ON cliente_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Acceso total autenticados" ON cliente_pagos FOR ALL USING (auth.role() = 'authenticated');
