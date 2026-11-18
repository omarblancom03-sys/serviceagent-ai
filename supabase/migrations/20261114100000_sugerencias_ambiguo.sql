-- US-15-P1: opción sugerida cuando el cliente no fue claro (docs/negocio.md → Cotización, D72).
--
-- Si el cliente dice solo "una hamburguesa", cotizar responde `ambiguo` con las 6 hamburguesas.
-- Esta tabla guarda, por frase, el platillo que el agente sugiere primero ("¿Sería la Hamburguesa
-- Granero?"). La marca va por frase y no por platillo: una palabra suelta como "pollo" junta
-- platillos de varias categorías, y una marca por platillo sugeriría ahí una ensalada. La lista la
-- aprueba el PO y viene del seed `06_sugerencias_ambiguo.sql` (datos simulados: no hay ventas
-- reales que digan qué es lo más común).
--
-- La API compara la frase ya normalizada (sin acentos, plurales ni relleno, como los sinónimos):
-- "hamburguesas" y "una hamburguesa" usan la fila "hamburguesa". La sugerencia nunca resuelve
-- sola: solo sale si su platillo está entre las opciones del `ambiguo` y el agente la pregunta.

create table public.sugerencia_ambiguo (
  id_sugerencia integer generated always as identity primary key,
  -- Como la escribe el PO: "hamburguesa", "papas", "tacos".
  frase text not null unique check (char_length(frase) between 1 and 60 and btrim(frase) <> ''),
  id_platillo integer not null references public.platillo (id_platillo) on delete cascade,
  activo boolean not null default true
);

comment on table public.sugerencia_ambiguo is
  'Platillo que el agente sugiere cuando el cliente dice solo esa frase y queda ambiguo (US-15, D72). Lista aprobada por el PO.';
comment on column public.sugerencia_ambiguo.activo is
  'false: la frase deja de sugerir (se conserva la fila).';

-- Solo la API la lee (D12, D15). El seed corre como postgres.
revoke all on table public.sugerencia_ambiguo from anon, authenticated, service_role;
grant select on table public.sugerencia_ambiguo to service_role;

alter table public.sugerencia_ambiguo enable row level security;
