-- EJECUTAR ESTO EN EL SQL EDITOR DE SUPABASE PARA HABILITAR ACCESO PÚBLICO

-- 1. Permitir a cualquiera ver las semanas para calcular las fechas de llegada
DROP POLICY IF EXISTS "Lectura pública de semanas" ON semanas;
CREATE POLICY "Lectura pública de semanas" ON semanas FOR SELECT TO public USING (true);

-- 2. Permitir que clientes anónimos puedan leer y registrar sus propios datos
DROP POLICY IF EXISTS "Inserción pública de clientes" ON clientes;
CREATE POLICY "Inserción pública de clientes" ON clientes FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Lectura pública de clientes" ON clientes;
CREATE POLICY "Lectura pública de clientes" ON clientes FOR SELECT TO public USING (true);

-- 3. Permitir que clientes anónimos puedan registrar sus ítems de pedido
DROP POLICY IF EXISTS "Inserción pública de items de clientes" ON cliente_items;
CREATE POLICY "Inserción pública de items de clientes" ON cliente_items FOR INSERT TO public WITH CHECK (true);
