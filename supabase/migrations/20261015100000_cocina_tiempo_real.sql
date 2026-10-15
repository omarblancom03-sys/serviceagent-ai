-- US-10: pantalla de cocina en tiempo real (docs/negocio.md → Estados del pedido).
--
-- 1. Mientras no existan pagos (US-22 a US-25), el restaurante trabaja en modo al_confirmar
--    (D46): crear_pedido deja el pedido en 'en_cola' y guarda en el historial 'confirmado' y
--    'en_cola' con la misma hora (D42). Cuando llegue la configuración modo_envio_cocina, esta
--    función decidirá entre los dos modos.
-- 2. Cada vez que se crea un pedido o cambia su estado, la base manda una señal de Realtime sin
--    datos (D12, D47): la pantalla de cocina vuelve a pedir la lista a la API con su sesión.

-- Misma firma, mismas reglas de duplicados y de total que en 20261011100000_crear_pedidos.sql;
-- solo cambia el estado con que se guarda el pedido nuevo.
create or replace function public.crear_pedido(
  p_nombre_cliente text,
  p_telefono text,
  p_huella text,
  p_total_centavos integer,
  p_renglones jsonb,
  p_minutos_duplicado integer
)
returns table (
  folio_asignado integer, total_guardado integer, estado_actual text, ya_existia boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_folio integer;
  v_total integer;
  v_estado text;
  v_renglon jsonb;
  v_extra jsonb;
  v_id_renglon integer;
begin
  perform pg_advisory_xact_lock(hashtext('crear_pedido:' || p_telefono));

  select p.folio, p.total_centavos, p.estado into v_folio, v_total, v_estado
  from public.pedidos p
  where p.telefono = p_telefono
    and p.huella = p_huella
    and p.estado <> 'cancelado'
    and p.creado_en > now() - make_interval(mins => p_minutos_duplicado)
  order by p.creado_en desc
  limit 1;
  if found then
    return query select v_folio, v_total, v_estado, true;
    return;
  end if;

  -- Modo al_confirmar (D46): el pedido entra a la cola de cocina al confirmarse. El historial
  -- guarda los dos pasos con la misma hora.
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado, creado_en)
  values (p_nombre_cliente, p_telefono, p_huella, p_total_centavos, 'en_cola', now())
  returning id_pedido, folio into v_id_pedido, v_folio;

  insert into public.historial_estado_pedido (id_pedido, estado, creado_en)
  values (v_id_pedido, 'confirmado', now()), (v_id_pedido, 'en_cola', now());

  for v_renglon in select r.valor from jsonb_array_elements(p_renglones) as r(valor) loop
    insert into public.renglones_pedido (
      id_pedido, posicion, tipo, id_platillo, id_variante, id_extra, nombre, variante, cantidad,
      sin_ingredientes, precio_unitario_centavos, subtotal_centavos
    )
    values (
      v_id_pedido,
      (v_renglon ->> 'posicion')::integer,
      v_renglon ->> 'tipo',
      (v_renglon ->> 'id_platillo')::integer,
      (v_renglon ->> 'id_variante')::integer,
      (v_renglon ->> 'id_extra')::integer,
      v_renglon ->> 'nombre',
      v_renglon ->> 'variante',
      (v_renglon ->> 'cantidad')::integer,
      array(
        select jsonb_array_elements_text(coalesce(v_renglon -> 'sin_ingredientes', '[]'::jsonb))
      ),
      (v_renglon ->> 'precio_unitario_centavos')::integer,
      (v_renglon ->> 'subtotal_centavos')::integer
    )
    returning id_renglon into v_id_renglon;

    for v_extra in
      select e.valor from jsonb_array_elements(coalesce(v_renglon -> 'extras', '[]'::jsonb)) as e(valor)
    loop
      insert into public.extras_renglon_pedido (
        id_renglon, id_extra, nombre, cantidad, precio_unitario_centavos
      )
      values (
        v_id_renglon,
        (v_extra ->> 'id_extra')::integer,
        v_extra ->> 'nombre',
        (v_extra ->> 'cantidad')::integer,
        (v_extra ->> 'precio_unitario_centavos')::integer
      );
    end loop;
  end loop;

  select sum(r.subtotal_centavos) into v_total
  from public.renglones_pedido r
  where r.id_pedido = v_id_pedido;
  if v_total is distinct from p_total_centavos then
    raise exception 'El total (%) no coincide con la suma de los renglones (%).',
      p_total_centavos, v_total;
  end if;

  return query select v_folio, p_total_centavos, 'en_cola'::text, false;
end;
$$;


-- Señal "cambió un pedido" en el canal público 'pedidos', evento 'cambio' (packages/shared →
-- CANAL_SENAL_PEDIDOS). El payload va vacío a propósito: un canal público lo puede oír cualquiera
-- con la llave anon. Es de mejor esfuerzo: si Realtime falla, se deja un aviso y el pedido se
-- guarda igual; la pantalla también se refresca sola cada cierto tiempo.
create function public.senal_cambio_pedido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'cambio', 'pedidos', false);
  exception when others then
    raise warning 'No se pudo mandar la señal de Realtime: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.senal_cambio_pedido() from public, anon, authenticated;

-- Una señal por sentencia, no por fila: crear un pedido o cambiar varios estados avisa una vez.
create trigger pedidos_senal_cambio
after insert or update of estado on public.pedidos
for each statement
execute function public.senal_cambio_pedido();

-- La cocina lee solo los pedidos activos; el índice parcial los encuentra sin recorrer el resto.
create index pedidos_estado_cocina on public.pedidos (estado)
where estado in ('en_cola', 'preparando');
