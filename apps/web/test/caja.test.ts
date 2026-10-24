import type { PedidoCaja } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
  agruparPedidosCaja,
  coincideBusqueda,
  mensajeErrorCaja,
  textoHoraPedido,
  textoPago,
} from '../src/lib/caja';

const pedido = (folio: number, extra: Partial<PedidoCaja> = {}): PedidoCaja => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  telefonoFinal: '0101',
  estado: 'en_cola',
  creadoEn: '2026-10-21T18:00:00.000Z',
  estadoDesde: '2026-10-21T18:00:00.000Z',
  totalCentavos: 18800,
  totalTexto: '$188.00',
  pagado: false,
  metodosPago: [],
  ...extra,
});

const folios = (grupo: { pedidos: PedidoCaja[] } | undefined) => grupo?.pedidos.map((p) => p.folio);

describe('agruparPedidosCaja (US-20)', () => {
  it('pone los listos arriba, luego en cocina y al final entregados y cancelados', () => {
    const grupos = agruparPedidosCaja([
      pedido(1001, { estado: 'entregado' }),
      pedido(1002, { estado: 'preparando' }),
      pedido(1003, { estado: 'listo' }),
      pedido(1004, { estado: 'cancelado' }),
      pedido(1005, { estado: 'en_cola' }),
    ]);
    expect(grupos.map((g) => g.titulo)).toEqual([
      'Listos para entregar',
      'En cocina',
      'Entregados y cancelados',
    ]);
    expect(grupos.map(folios)).toEqual([[1003], [1002, 1005], [1004, 1001]]);
  });

  it('muestra los tres grupos aunque estén vacíos, y "Esperando pago" solo si hay', () => {
    expect(agruparPedidosCaja([]).map((g) => [g.id, g.pedidos.length])).toEqual([
      ['listos', 0],
      ['en_cocina', 0],
      ['cerrados', 0],
    ]);
    const conTransferencia = agruparPedidosCaja([
      pedido(1001, { estado: 'esperando_pago' }),
      pedido(1002, { estado: 'confirmado' }),
    ]);
    expect(conTransferencia.map((g) => g.id)).toEqual([
      'listos',
      'en_cocina',
      'esperando_pago',
      'cerrados',
    ]);
    expect(folios(conTransferencia[2])).toEqual([1001, 1002]);
  });

  it('listos: primero el que lleva más tiempo listo', () => {
    const [listos] = agruparPedidosCaja([
      pedido(1001, { estado: 'listo', estadoDesde: '2026-10-21T18:30:00.000Z' }),
      pedido(1002, { estado: 'listo', estadoDesde: '2026-10-21T18:20:00.000Z' }),
    ]);
    expect(folios(listos)).toEqual([1002, 1001]);
  });

  it('en cocina: del que se pidió antes al más nuevo', () => {
    const [, enCocina] = agruparPedidosCaja([
      pedido(1002, { creadoEn: '2026-10-21T18:10:00.000Z' }),
      pedido(1001, { estado: 'preparando', creadoEn: '2026-10-21T18:00:00.000Z' }),
    ]);
    expect(folios(enCocina)).toEqual([1001, 1002]);
  });

  it('cerrados: el más reciente primero', () => {
    const [, , cerrados] = agruparPedidosCaja([
      pedido(1001, { estado: 'entregado', estadoDesde: '2026-10-21T18:40:00.000Z' }),
      pedido(1002, { estado: 'expirado', estadoDesde: '2026-10-21T19:00:00.000Z' }),
    ]);
    expect(folios(cerrados)).toEqual([1002, 1001]);
  });
});

describe('coincideBusqueda (US-20)', () => {
  const p = pedido(1003, { nombreCliente: 'José Ángel Pérez' });

  it('encuentra por folio, con o sin "#", y por una parte del folio', () => {
    expect(coincideBusqueda(p, '1003')).toBe(true);
    expect(coincideBusqueda(p, '#1003')).toBe(true);
    expect(coincideBusqueda(p, '03')).toBe(true);
    expect(coincideBusqueda(p, '1004')).toBe(false);
  });

  it('encuentra por nombre sin importar acentos, mayúsculas ni el orden de las palabras', () => {
    expect(coincideBusqueda(p, 'angel')).toBe(true);
    expect(coincideBusqueda(p, 'PEREZ jose')).toBe(true);
    expect(coincideBusqueda(p, 'maria')).toBe(false);
  });

  it('una búsqueda vacía encuentra todo', () => {
    expect(coincideBusqueda(p, '   ')).toBe(true);
  });
});

describe('textoPago (US-20)', () => {
  it('pagado dice con qué', () => {
    expect(textoPago(pedido(1001, { pagado: true, metodosPago: ['tarjeta'] }))).toEqual({
      tipo: 'pagado',
      texto: 'Pagado con tarjeta',
    });
    expect(
      textoPago(pedido(1001, { pagado: true, metodosPago: ['efectivo', 'transferencia'] })).texto,
    ).toBe('Pagado con efectivo y transferencia');
  });

  it('sin pagar dice "Por cobrar", también si solo pagó una parte', () => {
    expect(textoPago(pedido(1001)).tipo).toBe('por_cobrar');
    expect(textoPago(pedido(1001, { metodosPago: ['efectivo'] })).texto).toBe('Por cobrar');
  });

  it('cancelado o expirado sin pagar ya no se cobra', () => {
    expect(textoPago(pedido(1001, { estado: 'cancelado' }))).toEqual({
      tipo: 'sin_cobro',
      texto: 'Sin cobrar',
    });
    expect(textoPago(pedido(1001, { estado: 'expirado' })).tipo).toBe('sin_cobro');
  });
});

describe('mensajeErrorCaja (US-20)', () => {
  it('con 403 dice que no tiene acceso; con lo demás, que se reintenta sola', () => {
    expect(mensajeErrorCaja(new ErrorApi(403, null))).toBe('Tu usuario no tiene acceso a caja.');
    for (const error of [new ErrorApi(500, null), new TypeError('Failed to fetch')]) {
      expect(mensajeErrorCaja(error)).toBe(
        'No se pudieron cargar los pedidos. Se vuelve a intentar sola cada 30 segundos.',
      );
    }
  });

  it('nunca muestra códigos técnicos', () => {
    expect(mensajeErrorCaja(new ErrorApi(500, { error: 'x' }))).not.toMatch(/500|error/i);
  });
});

describe('textoHoraPedido (US-20)', () => {
  const zona = 'America/Chihuahua';
  const ahora = new Date('2026-10-21T18:00:00Z'); // 21-oct 12:00 en Chihuahua

  it('de hoy solo dice la hora, en la zona del restaurante', () => {
    expect(textoHoraPedido('2026-10-21T16:36:00Z', ahora, zona)).toBe('Pidió a las 10:36');
  });

  it('de un día anterior dice también la fecha', () => {
    // 21-oct 04:40 UTC es el 20-oct a las 22:40 en Chihuahua.
    expect(textoHoraPedido('2026-10-21T04:40:00Z', ahora, zona)).toBe('Pidió el 20/10 a las 22:40');
  });
});
