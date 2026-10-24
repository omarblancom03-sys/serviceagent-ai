-- US-20: pagos de cada pedido, para la palomita de "pagado" de la pantalla de caja.
--
-- Un pedido está pagado cuando la suma de sus pagos cubre su total (docs/negocio.md → Pagos).
-- Esta historia solo la lee: los pagos en efectivo y tarjeta los registra caja (US-21) y los de
-- transferencia, el webhook del banco (US-25). Cada uno llegará con su propia función y su grant.

create table public.pagos (
  id_pago integer generated always as identity primary key,
  id_pedido integer not null references public.pedidos (id_pedido),
  metodo text not null check (metodo in ('efectivo', 'tarjeta', 'transferencia')),
  monto_centavos integer not null check (monto_centavos > 0),
  -- Quién lo cobró en caja. Vacío en las transferencias, que registra el sistema.
  id_empleado uuid references public.empleados (id),
  -- Hora puesta por Postgres, igual que los cambios de estado (D42).
  creado_en timestamptz not null default now()
);

create index pagos_id_pedido on public.pagos (id_pedido);

comment on table public.pagos is 'Pagos de cada pedido (caja y transferencias). Solo la API la lee y escribe.';

revoke all on table public.pagos from anon, authenticated, service_role;
grant select on table public.pagos to service_role;

alter table public.pagos enable row level security;

-- Registrar un pago también avisa a las pantallas, igual que un cambio de estado (D47).
create trigger pagos_senal_cambio
after insert on public.pagos
for each statement
execute function public.senal_cambio_pedido();

-- La caja lee los pedidos del día; el índice los encuentra sin recorrer los de días anteriores.
create index pedidos_creado_en on public.pedidos (creado_en);
