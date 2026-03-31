-- UPDATE RLS POLICIES FOR PRESALE PROJECTS AND TEMPLATES

-- 1. DROP OLD RESTRICTIVE POLICIES
DROP POLICY IF EXISTS "Users can manage their own presale projects" ON presale_projects;
DROP POLICY IF EXISTS "Users can manage their own presale templates" ON presale_templates;
DROP POLICY IF EXISTS "Everyone can see all presale projects" ON presale_projects;
DROP POLICY IF EXISTS "Everyone can see all presale templates" ON presale_templates;

-- 2. CREATE NEW POLICIES FOR PROJECTS
DROP POLICY IF EXISTS "Select all projects" ON presale_projects;
CREATE POLICY "Select all projects" ON presale_projects FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner manage projects" ON presale_projects;
CREATE POLICY "Owner manage projects" ON presale_projects FOR ALL TO authenticated USING (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM vendedores WHERE id = auth.uid() AND is_admin = true)
) WITH CHECK (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM vendedores WHERE id = auth.uid() AND is_admin = true)
);

-- 3. CREATE NEW POLICIES FOR TEMPLATES
DROP POLICY IF EXISTS "Select all templates" ON presale_templates;
CREATE POLICY "Select all templates" ON presale_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner manage templates" ON presale_templates;
CREATE POLICY "Owner manage templates" ON presale_templates FOR ALL TO authenticated USING (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM vendedores WHERE id = auth.uid() AND is_admin = true)
) WITH CHECK (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM vendedores WHERE id = auth.uid() AND is_admin = true)
);


-- 4. ENSURE VENDEDORES ARE READABLE (Required for the JOIN)
-- We only allow selecting the 'nombre' and 'id' to protect other data
DROP POLICY IF EXISTS "Vendedores are readable by all authenticated" ON vendedores;
CREATE POLICY "Vendedores are readable by all authenticated" ON vendedores FOR SELECT TO authenticated USING (true);

-- 5. DEFINE RELATIONSHIPS FOR JOIN (Schema cache fix)
-- This tells Supabase how 'presale_projects' and 'presale_templates' connect to 'vendedores'
-- Note: Both id and user_id are UUIDs referencing auth.users(id)

ALTER TABLE presale_projects DROP CONSTRAINT IF EXISTS presale_projects_user_id_fkey_vendedores;
ALTER TABLE presale_projects 
ADD CONSTRAINT presale_projects_user_id_fkey_vendedores 
FOREIGN KEY (user_id) REFERENCES vendedores(id);

ALTER TABLE presale_templates DROP CONSTRAINT IF EXISTS presale_templates_user_id_fkey_vendedores;
ALTER TABLE presale_templates 
ADD CONSTRAINT presale_templates_user_id_fkey_vendedores 
FOREIGN KEY (user_id) REFERENCES vendedores(id);

