import { RespuestaPedidosCajaSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoCaja } from '../src/lib/repoCaja';
import {
  armarPedidosCaja,
  inicioDelDia,
  obtenerPedidosCaja,
  type CajaRepo,
  type PedidoCajaLeido,
} from '../src/services/caja';

const t = (iso: string) => new Date(iso);

const pedido = (folio: number, extra: Partial<PedidoCajaLeido> = {}): PedidoCajaLeido => ({
  folio,
  nombreCliente: `Cliente ${folio}`,
  telefono: '6145550101',
  estado: 'en_cola',
  totalCentavos: 18800,
  creadoEn: t('2026-10-21T18:00:00Z'),
  historial: [
    { estado: 'confirmado', creadoEn: t('2026-10-21T18:00:00Z') },
    { estado: 'en_cola', creadoEn: t('2026-10-21T18:00:00Z') },
  ],
  pagos: [],
  ...extra,
});

describe('inicioDelDia (US-20)', () => {
  it('es las 00:00 de Chihuahua (UTC-6), no de UTC', () => {
    // 21-oct 23:30 en Chihuahua = 22-oct 05:30 UTC: el día sigue siendo el 21.
    expect(inicioDelDia(t('2026-10-22T05:30:00Z')).toISOString()).toBe('2026-10-21T06:00:00.000Z');
  });

  it('justo a medianoche empieza el día nuevo', () => {
    expect(inicioDelDia(t('2026-10-22T06:00:00Z')).toISOString()).toBe('2026-10-22T06:00:00.000Z');
    expect(inicioDelDia(t('2026-10-22T05:59:59Z')).toISOString()).toBe('2026-10-21T06:00:00.000Z');
  });

  it('respeta otra zona con horario de verano', () => {
    // 1-jul en Ciudad de Juárez (UTC-6 en verano): el día empieza a las 06:00 UTC.
    expect(inicioDelDia(t('2026-07-01T12:00:00Z'), 'America/Ciudad_Juarez').toISOString()).toBe(
      '2026-07-01T06:00:00.000Z',
    );
  });
});

describe('armarPedidosCaja (US-20)', () => {
  it('arma el pedido según el contrato: folio, últimos 4 dígitos y total en texto', () => {
    const [p] = armarPedidosCaja([pedido(1001)]);
    expect(p).toEqual({
      folio: 1001,
      folioTexto: '#1001',
      nombreCliente: 'Cliente 1001',
      telefonoFinal: '0101',
      estado: 'en_cola',
      creadoEn: '2026-10-21T18:00:00.000Z',
      estadoDesde: '2026-10-21T18:00:00.000Z',
      totalCentavos: 18800,
      totalTexto: '$188.00',
      pagado: false,
      metodosPago: [],
    });
    expect(RespuestaPedidosCajaSchema.safeParse({ pedidos: [p] }).success).toBe(true);
  });

  it('nunca manda el teléfono completo', () => {
    const texto = JSON.stringify(armarPedidosCaja([pedido(1001)]));
    expect(texto).not.toContain('6145550101');
  });

  it('ordena del folio menor al mayor', () => {
    const pedidos = armarPedidosCaja([pedido(1003), pedido(1001), pedido(1002)]);
    expect(pedidos.map((p) => p.folio)).toEqual([1001, 1002, 1003]);
  });

  it('está pagado solo si los pagos cubren el total', () => {
    const pago = (montoCentavos: number, metodo: 'efectivo' | 'tarjeta', hora: string) => ({
      metodo,
      montoCentavos,
      creadoEn: t(hora),
    });
    const [incompleto, exacto, conDosPagos] = armarPedidosCaja([
      pedido(1001, { pagos: [pago(10000, 'efectivo', '2026-10-21T18:10:00Z')] }),
      pedido(1002, { pagos: [pago(18800, 'tarjeta', '2026-10-21T18:10:00Z')] }),
      pedido(1003, {
        pagos: [
          pago(8800, 'tarjeta', '2026-10-21T18:12:00Z'),
          pago(10000, 'efectivo', '2026-10-21T18:10:00Z'),
        ],
      }),
    ]);
    expect(incompleto).toMatchObject({ pagado: false, metodosPago: ['efectivo'] });
    expect(exacto).toMatchObject({ pagado: true, metodosPago: ['tarjeta'] });
    expect(conDosPagos).toMatchObject({ pagado: true, metodosPago: ['efectivo', 'tarjeta'] });
  });

  it('no repite un método pagado dos veces', () => {
    const pagos = [
      { metodo: 'efectivo' as const, montoCentavos: 8800, creadoEn: t('2026-10-21T18:10:00Z') },
      { metodo: 'efectivo' as const, montoCentavos: 10000, creadoEn: t('2026-10-21T18:11:00Z') },
    ];
    const [p] = armarPedidosCaja([pedido(1001, { pagos })]);
    expect(p?.metodosPago).toEqual(['efectivo']);
  });

  it('toma la hora del estado actual del historial; si volvió a ese estado, la última', () => {
    const [p] = armarPedidosCaja([
      pedido(1001, {
        estado: 'listo',
        historial: [
          { estado: 'listo', creadoEn: t('2026-10-21T18:20:00Z') },
          { estado: 'preparando', creadoEn: t('2026-10-21T18:22:00Z') },
          { estado: 'listo', creadoEn: t('2026-10-21T18:30:00Z') },
        ],
      }),
    ]);
    expect(p?.estadoDesde).toBe('2026-10-21T18:30:00.000Z');
  });

  it('sin historial del estado actual usa la hora en que se creó', () => {
    const [p] = armarPedidosCaja([pedido(1001, { estado: 'listo', historial: [] })]);
    expect(p?.estadoDesde).toBe('2026-10-21T18:00:00.000Z');
  });
});

