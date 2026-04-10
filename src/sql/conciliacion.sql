-- ==========================================
-- TABLA: conciliacion_config
-- Saldos iniciales por método de pago
-- (punto de partida para conciliación)
-- ==========================================

CREATE TABLE IF NOT EXISTS conciliacion_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metodo TEXT UNIQUE NOT NULL,
    saldo_inicial NUMERIC NOT NULL DEFAULT 0,
    notas TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conciliacion_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins_conciliacion" ON conciliacion_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Insertar valores por defecto en 0 para cada método
INSERT INTO conciliacion_config (metodo, saldo_inicial) VALUES
    ('Efectivo', 0),
    ('Yasta (QR)', 0),
    ('Banco Unión (QR/Transf)', 0),
    ('BNB', 0),
    ('Efectivo Personal', 0),
    ('Otros', 0)
ON CONFLICT (metodo) DO NOTHING;

-- ==========================================
-- TABLA: conciliacion_historial
-- Registro de cada verificación realizada
-- ==========================================

CREATE TABLE IF NOT EXISTS conciliacion_historial (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metodo TEXT NOT NULL,
    fecha_desde DATE NOT NULL,
    fecha_hasta DATE NOT NULL,
    saldo_inicial NUMERIC NOT NULL DEFAULT 0,
    ingresos NUMERIC NOT NULL DEFAULT 0,
    egresos NUMERIC NOT NULL DEFAULT 0,
    saldo_calculado NUMERIC NOT NULL DEFAULT 0,
    saldo_real NUMERIC NOT NULL DEFAULT 0,
    diferencia NUMERIC NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE', -- 'OK' | 'DIFERENCIA' | 'PENDIENTE'
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conciliacion_historial ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins_historial" ON conciliacion_historial FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
