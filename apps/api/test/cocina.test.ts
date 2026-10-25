import { ESTADOS_COCINA, RespuestaPedidosCocinaSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoCocina } from '../src/lib/repoCocina';
import { armarTickets, type PedidoActivo } from '../src/services/cocina';

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

describe('ESTADOS_COCINA (D55)', () => {
  it('no incluye esperando_pago: un pedido por transferencia no llega a cocina hasta que se pague', () => {
    expect(ESTADOS_COCINA).not.toContain('esperando_pago');
  });
});
