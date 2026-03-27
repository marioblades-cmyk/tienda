-- CREACIÓN DE TABLA PARA PROYECTOS DE PREVENTA
CREATE TABLE IF NOT EXISTS presale_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    items JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, name) -- Evitar nombres duplicados por usuario
);

-- Habilitar RLS (Seguridad de Fila)
ALTER TABLE presale_projects ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver y editar sus propios proyectos
CREATE POLICY "Users can manage their own presale projects" 
ON presale_projects 
FOR ALL 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Política opcional: Permitir que los administradores vean todos los proyectos
-- CREATE POLICY "Admins can see all projects" 
-- ON presale_projects FOR SELECT
-- TO authenticated
-- USING (EXISTS (SELECT 1 FROM vendedores WHERE id = auth.uid() AND is_admin = true));

-- TABLA PARA PLANTILLAS PERSONALIZADAS (OPCIONAL)
CREATE TABLE IF NOT EXISTS presale_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, name)
);

ALTER TABLE presale_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own presale templates" 
ON presale_templates 
FOR ALL 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
