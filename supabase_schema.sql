-- 1. TABLA DE SEMANAS (El admin abre una por distribución)
create table semanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  archivo_nombre text,
  archivo_url text, -- URL del Excel base en Storage
  abierta boolean default true,
  created_at timestamp with time zone default now()
);

-- 2. TABLA DE VENDEDORES (Perfiles de usuario)
-- Nota: 'id' debe coincidir con el UID de Auth de Supabase
create table vendedores (
  id uuid primary key,
  nombre text not null,
  email text unique not null,
  is_admin boolean default false,
  created_at timestamp with time zone default now()
);

-- 3. TABLA DE PEDIDOS (Uno por vendedor/tipo por semana)
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  semana_id uuid references semanas(id) on delete cascade,
  vendedor_id uuid references vendedores(id) on delete cascade,
  vendedor_nombre text,
  archivo_nombre text,
  tipo text default 'personal', -- 'personal' o 'tienda'
  created_at timestamp with time zone default now(),
  unique(semana_id, vendedor_id, tipo)
);

-- 4. TABLA DE ITEMS DE CADA PEDIDO
create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references pedidos(id) on delete cascade,
  editorial text,
  titulo text,
  isbn_raw text,
  precio numeric,
  cantidad integer,
  categoria text
);

-- 5. VISTA DE CONSOLIDADO DETALLADO
-- Esta vista suma las cantidades y agrupa por título para el admin
create or replace view consolidado_detailed as
select
  pi.editorial,
  pi.titulo,
  pi.isbn_raw,
  pi.precio,
  sum(pi.cantidad) as cantidad_total,
  count(distinct p.vendedor_id) filter (where p.tipo = 'personal') as vendedores_count,
  string_agg(distinct p.vendedor_nombre, ', ') filter (where p.tipo = 'personal') as vendedores_nombres,
  sum(pi.cantidad) filter (where p.tipo = 'tienda') as cantidad_tienda
from pedido_items pi
join pedidos p on p.id = pi.pedido_id
group by pi.editorial, pi.titulo, pi.isbn_raw, pi.precio
order by pi.editorial, pi.titulo;

-- 6. CONFIGURACIÓN DE STORAGE
-- Recuerda crear un bucket llamado 'docs' con acceso público en el panel de Supabase
