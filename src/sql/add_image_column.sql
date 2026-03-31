-- 1. AÑADIR COLUMNA DE IMAGEN AL CATÁLOGO
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='catalogo_productos' AND column_name='imagen_url') THEN
        ALTER TABLE catalogo_productos ADD COLUMN imagen_url TEXT;
    END IF;
END $$;

-- 2. ASEGURAR QUE LOS VENDEDORES PUEDAN ACTUALIZAR ESTA COLUMNA
DROP POLICY IF EXISTS "Actualizar Imágenes por Vendedores" ON catalogo_productos;
CREATE POLICY "Actualizar Imágenes por Vendedores" ON catalogo_productos
FOR UPDATE TO authenticated
USING (true);

-- NOTA: Asegúrate de crear un bucket llamado 'catalog-images' en tu panel de Supabase Storage.
-- Debe ser PÚBLICO para que las fotos se vean.
