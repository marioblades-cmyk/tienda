-- Añadir columna is_socio a la tabla vendedores
alter table vendedores add column if not exists is_socio boolean default false;
