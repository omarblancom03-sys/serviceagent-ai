-- Información del restaurante y preguntas frecuentes (US-17, D62).
--
-- `info_restaurante` guarda lo que el cliente pregunta y no está en el menú: horario, dirección,
-- teléfono, estacionamiento, formas de pago, alérgenos… Una fila por tema; los textos los aprueba
-- el PO y vienen del seed `05_info_restaurante.sql`. El agente las consulta con la custom function
-- `info_restaurante` (`POST /agente/info-restaurante`), que busca con embeddings igual que
-- `buscar_menu` (US-16, D50): cada fila guarda el embedding de su texto en `embedding_info`.
--
-- Reindexado automático, como en `embedding_platillo`: `hash_contenido` es el SHA-256 del modelo y
-- del texto; si cambia el título o el contenido, la API recalcula ese embedding en la siguiente
-- consulta.

create table if not exists public.info_restaurante (
  id_info integer generated always as identity primary key,
  -- Clave estable para el seed y para el agente: horario, direccion, estacionamiento…
  tema text not null unique check (tema ~ '^[a-z]+(_[a-z]+)*$'),
  titulo text not null check (length(trim(titulo)) > 0),
  contenido text not null check (length(trim(contenido)) > 0),
  activo boolean not null default true
);

comment on table public.info_restaurante is
  'Información del restaurante y preguntas frecuentes que responde el agente (US-17). Textos aprobados por el PO.';
comment on column public.info_restaurante.activo is
  'false: el agente ya no la encuentra (se conserva para no perder el texto).';

create table if not exists public.embedding_info (
  id_info integer primary key references public.info_restaurante (id_info) on delete cascade,
  modelo text not null,
  hash_contenido text not null,
  contenido text not null,
  embedding extensions.vector(1024) not null,
  actualizado_en timestamptz not null default now()
);

comment on table public.embedding_info is
  'Embedding del texto de cada fila de info_restaurante para la búsqueda semántica (US-17). Lo escribe la API.';
comment on column public.embedding_info.hash_contenido is
  'SHA-256 de modelo + texto indexado: si no coincide con el texto actual, se reindexa.';

-- Permisos explícitos (supabase/CLAUDE.md, D15): solo la API, con la llave de servicio. La API lee
-- la información y hace upsert de los embeddings; nadie más lee ni escribe estas tablas.
revoke all on table public.info_restaurante from anon, authenticated, service_role;
grant select on table public.info_restaurante to service_role;
revoke all on table public.embedding_info from anon, authenticated, service_role;
grant select, insert, update on table public.embedding_info to service_role;

alter table public.info_restaurante enable row level security;
alter table public.embedding_info enable row level security;

-- Las filas más parecidas a la consulta, por distancia coseno (similitud = 1 - distancia). Igual
-- que `buscar_platillos_similares`: solo el modelo actual y búsqueda exacta (son unas cuantas filas).
create or replace function public.buscar_info_similar(
  p_embedding extensions.vector(1024),
  p_modelo text,
  p_limite integer
)
returns table (id_info integer, similitud double precision)
language sql
stable
set search_path = ''
as $$
  select e.id_info, 1 - (e.embedding operator(extensions.<=>) p_embedding) as similitud
  from public.embedding_info as e
  where e.modelo = p_modelo
  order by e.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limite, 1), 50);
$$;

revoke execute on function public.buscar_info_similar(extensions.vector, text, integer)
  from public, anon, authenticated;
grant execute on function public.buscar_info_similar(extensions.vector, text, integer)
  to service_role;
