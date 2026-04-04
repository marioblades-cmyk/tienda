-- Ejecutar este SQL en el editor de Supabase

CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  celular text UNIQUE NOT NULL,
  direccion text,
  notas text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cliente_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  product_id text,
  semana_id uuid REFERENCES semanas(id) ON DELETE SET NULL,
  precio_venta numeric NOT NULL DEFAULT 0,
  monto_pagado numeric NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'PEDIDO',
  nota text,
  vendedor_id uuid REFERENCES vendedores(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cliente_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE CASCADE,
  monto numeric NOT NULL,
  concepto text,
  fecha date DEFAULT CURRENT_DATE,
  vendedor_id uuid REFERENCES vendedores(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_clientes" ON clientes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_items" ON cliente_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_pagos" ON cliente_pagos FOR ALL USING (auth.role() = 'authenticated');
