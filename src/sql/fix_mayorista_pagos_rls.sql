-- Fix RLS para tabla mayorista_pagos
-- Ejecutar en Supabase > SQL Editor

ALTER TABLE mayorista_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso autenticado mayorista_pagos" ON mayorista_pagos;
CREATE POLICY "Acceso autenticado mayorista_pagos"
ON mayorista_pagos FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
