-- ========================================================
-- SCRIPT DE REPARACIÓN MAESTRO: POLÍTICAS RLS TIENDA PÚBLICA
-- Ejecutar en Supabase SQL Editor
-- ========================================================

-- 1. REPARACIÓN TABLA: catalogo_productos
-- Aseguramos lectura pública e inserción/actualización para gestión
ALTER TABLE catalogo_productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura pública catálogo" ON catalogo_productos;
CREATE POLICY "Lectura pública catálogo"
ON catalogo_productos FOR SELECT
TO public
USING (true);

-- 2. REPARACIÓN TABLA: semanas
-- Vital para que el cliente vea cuándo llegan sus pedidos
ALTER TABLE semanas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura pública semanas" ON semanas;
CREATE POLICY "Lectura pública semanas"
ON semanas FOR SELECT
TO public
USING (true);

-- 3. REPARACIÓN TABLA: clientes
-- Permite que los compradores se registren y consulten su historial
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Inserción pública clientes" ON clientes;
CREATE POLICY "Inserción pública clientes"
ON clientes FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "Lectura pública clientes" ON clientes;
CREATE POLICY "Lectura pública clientes"
ON clientes FOR SELECT
TO public
USING (true);

-- 4. REPARACIÓN TABLA: cliente_items
-- Permite guardar los pedidos y ver el historial en "Mi Cuenta"
ALTER TABLE cliente_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Inserción pública items" ON cliente_items;
CREATE POLICY "Inserción pública items"
ON cliente_items FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "Lectura pública items" ON cliente_items;
CREATE POLICY "Lectura pública items"
ON cliente_items FOR SELECT
TO public
USING (true);

-- 5. REPARACIÓN TABLAS DE STOCK FLOTANTE (NECESARIAS PARA LA TIENDA)
-- master_confirmaciones y pedido_items deben ser legibles para ver qué llega
ALTER TABLE master_confirmaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura pública master_confirmaciones" ON master_confirmaciones;
CREATE POLICY "Lectura pública master_confirmaciones"
ON master_confirmaciones FOR SELECT
TO public
USING (true);

ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura pública pedido_items" ON pedido_items;
CREATE POLICY "Lectura pública pedido_items"
ON pedido_items FOR SELECT
TO public
USING (true);

-- 6. SEGURIDAD: caja_movimientos (NUNCA PÚBLICA)
-- Aseguramos que solo vendedores autenticados vean la caja
ALTER TABLE caja_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acceso privado caja" ON caja_movimientos;
CREATE POLICY "Acceso privado caja"
ON caja_movimientos FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 7. LIMPIEZA DE POSIBLES CONFLICTOS (Novelties / Otros)
-- Si existieran políticas duplicadas o restrictivas, las removemos
DROP POLICY IF EXISTS "allow_select_public" ON catalogo_productos;
DROP POLICY IF EXISTS "public_select_policy" ON catalogo_productos;
