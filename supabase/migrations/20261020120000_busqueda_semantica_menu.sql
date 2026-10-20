-- Búsqueda semántica del menú (US-16, D50).
--
-- Cada platillo guarda un embedding de su texto (nombre, categoría, descripción, ingredientes,
-- presentaciones y sinónimos) para que `buscar_menu` encuentre platillos con las palabras del
-- cliente ("algo picoso con camarones"). Los embeddings los calcula la API con Workers AI
-- (`@cf/baai/bge-m3`, 1024 dimensiones) y los guarda aquí; nadie más escribe en esta tabla.
--
-- Reindexado automático: `hash_contenido` es el SHA-256 del modelo y del texto. Si cambia el
-- platillo (nombre, descripción, ingredientes…) o el modelo, el hash ya no coincide y la API
-- vuelve a calcular solo ese embedding en la siguiente búsqueda.

create extension if not exists vector with schema extensions;

create table if not exists public.embedding_platillo (
  id_platillo integer primary key references public.platillo (id_platillo) on delete cascade,
  modelo text not null,
  hash_contenido text not null,
  contenido text not null,
  embedding extensions.vector(1024) not null,
  actualizado_en timestamptz not null default now()
);

comment on table public.embedding_platillo is
  'Embedding del texto de cada platillo para la búsqueda semántica (US-16). Lo escribe la API.';
comment on column public.embedding_platillo.hash_contenido is
  'SHA-256 de modelo + texto indexado: si no coincide con el texto actual, se reindexa.';

-- Permisos explícitos (supabase/CLAUDE.md, D15): solo la API, con la llave de servicio. Lee las
-- huellas y hace upsert (insert + update); no borra: si un platillo se borra, cae en cascada.
revoke all on table public.embedding_platillo from anon, authenticated, service_role;
grant select, insert, update on table public.embedding_platillo to service_role;

alter table public.embedding_platillo enable row level security;

-- Los platillos más parecidos a la consulta, por distancia coseno (similitud = 1 - distancia).
-- Solo cuenta los embeddings del modelo actual. Búsqueda exacta, sin índice: con ~100 platillos
-- recorrer la tabla es instantáneo y un índice aproximado (HNSW) podría saltarse alguno.
create or replace function public.buscar_platillos_similares(
  p_embedding extensions.vector(1024),
  p_modelo text,
  p_limite integer
)
returns table (id_platillo integer, similitud double precision)
language sql
stable
set search_path = ''
as $$
  select e.id_platillo, 1 - (e.embedding operator(extensions.<=>) p_embedding) as similitud
  from public.embedding_platillo as e
  where e.modelo = p_modelo
  order by e.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limite, 1), 50);
$$;

revoke execute on function public.buscar_platillos_similares(extensions.vector, text, integer)
  from public, anon, authenticated;
grant execute on function public.buscar_platillos_similares(extensions.vector, text, integer)
  to service_role;
