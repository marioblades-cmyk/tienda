-- ESQUEMA DE BASE DE DATOS PARA SISTEMA DE REMITOS MANGAS COMICS BOLIVIA STORE

-- 1. Configuraciones Globales
CREATE TABLE IF NOT EXISTS remitos_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seeds iniciales para fletes
INSERT INTO remitos_config (key, value) VALUES ('fg', '70'), ('fm', '40'), ('fp', '20')
ON CONFLICT (key) DO NOTHING;

-- 2. Tabla de Remitos
CREATE TABLE IF NOT EXISTS remitos (
  id SERIAL PRIMARY KEY,
  nro TEXT DEFAULT '',
  fecha DATE,
  cajas TEXT DEFAULT '',
  kg TEXT DEFAULT '',
  precio_remito TEXT DEFAULT '',
  compre TEXT DEFAULT '',
  cambio TEXT DEFAULT '',
  cg INTEGER DEFAULT 0,
  cm INTEGER DEFAULT 0,
  cp INTEGER DEFAULT 0,
  -- Campos Socio
  skg TEXT DEFAULT '',
  scaj TEXT DEFAULT '',
  smonto TEXT DEFAULT '',
  -- Campos calculados FIFO (actualizados por trigger o lógica centralizada)
  pedido TEXT DEFAULT '',
  pago_aprox TEXT DEFAULT '',
  dist_tc NUMERIC(15, 7) DEFAULT 0,
  dist_pag NUMERIC DEFAULT 0,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Distribuidor Argentina
CREATE TABLE IF NOT EXISTS dist_pedidos (
  id SERIAL PRIMARY KEY,
  nombre TEXT DEFAULT '',
  monto NUMERIC DEFAULT 0,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dist_pagos (
  id SERIAL PRIMARY KEY,
  fecha DATE,
  monto NUMERIC DEFAULT 0,
  tc NUMERIC(15, 7) DEFAULT 0,
  nota TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dist_ajustes (
  id SERIAL PRIMARY KEY,
  fecha DATE,
  monto NUMERIC DEFAULT 0,
  nota TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dist_saldo_inicial (
  id INTEGER PRIMARY KEY DEFAULT 1,
  monto NUMERIC DEFAULT 0,
  tipo TEXT CHECK (tipo IN ('favor', 'deuda')),
  CONSTRAINT singleton CHECK (id = 1)
);

-- 4. Planes de Pago Socio
CREATE TABLE IF NOT EXISTS remitos_planes (
  id SERIAL PRIMARY KEY,
  fecha DATE,
  collapsed BOOLEAN DEFAULT true,
  editing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remitos_plan_items (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES remitos_planes(id) ON DELETE CASCADE,
  rem_id TEXT, -- ID del remito o "extra-N"
  tipo TEXT, -- 'envio', 'flete', 'pedido', 'extra'
  label TEXT,
  nro TEXT,
  amount NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS remitos_plan_pagos (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES remitos_planes(id) ON DELETE CASCADE,
  monto NUMERIC DEFAULT 0,
  fecha DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remitos_plan_extras (
  id SERIAL PRIMARY KEY,
  label TEXT,
  amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Cuenta Corriente
CREATE TABLE IF NOT EXISTS cta_pagos (
  id SERIAL PRIMARY KEY,
  monto NUMERIC DEFAULT 0,
  fecha DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cta_extras (
  id SERIAL PRIMARY KEY,
  label TEXT,
  amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Alquiler
CREATE TABLE IF NOT EXISTS alquiler_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_mes NUMERIC DEFAULT 0,
  socio_mes NUMERIC DEFAULT 0,
  mes_inicio TEXT DEFAULT '', -- 'YYYY-MM'
  CONSTRAINT singleton_alq CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS alquiler_meses (
  id SERIAL PRIMARY KEY,
  ym TEXT UNIQUE, -- 'YYYY-MM'
  cargado BOOLEAN DEFAULT false,
  auto_cargado BOOLEAN DEFAULT false
);

-- Habilitar RLS (Opcional pero recomendado)
ALTER TABLE remitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE dist_pedidos ENABLE ROW LEVEL SECURITY;
-- Por simplicidad en este MVP para el usuario, permitiremos acceso total a autenticados
-- En producción real, se filtrarían por rol admin.
CREATE POLICY "Permitir todo a autenticados" ON remitos FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir todo a autenticados" ON dist_pedidos FOR ALL USING (auth.role() = 'authenticated');
-- Repetir para el resto de tablas si es necesario...
