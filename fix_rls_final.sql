-- 1. Asegurar que el bucket 'docs' sea público para lectura
update storage.buckets set public = true where id = 'docs';

-- 2. Agregar columna 'active' a la tabla vendedores si no existe
alter table vendedores add column if not exists active boolean default true;

-- 3. Políticas para la tabla 'semanas'
drop policy if exists "Cualquiera puede ver semanas" on semanas;
drop policy if exists "Solo administradores pueden crear semanas" on semanas;
drop policy if exists "Solo administradores pueden borrar semanas" on semanas;
drop policy if exists "Solo administradores pueden editar semanas" on semanas;

-- Permitir lectura a todos los autenticados
create policy "Lectura de semanas"
on semanas for select
to authenticated
using (true);

-- Permitir todo a los administradores
create policy "Admin total sobre semanas"
on semanas for all
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

-- 2. Asegurar que el bucket 'docs' sea público para lectura
update storage.buckets set public = true where id = 'docs';

-- 3. Crear política para permitir a los administradores gestionar archivos en storage
drop policy if exists "Admin full access" on storage.objects;
drop policy if exists "Public read access" on storage.objects;

create policy "Admin full access storage"
on storage.objects for all
to authenticated
using (
  bucket_id = 'docs' and
  exists (
    select 1 from vendedores
    where id = auth.uid() and is_admin = true
  )
)
with check (
  bucket_id = 'docs' and
  exists (
    select 1 from vendedores
    where id = auth.uid() and is_admin = true
  )
);

create policy "Lectura pública storage"
on storage.objects for select
to public
using ( bucket_id = 'docs' );
