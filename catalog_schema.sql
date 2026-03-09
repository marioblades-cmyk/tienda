-- ESQUEMA PARA EL CATÁLOGO MAESTRO DE PRODUCTOS
-- Correr este script en el SQL Editor de Supabase

-- 1. Tabla de Catálogo Principal
CREATE TABLE IF NOT EXISTS catalogo_productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT UNIQUE NOT NULL, -- Ej: "ivrea:hash_del_titulo"
    titulo TEXT NOT NULL,
    ean_oficial TEXT,
    ean_interno TEXT,
    precio_tapa NUMERIC NOT NULL DEFAULT 0,
    editorial TEXT NOT NULL,
    categoria TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Logs de Sincronización
CREATE TABLE IF NOT EXISTS catalogo_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id UUID REFERENCES vendedores(id),
    filename TEXT,
    total_procesados INTEGER DEFAULT 0,
    nuevos_detectados INTEGER DEFAULT 0,
    precios_actualizados INTEGER DEFAULT 0,
    datos_resumen JSONB, -- Para guardar detalles específicos de la sincro
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_cat_editorial ON catalogo_productos(editorial);
CREATE INDEX IF NOT EXISTS idx_cat_product_id ON catalogo_productos(product_id);

-- 4. Función para actualizar el 'updated_at' automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_catalogo_updated_at
    BEFORE UPDATE ON catalogo_productos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. RLTS (Seguridad)
ALTER TABLE catalogo_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura a todos" 
    ON catalogo_productos FOR SELECT USING (true);

CREATE POLICY "Permitir edición a admins" 
    ON catalogo_productos FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vendedores 
            WHERE vendedores.id = auth.uid() AND vendedores.is_admin = true
        )
    );

CREATE POLICY "Permitir todo a admins en logs" 
    ON catalogo_sync_logs FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vendedores 
            WHERE vendedores.id = auth.uid() AND vendedores.is_admin = true
        )
    );
