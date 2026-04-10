-- ==========================================
-- MIGRACIÓN: Agregar columna icono a categorias_caja
-- y poblar con las categorías de gasto por defecto
-- ==========================================

-- 1. Agregar columna icono (emoji) si no existe
ALTER TABLE categorias_caja
    ADD COLUMN IF NOT EXISTS icono TEXT DEFAULT '💼';

-- 2. Actualizar íconos de categorías existentes (por nombre)
UPDATE categorias_caja SET icono = '🏠'  WHERE nombre = 'Alquiler';
UPDATE categorias_caja SET icono = '⚡'  WHERE nombre = 'Luz / Electricidad';
UPDATE categorias_caja SET icono = '🌐'  WHERE nombre = 'Internet';
UPDATE categorias_caja SET icono = '✏️'  WHERE nombre = 'Librería / Útiles';
UPDATE categorias_caja SET icono = '📦'  WHERE nombre = 'Pago Distribuidor';
UPDATE categorias_caja SET icono = '🚛'  WHERE nombre = 'Flete / Envío';
UPDATE categorias_caja SET icono = '👤'  WHERE nombre = 'Salario / Personal';
UPDATE categorias_caja SET icono = '🔧'  WHERE nombre = 'Mantenimiento';
UPDATE categorias_caja SET icono = '💼'  WHERE nombre = 'Gasto Operativo';
UPDATE categorias_caja SET icono = '🛒'  WHERE nombre = 'Compra Mercancía';
UPDATE categorias_caja SET icono = '↩️'  WHERE nombre = 'Devolución Cliente';

-- 3. Insertar categorías de egreso que pueden no existir
INSERT INTO categorias_caja (nombre, icono, tipo) VALUES
    ('Alquiler',           '🏠', 'EGRESO'),
    ('Luz / Electricidad', '⚡', 'EGRESO'),
    ('Internet',           '🌐', 'EGRESO'),
    ('Librería / Útiles',  '✏️', 'EGRESO'),
    ('Pago Distribuidor',  '📦', 'EGRESO'),
    ('Flete / Envío',      '🚛', 'EGRESO'),
    ('Salario / Personal', '👤', 'EGRESO'),
    ('Mantenimiento',      '🔧', 'EGRESO'),
    ('Gasto Operativo',    '💼', 'EGRESO')
ON CONFLICT DO NOTHING;
