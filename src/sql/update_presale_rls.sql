-- UPDATE RLS POLICIES FOR PRESALE PROJECTS AND TEMPLATES

-- 1. DROP OLD RESTRICTIVE POLICIES
DROP POLICY IF EXISTS "Users can manage their own presale projects" ON presale_projects;
DROP POLICY IF EXISTS "Users can manage their own presale templates" ON presale_templates;

-- 2. CREATE NEW POLICIES FOR PROJECTS
-- Everyone authenticated can see all projects
CREATE POLICY "Everyone can see all presale projects" 
ON presale_projects FOR SELECT 
TO authenticated 
USING (true);

-- Only owner can modify/delete their own projects
-- Note: If we have a SELECT policy already, ALL might conflict if we don't handle it precisely. 
-- But in Supabase/Postgres, multiple policies are combined with OR. 
-- However, standard practice is to separate policies by action.

DROP POLICY IF EXISTS "Everyone can see all presale projects" ON presale_projects;
DROP POLICY IF EXISTS "Users can manage their own presale projects" ON presale_projects;

-- Projects SELECT for ALL authenticated users
CREATE POLICY "Select all projects" ON presale_projects FOR SELECT TO authenticated USING (true);
-- Projects ALL for OWNER (handles INSERT, UPDATE, DELETE)
CREATE POLICY "Owner manage projects" ON presale_projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. CREATE NEW POLICIES FOR TEMPLATES
DROP POLICY IF EXISTS "Everyone can see all presale templates" ON presale_templates;
DROP POLICY IF EXISTS "Users can manage their own presale templates" ON presale_templates;

CREATE POLICY "Select all templates" ON presale_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owner manage templates" ON presale_templates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
