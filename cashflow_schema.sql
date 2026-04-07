CREATE TABLE IF NOT EXISTS turnos_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  responsable text NOT NULL,
  turno text NOT NULL CHECK (turno IN ('MAÑANA','TARDE','DÍA')),
  monto_inicial numeric NOT NULL DEFAULT 0,
  monto_final numeric,
  fecha date DEFAULT CURRENT_DATE,
  abierto_at timestamptz DEFAULT now(),
  cerrado_at timestamptz,
  estado text DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  vendedor_id uuid
);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id uuid REFERENCES turnos_caja(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('INGRESO','EGRESO')),
  categoria text NOT NULL,
  concepto text,
  monto numeric NOT NULL,
  vendedor_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Seguridad RLS
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_turnos" ON turnos_caja FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_movimientos" ON caja_movimientos FOR ALL USING (auth.role() = 'authenticated');
