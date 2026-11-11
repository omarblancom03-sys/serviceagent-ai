import {
  ConflictoCocinaSchema,
  DeshacerCambioCocinaPeticionSchema,
  ESTADOS_COCINA,
  MAX_TERMINADOS_COCINA,
  MINUTOS_REGRESAR_SERVIDOR,
  MINUTOS_TERMINADOS_RECIENTES,
  ParamsFolioCocinaSchema,
  RespuestaCambioEstadoCocinaSchema,
  RespuestaPedidosCocinaSchema,
  RespuestaRegresarCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  SEGUNDOS_DESHACER_SERVIDOR,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoCocina } from '../src/lib/repoCocina';
import {
  armarTerminados,
  armarTickets,
  cambiarEstadoCocina,
  deshacerCambioCocina,
  obtenerPedidosCocina,
  regresarPedidoCocina,
  type CocinaRepo,
  type PedidoActivo,
  type PedidoTerminado,
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
    expect(
      RespuestaPedidosCocinaSchema.safeParse({ pedidos: [ticket], terminados: [] }).success,
    ).toBe(true);
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
  regreso?: Awaited<ReturnType<CocinaRepo['regresarPedido']>>;
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
    regresarPedido: (regreso) => {
      pedidos.push(regreso);
      return Promise.resolve(respuestas.regreso ?? null);
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

const terminado = (folio: number, terminadoEn: Date): PedidoTerminado => ({
  folio,
  nombreCliente: `Cliente ${folio}`,
  enColaDesde: hora('17:30'),
  terminadoEn,
  renglones: [{ tipo: 'extra', cantidad: 1, nombre: 'Totopos' }],
});

describe('armarTerminados y obtenerPedidosCocina (US-52)', () => {
  it('ordena del más reciente al más viejo; con la misma hora, el folio mayor primero', () => {
    const tickets = armarTerminados([
      terminado(1001, hora('18:00')),
      terminado(1003, hora('18:10')),
      terminado(1002, hora('18:10')),
    ]);
    expect(tickets.map((t) => t.folio)).toEqual([1003, 1002, 1001]);
  });

  it('arma el ticket terminado según el contrato, sin estado y con terminadoEn', () => {
    const [ticket] = armarTerminados([terminado(1001, hora('18:00'))]);
    expect(ticket).toEqual({
      folio: 1001,
      folioTexto: '#1001',
      nombreCliente: 'Cliente 1001',
      enColaDesde: '2026-10-15T17:30:00.000Z',
      terminadoEn: '2026-10-15T18:00:00.000Z',
      renglones: [{ tipo: 'extra', cantidad: 1, nombre: 'Totopos' }],
    });
    expect(
      RespuestaPedidosCocinaSchema.safeParse({ pedidos: [], terminados: [ticket] }).success,
    ).toBe(true);
  });

  it(`corta en ${MAX_TERMINADOS_COCINA}: se quedan los más recientes`, () => {
    const muchos = Array.from({ length: MAX_TERMINADOS_COCINA + 3 }, (_, i) =>
      terminado(1001 + i, new Date(hora('18:00').getTime() + i * 1000)),
    );
    const tickets = armarTerminados(muchos);
    expect(tickets).toHaveLength(MAX_TERMINADOS_COCINA);
    expect(tickets[0]?.folio).toBe(1001 + MAX_TERMINADOS_COCINA + 2);
    expect(tickets.at(-1)?.folio).toBe(1004);
  });

  it('pide los terminados con los minutos y el límite del contrato, junto con los activos', async () => {
    const consultas: unknown[] = [];
    const repo: CocinaRepo = {
      ...crearCocinaEnMemoria().repo,
      leerPedidosActivos: () => Promise.resolve([pedido(1002, hora('18:05'))]),
      leerTerminados: (consulta) => {
        consultas.push(consulta);
        return Promise.resolve([terminado(1001, hora('18:00'))]);
      },
    };
    const respuesta = await obtenerPedidosCocina(repo);

    expect(consultas).toEqual([{ minutos: 15, limite: 20 }]);
    expect(MINUTOS_TERMINADOS_RECIENTES).toBe(15);
    expect(respuesta.pedidos.map((t) => t.folio)).toEqual([1002]);
    expect(respuesta.terminados.map((t) => t.folio)).toEqual([1001]);
  });

  it('si falla la lectura de los terminados, el error se propaga', async () => {
    const repo: CocinaRepo = {
      ...crearCocinaEnMemoria().repo,
      leerTerminados: () => Promise.reject(new Error('timeout')),
    };
    await expect(obtenerPedidosCocina(repo)).rejects.toThrow('timeout');
  });
});

describe('regresarPedidoCocina (US-52)', () => {
  const cambiadoEn = new Date('2026-10-22T18:05:00.123Z');

  it('manda el folio, el empleado y el plazo del servidor; responde preparando con la hora', async () => {
    const { repo, pedidos } = repoQueResponde({
      regreso: { estadoActual: 'preparando', motivo: null, cambiadoEn },
    });
    const resultado = await regresarPedidoCocina(repo, 1001, 'id-empleado');

    expect(pedidos).toEqual([{ folio: 1001, idEmpleado: 'id-empleado', minutosPlazo: 16 }]);
    expect(MINUTOS_REGRESAR_SERVIDOR).toBe(16);
    expect(resultado).toEqual({
      tipo: 'ok',
      respuesta: {
        folio: 1001,
        folioTexto: '#1001',
        estado: 'preparando',
        cambiadoEn: '2026-10-22T18:05:00.123Z',
      },
    });
    if (resultado.tipo === 'ok') {
      expect(RespuestaRegresarCocinaSchema.safeParse(resultado.respuesta).success).toBe(true);
    }
  });

  it.each([
    [
      'entregado',
      'estado_distinto',
      'ya_entregado',
      'Caja ya entregó el pedido #1001; ya no se puede regresar a preparación.',
    ],
    [
      'cancelado',
      'estado_distinto',
      'estado_cambio',
      'El pedido #1001 fue cancelado; ya no se puede regresar.',
    ],
    [
      'preparando',
      'estado_distinto',
      'estado_cambio',
      'El pedido #1001 ya no está en ese estado. Actualiza la lista.',
    ],
    [
      'listo',
      'plazo_vencido',
      'plazo_vencido',
      'Ya pasaron 15 minutos desde que se terminó el pedido #1001; ya no se puede regresar.',
    ],
  ] as const)(
    'en %s con motivo %s responde 409 %s con el texto del PO',
    async (estadoActual, motivo, codigo, error) => {
      const { repo } = repoQueResponde({ regreso: { estadoActual, motivo, cambiadoEn: null } });
      expect(await regresarPedidoCocina(repo, 1001, 'id')).toEqual({
        tipo: 'conflicto',
        conflicto: { error, codigo, estadoActual },
      });
    },
  );

  it('sin fila es que el folio no existe', async () => {
    expect(await regresarPedidoCocina(repoQueResponde({}).repo, 9999, 'id')).toEqual({
      tipo: 'no_existe',
    });
  });

  it('si la base dice que se regresó pero no trae la hora, lanza un error (500)', async () => {
    const { repo } = repoQueResponde({
      regreso: { estadoActual: 'preparando', motivo: null, cambiadoEn: null },
    });
    await expect(regresarPedidoCocina(repo, 1001, 'id')).rejects.toThrow(/hora del cambio/);
  });
});

/** Cliente falso para `leerTerminados`: `rpc()` da el corte y `from().select().in().eq()` las filas. */
function clienteTerminados(
  corte: { data: unknown; error: { message: string } | null },
  filas: { data: unknown; error: { message: string } | null } = { data: [], error: null },
) {
  const llamadas: { funcion?: string; parametros?: unknown; consulta: unknown[] } = {
    consulta: [],
  };
  const cliente = {
    rpc(funcion: string, parametros: unknown) {
      llamadas.funcion = funcion;
      llamadas.parametros = parametros;
      return Promise.resolve(corte);
    },
    from(tabla: string) {
      llamadas.consulta.push(['from', tabla]);
      return {
        select(columnas: string) {
          llamadas.consulta.push(['select', columnas]);
          return {
            in(columna: string, valores: unknown) {
              llamadas.consulta.push(['in', columna, valores]);
              return {
                eq(columnaEq: string, valor: unknown) {
                  llamadas.consulta.push(['eq', columnaEq, valor]);
                  return Promise.resolve(filas);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

const filaListo = (folio: number) => ({ ...filaPedido, folio, estado: 'listo' });
const consultaTerminados = { minutos: 15, limite: 20 };

describe('crearRepoCocina: terminados recientes y Regresar (US-52)', () => {
  it('llama a leer_terminados_cocina y lee los renglones de esos folios que siguen en listo', async () => {
    const { cliente, llamadas } = clienteTerminados(
      {
        data: [
          { folio: 1002, terminado_en: '2026-10-15T18:10:00.5+00:00' },
          { folio: 1001, terminado_en: '2026-10-15T18:05:00+00:00' },
        ],
        error: null,
      },
      { data: [filaListo(1001), filaListo(1002)], error: null },
    );
    const leidos = await crearRepoCocina(cliente).leerTerminados(consultaTerminados);

    expect(llamadas.funcion).toBe('leer_terminados_cocina');
    expect(llamadas.parametros).toEqual({ p_minutos: 15, p_limite: 20 });
    expect(llamadas.consulta).toEqual([
      ['from', 'pedidos'],
      ['select', expect.stringContaining('renglones_pedido(') as unknown],
      ['in', 'folio', [1002, 1001]],
      ['eq', 'estado', 'listo'],
    ]);
    // En el orden de la función, con su hora de Terminado y la de entrada a la cola.
    expect(leidos.map((p) => p.folio)).toEqual([1002, 1001]);
    expect(leidos[0]?.terminadoEn.toISOString()).toBe('2026-10-15T18:10:00.500Z');
    expect(leidos[0]?.enColaDesde.toISOString()).toBe('2026-10-15T18:00:00.123Z');
    expect(leidos[0]?.renglones[0]).toMatchObject({ tipo: 'platillo', nombre: 'T-Bone 450 gr' });
  });

  it('sin terminados no hace la segunda consulta', async () => {
    const { cliente, llamadas } = clienteTerminados({ data: [], error: null });
    expect(await crearRepoCocina(cliente).leerTerminados(consultaTerminados)).toEqual([]);
    expect(llamadas.consulta).toEqual([]);
  });

  it('un pedido que se regresó o entregó entre las dos consultas no se muestra', async () => {
    const { cliente } = clienteTerminados(
      {
        data: [
          { folio: 1002, terminado_en: '2026-10-15T18:10:00+00:00' },
          { folio: 1001, terminado_en: '2026-10-15T18:05:00+00:00' },
        ],
        error: null,
      },
      { data: [filaListo(1001)], error: null },
    );
    const leidos = await crearRepoCocina(cliente).leerTerminados(consultaTerminados);
    expect(leidos.map((p) => p.folio)).toEqual([1001]);
  });

  it('lanza un error si falla alguna consulta o una fila no está en listo', async () => {
    const corteFalla = clienteTerminados({ data: null, error: { message: 'timeout' } });
    await expect(
      crearRepoCocina(corteFalla.cliente).leerTerminados(consultaTerminados),
    ).rejects.toThrow('No se pudieron leer los terminados de cocina: timeout');

    const corte = {
      data: [{ folio: 1001, terminado_en: '2026-10-15T18:05:00+00:00' }],
      error: null,
    };
    const filasFallan = clienteTerminados(corte, { data: null, error: { message: 'caído' } });
    await expect(
      crearRepoCocina(filasFallan.cliente).leerTerminados(consultaTerminados),
    ).rejects.toThrow('No se pudieron leer los terminados de cocina: caído');

    const filaRara = clienteTerminados(corte, { data: [filaPedido], error: null });
    await expect(
      crearRepoCocina(filaRara.cliente).leerTerminados(consultaTerminados),
    ).rejects.toThrow();
  });

  it('llama a regresar_pedido_cocina con sus parámetros y lee motivo y hora', async () => {
    const { cliente, llamadas } = clienteRpc({
      data: [
        {
          estado_actual: 'preparando',
          motivo: null,
          cambiado_en: '2026-10-22T18:05:00.123456+00:00',
        },
      ],
      error: null,
    });
    const guardado = await crearRepoCocina(cliente).regresarPedido({
      folio: 1001,
      idEmpleado: 'id-empleado',
      minutosPlazo: 16,
    });
    expect(llamadas).toEqual([
      {
        funcion: 'regresar_pedido_cocina',
        parametros: { p_folio: 1001, p_id_empleado: 'id-empleado', p_minutos_plazo: 16 },
      },
    ]);
    expect(guardado).toEqual({
      estadoActual: 'preparando',
      motivo: null,
      cambiadoEn: new Date('2026-10-22T18:05:00.123Z'),
    });
  });

  it('Regresar: sin filas es null, el rechazo trae el estado sin hora y un error se lanza', async () => {
    const regreso = { folio: 1001, idEmpleado: 'id', minutosPlazo: 16 };
    const vacio = clienteRpc({ data: [], error: null });
    expect(await crearRepoCocina(vacio.cliente).regresarPedido(regreso)).toBeNull();

    const entregado = clienteRpc({
      data: [{ estado_actual: 'entregado', motivo: 'estado_distinto', cambiado_en: null }],
      error: null,
    });
    expect(await crearRepoCocina(entregado.cliente).regresarPedido(regreso)).toEqual({
      estadoActual: 'entregado',
      motivo: 'estado_distinto',
      cambiadoEn: null,
    });

    const conError = clienteRpc({ data: null, error: { message: 'permission denied' } });
    await expect(crearRepoCocina(conError.cliente).regresarPedido(regreso)).rejects.toThrow(
      'No se pudo regresar el pedido: permission denied',
    );
  });
});

describe('contrato de terminados recientes y Regresar (US-52)', () => {
  it('la respuesta de GET exige terminados y no acepta más del máximo', () => {
    expect(RespuestaPedidosCocinaSchema.safeParse({ pedidos: [] }).success).toBe(false);
    const ticket = armarTerminados([terminado(1001, hora('18:00'))])[0];
    const demasiados = Array.from({ length: MAX_TERMINADOS_COCINA + 1 }, () => ticket);
    expect(
      RespuestaPedidosCocinaSchema.safeParse({ pedidos: [], terminados: demasiados }).success,
    ).toBe(false);
  });

  it('la respuesta de Regresar solo acepta preparando y el conflicto acepta ya_entregado', () => {
    const base = { folio: 1001, folioTexto: '#1001', cambiadoEn: '2026-10-22T18:05:00.000Z' };
    expect(RespuestaRegresarCocinaSchema.safeParse({ ...base, estado: 'preparando' }).success).toBe(
      true,
    );
    expect(RespuestaRegresarCocinaSchema.safeParse({ ...base, estado: 'listo' }).success).toBe(
      false,
    );
    expect(
      ConflictoCocinaSchema.safeParse({
        error: 'x',
        codigo: 'ya_entregado',
        estadoActual: 'entregado',
      }).success,
    ).toBe(true);
  });
});
