import {
  ConflictoCocinaSchema,
  DeshacerCambioCocinaPeticionSchema,
  ESTADOS_COCINA,
  ParamsFolioCocinaSchema,
  RespuestaCambioEstadoCocinaSchema,
  RespuestaPedidosCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  SEGUNDOS_DESHACER_SERVIDOR,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoCocina } from '../src/lib/repoCocina';
import {
  armarTickets,
  cambiarEstadoCocina,
  deshacerCambioCocina,
  type CocinaRepo,
  type PedidoActivo,
} from '../src/services/cocina';
import { crearCocinaEnMemoria } from './cocinaEnMemoria';

const hora = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00Z`);

const pedido = (folio: number, enColaDesde: Date, extra: Partial<PedidoActivo> = {}) => ({
  folio,
  nombreCliente: `Cliente ${folio}`,
  estado: 'en_cola' as const,
  enColaDesde,
  renglones: [{ tipo: 'extra' as const, cantidad: 1, nombre: 'Totopos' }],
  ...extra,
});

describe('armarTickets (US-10)', () => {
  it('ordena del más antiguo al más nuevo según la hora en que entró a la cola', () => {
    const tickets = armarTickets([
      pedido(1003, hora('18:10')),
      pedido(1001, hora('18:00')),
      pedido(1002, hora('18:05'), { estado: 'preparando' }),
    ]);
    expect(tickets.map((t) => t.folio)).toEqual([1001, 1002, 1003]);
  });

  it('con la misma hora, va primero el folio menor', () => {
    const tickets = armarTickets([pedido(1005, hora('18:00')), pedido(1004, hora('18:00'))]);
    expect(tickets.map((t) => t.folio)).toEqual([1004, 1005]);
  });

  it('arma el ticket según el contrato: folio en texto y hora ISO', () => {
    const [ticket] = armarTickets([pedido(1001, hora('18:00'))]);
    expect(ticket).toEqual({
      folio: 1001,
      folioTexto: '#1001',
      nombreCliente: 'Cliente 1001',
      estado: 'en_cola',
      enColaDesde: '2026-10-15T18:00:00.000Z',
      renglones: [{ tipo: 'extra', cantidad: 1, nombre: 'Totopos' }],
    });
    expect(RespuestaPedidosCocinaSchema.safeParse({ pedidos: [ticket] }).success).toBe(true);
  });

  it('sin pedidos activos devuelve una lista vacía', () => {
    expect(armarTickets([])).toEqual([]);
  });
});

/** Cliente de Supabase falso: devuelve `respuesta` y anota la consulta que se hizo. */
function clienteCon(respuesta: { data: unknown; error: { message: string } | null }) {
  const consulta: { tabla?: string; columnas?: string; columna?: string; valores?: unknown } = {};
  const cliente = {
    from(tabla: string) {
      consulta.tabla = tabla;
      return {
        select(columnas: string) {
          consulta.columnas = columnas;
          return {
            in(columna: string, valores: unknown) {
              consulta.columna = columna;
              consulta.valores = valores;
              return Promise.resolve(respuesta);
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { cliente, consulta };
}

const filaPedido = {
  folio: 1001,
  nombre_cliente: 'María José',
  estado: 'en_cola',
  creado_en: '2026-10-15T18:00:00.123456+00:00',
  historial_estado_pedido: [
    { estado: 'confirmado', creado_en: '2026-10-15T18:00:00.123456+00:00' },
    { estado: 'en_cola', creado_en: '2026-10-15T18:00:00.123456+00:00' },
  ],
  renglones_pedido: [
    {
      posicion: 1,
      tipo: 'extra',
      nombre: 'Totopos',
      variante: null,
      cantidad: 2,
      sin_ingredientes: [],
      extras_renglon_pedido: [],
    },
    {
      posicion: 0,
      tipo: 'platillo',
      nombre: 'T-Bone 450 gr',
      variante: null,
      cantidad: 1,
      sin_ingredientes: ['Cebolla asada'],
      extras_renglon_pedido: [{ id_extra_renglon: 7, nombre: 'Espuelas (camarones)', cantidad: 2 }],
    },
  ],
};

describe('crearRepoCocina (Supabase)', () => {
  it('pide solo los pedidos en cola o preparándose, con sus renglones, extras e historial', async () => {
    const { cliente, consulta } = clienteCon({ data: [], error: null });
    await crearRepoCocina(cliente).leerPedidosActivos();

    expect(consulta).toMatchObject({
      tabla: 'pedidos',
      columna: 'estado',
      valores: ['en_cola', 'preparando'],
    });
    expect(consulta.columnas).toContain('historial_estado_pedido(estado, creado_en)');
    expect(consulta.columnas).toContain('extras_renglon_pedido(');
    expect(consulta.columnas).not.toMatch(/telefono|centavos/);
  });

  it('ordena los renglones por posición y toma la hora de entrada a la cola del historial', async () => {
    const { cliente } = clienteCon({ data: [filaPedido], error: null });
    const [leido] = await crearRepoCocina(cliente).leerPedidosActivos();

    expect(leido?.enColaDesde.toISOString()).toBe('2026-10-15T18:00:00.123Z');
    expect(leido?.renglones).toEqual([
      {
        tipo: 'platillo',
        cantidad: 1,
        nombre: 'T-Bone 450 gr',
        variante: null,
        sinIngredientes: ['Cebolla asada'],
        extras: [{ nombre: 'Espuelas (camarones)', cantidad: 2 }],
      },
      { tipo: 'extra', cantidad: 2, nombre: 'Totopos' },
    ]);
  });

  it('si el pedido volvió a la cola, usa la última vez que entró', async () => {
    const historial = [
      { estado: 'en_cola', creado_en: '2026-10-15T18:00:00+00:00' },
      { estado: 'en_cola', creado_en: '2026-10-15T18:30:00+00:00' },
    ];
    const { cliente } = clienteCon({
      data: [{ ...filaPedido, historial_estado_pedido: historial }],
      error: null,
    });
    const [leido] = await crearRepoCocina(cliente).leerPedidosActivos();
    expect(leido?.enColaDesde.toISOString()).toBe('2026-10-15T18:30:00.000Z');
  });

  it('sin hora de cola en el historial, usa la hora en que se creó el pedido', async () => {
    const { cliente } = clienteCon({
      data: [{ ...filaPedido, historial_estado_pedido: [] }],
      error: null,
    });
    const [leido] = await crearRepoCocina(cliente).leerPedidosActivos();
    expect(leido?.enColaDesde.toISOString()).toBe('2026-10-15T18:00:00.123Z');
  });

  it('lanza un error si Supabase falla o si una fila no tiene la forma esperada', async () => {
    const conError = clienteCon({ data: null, error: { message: 'timeout' } });
    await expect(crearRepoCocina(conError.cliente).leerPedidosActivos()).rejects.toThrow(
      'No se pudieron leer los pedidos de cocina: timeout',
    );

    const filaRara = clienteCon({ data: [{ ...filaPedido, estado: 'entregado' }], error: null });
    await expect(crearRepoCocina(filaRara.cliente).leerPedidosActivos()).rejects.toThrow();
  });
});

/** Repo que responde siempre lo mismo y anota lo que se le pidió. */
function repoQueResponde(respuestas: {
  cambio?: Awaited<ReturnType<CocinaRepo['cambiarEstado']>>;
  deshacer?: Awaited<ReturnType<CocinaRepo['deshacerEstado']>>;
}) {
  const pedidos: unknown[] = [];
  const repo: CocinaRepo = {
    ...crearCocinaEnMemoria().repo,
    cambiarEstado: (cambio) => {
      pedidos.push(cambio);
      return Promise.resolve(respuestas.cambio ?? null);
    },
    deshacerEstado: (deshacer) => {
      pedidos.push(deshacer);
      return Promise.resolve(respuestas.deshacer ?? null);
    },
  };
  return { repo, pedidos };
}

describe('cambiarEstadoCocina y deshacerCambioCocina (US-11-P1)', () => {
  const cambiadoEn = new Date('2026-10-22T18:00:00.123Z');

  it('Empezar pide en_cola → preparando con el empleado y da deshacerHasta con el plazo de pantalla', async () => {
    const { repo, pedidos } = repoQueResponde({
      cambio: { estadoActual: 'preparando', cambiadoEn },
    });
    const resultado = await cambiarEstadoCocina(repo, 'empezar', 1001, 'id-empleado');

    expect(pedidos).toEqual([
      { folio: 1001, desde: 'en_cola', hacia: 'preparando', idEmpleado: 'id-empleado' },
    ]);
    expect(resultado).toEqual({
      tipo: 'ok',
      respuesta: {
        folio: 1001,
        folioTexto: '#1001',
        estado: 'preparando',
        cambiadoEn: '2026-10-22T18:00:00.123Z',
        deshacerHasta: '2026-10-22T18:00:10.123Z',
      },
    });
    expect(SEGUNDOS_DESHACER_PANTALLA).toBe(10);
  });

  it('Terminado pide preparando → listo', async () => {
    const { repo, pedidos } = repoQueResponde({ cambio: { estadoActual: 'listo', cambiadoEn } });
    await cambiarEstadoCocina(repo, 'terminar', 1001, 'id-empleado');
    expect(pedidos[0]).toMatchObject({ desde: 'preparando', hacia: 'listo' });
  });

  it('sin cambio es conflicto con el estado actual; sin fila, no existe', async () => {
    const conflicto = await cambiarEstadoCocina(
      repoQueResponde({ cambio: { estadoActual: 'cancelado', cambiadoEn: null } }).repo,
      'empezar',
      1001,
      'id',
    );
    expect(conflicto).toMatchObject({
      tipo: 'conflicto',
      conflicto: { codigo: 'estado_cambio', estadoActual: 'cancelado' },
    });
    expect(await cambiarEstadoCocina(repoQueResponde({}).repo, 'empezar', 1, 'id')).toEqual({
      tipo: 'no_existe',
    });
  });

  it('deshacer manda el plazo del servidor y traduce cada motivo', async () => {
    const { repo, pedidos } = repoQueResponde({
      deshacer: { estadoActual: 'preparando', motivo: null },
    });
    expect(await deshacerCambioCocina(repo, 1001, 'listo')).toEqual({
      tipo: 'ok',
      respuesta: { folio: 1001, folioTexto: '#1001', estado: 'preparando' },
    });
    expect(pedidos).toEqual([{ folio: 1001, estado: 'listo', segundosPlazo: 15 }]);
    expect(SEGUNDOS_DESHACER_SERVIDOR).toBe(15);

    const vencido = await deshacerCambioCocina(
      repoQueResponde({ deshacer: { estadoActual: 'preparando', motivo: 'plazo_vencido' } }).repo,
      1001,
      'preparando',
    );
    expect(vencido).toMatchObject({ tipo: 'conflicto', conflicto: { codigo: 'plazo_vencido' } });

    const distinto = await deshacerCambioCocina(
      repoQueResponde({ deshacer: { estadoActual: 'listo', motivo: 'estado_distinto' } }).repo,
      1001,
      'preparando',
    );
    expect(distinto).toMatchObject({
      tipo: 'conflicto',
      conflicto: { codigo: 'estado_cambio', estadoActual: 'listo' },
    });
  });
});

/** Cliente de Supabase falso que solo tiene `rpc()`. */
function clienteRpc(respuesta: { data: unknown; error: { message: string } | null }) {
  const llamadas: { funcion: string; parametros: unknown }[] = [];
  const cliente = {
    rpc(funcion: string, parametros: unknown) {
      llamadas.push({ funcion, parametros });
      return Promise.resolve(respuesta);
    },
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

describe('crearRepoCocina: cambio de estado con rpc() (US-11-P1)', () => {
  it('llama a cambiar_estado_cocina con sus parámetros y lee la hora', async () => {
    const { cliente, llamadas } = clienteRpc({
      data: [{ estado_actual: 'preparando', cambiado_en: '2026-10-22T18:00:00.123456+00:00' }],
      error: null,
    });
    const guardado = await crearRepoCocina(cliente).cambiarEstado({
      folio: 1001,
      desde: 'en_cola',
      hacia: 'preparando',
      idEmpleado: 'id-empleado',
    });
    expect(llamadas).toEqual([
      {
        funcion: 'cambiar_estado_cocina',
        parametros: {
          p_folio: 1001,
          p_estado_desde: 'en_cola',
          p_estado_hacia: 'preparando',
          p_id_empleado: 'id-empleado',
        },
      },
    ]);
    expect(guardado?.cambiadoEn?.toISOString()).toBe('2026-10-22T18:00:00.123Z');
  });

  it('sin hora es que no cambió; sin filas, que el folio no existe', async () => {
    const sinCambio = clienteRpc({
      data: [{ estado_actual: 'listo', cambiado_en: null }],
      error: null,
    });
    expect(
      await crearRepoCocina(sinCambio.cliente).cambiarEstado({
        folio: 1001,
        desde: 'en_cola',
        hacia: 'preparando',
        idEmpleado: 'id',
      }),
    ).toEqual({ estadoActual: 'listo', cambiadoEn: null });

    const vacio = clienteRpc({ data: [], error: null });
    expect(
      await crearRepoCocina(vacio.cliente).deshacerEstado({
        folio: 9999,
        estado: 'listo',
        segundosPlazo: 15,
      }),
    ).toBeNull();
  });

  it('llama a deshacer_estado_cocina con el plazo y lee el motivo', async () => {
    const { cliente, llamadas } = clienteRpc({
      data: [{ estado_actual: 'preparando', motivo: 'plazo_vencido' }],
      error: null,
    });
    const guardado = await crearRepoCocina(cliente).deshacerEstado({
      folio: 1001,
      estado: 'preparando',
      segundosPlazo: 15,
    });
    expect(llamadas[0]).toEqual({
      funcion: 'deshacer_estado_cocina',
      parametros: { p_folio: 1001, p_estado: 'preparando', p_segundos_plazo: 15 },
    });
    expect(guardado).toEqual({ estadoActual: 'preparando', motivo: 'plazo_vencido' });
  });

  it('lanza un error si Supabase falla o la fila no tiene la forma esperada', async () => {
    const conError = clienteRpc({ data: null, error: { message: 'permission denied' } });
    await expect(
      crearRepoCocina(conError.cliente).deshacerEstado({
        folio: 1,
        estado: 'listo',
        segundosPlazo: 15,
      }),
    ).rejects.toThrow('No se pudo deshacer el cambio del pedido: permission denied');

    const filaRara = clienteRpc({ data: [{ estado_actual: 'otro', motivo: null }], error: null });
    await expect(
      crearRepoCocina(filaRara.cliente).deshacerEstado({
        folio: 1,
        estado: 'listo',
        segundosPlazo: 15,
      }),
    ).rejects.toThrow();
  });
});

describe('contrato del cambio de estado en cocina (US-11-P1)', () => {
  it('el folio de la ruta acepta solo enteros positivos escritos con dígitos', () => {
    expect(ParamsFolioCocinaSchema.parse({ folio: '1001' })).toEqual({ folio: 1001 });
    for (const folio of ['0', 'abc', '1e3', '0x10', '-1', '2147483648']) {
      expect(ParamsFolioCocinaSchema.safeParse({ folio }).success).toBe(false);
    }
  });

  it('el cuerpo de deshacer es estricto y solo acepta preparando o listo', () => {
    expect(DeshacerCambioCocinaPeticionSchema.safeParse({ estado: 'listo' }).success).toBe(true);
    expect(DeshacerCambioCocinaPeticionSchema.safeParse({ estado: 'en_cola' }).success).toBe(false);
    expect(
      DeshacerCambioCocinaPeticionSchema.safeParse({ estado: 'listo', idEmpleado: 'x' }).success,
    ).toBe(false);
  });

  it('la respuesta del cambio y el conflicto validan sus campos', () => {
    expect(
      RespuestaCambioEstadoCocinaSchema.safeParse({
        folio: 1001,
        folioTexto: '#1001',
        estado: 'en_cola',
        cambiadoEn: '2026-10-22T18:00:00.000Z',
        deshacerHasta: '2026-10-22T18:00:10.000Z',
      }).success,
    ).toBe(false);
    expect(
      ConflictoCocinaSchema.safeParse({
        error: 'x',
        codigo: 'plazo_vencido',
        estadoActual: 'entregado',
      }).success,
    ).toBe(true);
    expect(
      ConflictoCocinaSchema.safeParse({ error: 'x', codigo: 'otro', estadoActual: 'listo' })
        .success,
    ).toBe(false);
  });
});

describe('ESTADOS_COCINA (D55)', () => {
  it('no incluye esperando_pago: un pedido por transferencia no llega a cocina hasta que se pague', () => {
    expect(ESTADOS_COCINA).not.toContain('esperando_pago');
  });
});