describe('obtenerPedidosCaja (US-20)', () => {
  it('pide al repo desde el inicio del día del restaurante', async () => {
    const pedidas: Date[] = [];
    const repo: CajaRepo = {
      leerPedidosCaja: (desde) => {
        pedidas.push(desde);
        return Promise.resolve([pedido(1001)]);
      },
    };
    const pedidos = await obtenerPedidosCaja(repo, t('2026-10-21T20:00:00Z'));
    expect(pedidas.map((d) => d.toISOString())).toEqual(['2026-10-21T06:00:00.000Z']);
    expect(pedidos).toHaveLength(1);
  });
});

/** Cliente de Supabase falso: devuelve `respuesta` y anota la consulta que se hizo. */
function clienteCon(respuesta: { data: unknown; error: { message: string } | null }) {
  const consulta: { tabla?: string; columnas?: string; filtro?: string } = {};
  const cliente = {
    from(tabla: string) {
      consulta.tabla = tabla;
      return {
        select(columnas: string) {
          consulta.columnas = columnas;
          return {
            or(filtro: string) {
              consulta.filtro = filtro;
              return Promise.resolve(respuesta);
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { cliente, consulta };
}

const fila = {
  folio: 1001,
  nombre_cliente: 'María José',
  telefono: '6145550101',
  estado: 'listo',
  total_centavos: 18800,
  creado_en: '2026-10-21T18:00:00.123456+00:00',
  historial_estado_pedido: [{ estado: 'listo', creado_en: '2026-10-21T18:30:00+00:00' }],
  pagos: [{ metodo: 'tarjeta', monto_centavos: 18800, creado_en: '2026-10-21T18:31:00+00:00' }],
};

describe('crearRepoCaja (Supabase)', () => {
  it('pide los pedidos del día o abiertos, con su historial y sus pagos', async () => {
    const { cliente, consulta } = clienteCon({ data: [], error: null });
    await crearRepoCaja(cliente).leerPedidosCaja(t('2026-10-21T06:00:00Z'));

    expect(consulta.tabla).toBe('pedidos');
    expect(consulta.filtro).toBe(
      'creado_en.gte."2026-10-21T06:00:00.000Z",' +
        'estado.in.(confirmado,esperando_pago,en_cola,preparando,listo)',
    );
    expect(consulta.columnas).toContain('historial_estado_pedido(estado, creado_en)');
    expect(consulta.columnas).toContain('pagos(metodo, monto_centavos, creado_en)');
    expect(consulta.columnas).not.toContain('renglones');
  });

  it('convierte las filas: horas como Date y montos en centavos', async () => {
    const { cliente } = clienteCon({ data: [fila], error: null });
    const [leido] = await crearRepoCaja(cliente).leerPedidosCaja(t('2026-10-21T06:00:00Z'));
    expect(leido).toEqual({
      folio: 1001,
      nombreCliente: 'María José',
      telefono: '6145550101',
      estado: 'listo',
      totalCentavos: 18800,
      creadoEn: t('2026-10-21T18:00:00.123Z'),
      historial: [{ estado: 'listo', creadoEn: t('2026-10-21T18:30:00Z') }],
      pagos: [{ metodo: 'tarjeta', montoCentavos: 18800, creadoEn: t('2026-10-21T18:31:00Z') }],
    });
  });

  it('si Supabase falla, lanza un error con su mensaje', async () => {
    const { cliente } = clienteCon({ data: null, error: { message: 'sin permiso' } });
    await expect(crearRepoCaja(cliente).leerPedidosCaja(new Date())).rejects.toThrow(
      'No se pudieron leer los pedidos de caja: sin permiso',
    );
  });

  it('rechaza una fila con un método de pago desconocido', async () => {
    const mala = { ...fila, pagos: [{ ...fila.pagos[0], metodo: 'cheque' }] };
    const { cliente } = clienteCon({ data: [mala], error: null });
    await expect(crearRepoCaja(cliente).leerPedidosCaja(new Date())).rejects.toThrow();
  });
});
