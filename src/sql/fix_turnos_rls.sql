-- Fix: permitir que TODOS los vendedores autenticados vean y operen sobre
-- turnos_caja y caja_movimientos, independientemente de quién abrió el turno.
-- Ejecutar en Supabase Dashboard > SQL Editor

-- Borrar políticas antiguas que podrían estar bloqueando
DROP POLICY IF EXISTS "auth_turnos"       ON turnos_caja;
DROP POLICY IF EXISTS "todos_ven_turnos"  ON turnos_caja;

DROP POLICY IF EXISTS "auth_movimientos"          ON caja_movimientos;
DROP POLICY IF EXISTS "todos_ven_movimientos"     ON caja_movimientos;

-- Asegurar que RLS está activo en ambas tablas
ALTER TABLE turnos_caja       ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_movimientos  ENABLE ROW LEVEL SECURITY;

-- Política amplia: cualquier usuario autenticado puede leer/escribir todo
CREATE POLICY "turnos_authenticated_all"
    ON turnos_caja FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "movimientos_authenticated_all"
    ON caja_movimientos FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
