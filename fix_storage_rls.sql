-- 1. Asegurar que el bucket 'docs' sea público para lectura
update storage.buckets set public = true where id = 'docs';

-- 2. Eliminar políticas restrictivas anteriores (si las hay)
drop font policy if exists "Admin full access" on storage.objects;
drop policy if exists "Public read access" on storage.objects;

-- 3. Crear política para permitir a los administradores subir/borrar archivos
create policy "Admin full access"
on storage.objects for all
to authenticated
using (
  exists (
    select 1 from vendedores
    where id = auth.uid() and is_admin = true
  )
)
with check (
  exists (
    select 1 from vendedores
    where id = auth.uid() and is_admin = true
  )
);

-- 4. Crear política para permitir a cualquiera ver los archivos (lectura pública)
create policy "Public read access"
on storage.objects for select
to public
using ( bucket_id = 'docs' );
