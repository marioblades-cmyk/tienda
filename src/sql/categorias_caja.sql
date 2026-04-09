-- ==========================================
-- TABLA: categorias_caja
-- Categorías personalizables para movimientos
-- ==========================================

CREATE TABLE IF NOT EXISTS categorias_caja (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO', 'AMBOS')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE categorias_caja ENABLE ROW LEVEL SECURITY;

-- Política: todos los autenticados pueden LEER
CREATE POLICY "Todos leen categorias" ON categorias_caja
    FOR SELECT TO authenticated USING (true);

-- Política: solo admins pueden CREAR, EDITAR y ELIMINAR
-- (se controla desde el frontend con is_admin, y confirmamos con RLS)
CREATE POLICY "Admins gestionan categorias" ON categorias_caja
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Nota: el control real de admin es en el frontend; si quieres RLS estricto
-- necesitas una función que verifique is_admin en la tabla vendedores.

-- Datos iniciales (categorías por defecto)
INSERT INTO categorias_caja (nombre, tipo) VALUES
    ('Venta Stock', 'INGRESO'),
    ('Cobro Pedido', 'INGRESO'),
    ('Anticipo Cliente', 'INGRESO'),
    ('Transferencia Recibida', 'INGRESO'),
    ('Otro Ingreso', 'INGRESO'),
    ('Compra Mercancía', 'EGRESO'),
    ('Gasto Operativo', 'EGRESO'),
    ('Devolución Cliente', 'EGRESO'),
    ('Transferencia Enviada', 'EGRESO'),
    ('Otro Egreso', 'EGRESO')
ON CONFLICT DO NOTHING;
