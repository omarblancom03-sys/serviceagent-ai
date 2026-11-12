import type {
  RespuestaPedidosCocina,
  TicketCocina,
  TicketTerminadoCocina,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  TEXTO_YA_REGRESADO,
  botonDe,
  cambioRegresado,
  erroresSinTicket,
  mensajeErrorAccion,
  proximoVencimiento,
  quitarCambio,
  quitarVencidos,
  registrarCambio,
  rutaAccion,
  segundosRestantes,
  venceEnDe,
  vistaCocina,
  type CambioLocal,
  type CambiosLocales,
  type VistaCocina,
} from '../src/lib/accionesCocina';
import { contarPedidos } from '../src/lib/avisoCocina';
import { ErrorApi } from '../src/lib/api';
import { comoTerminado, terminadosVigentes } from '../src/lib/terminadosCocina';

const ticket = (
  folio: number,
  estado: TicketCocina['estado'] = 'en_cola',
  minuto = folio - 1000,
): TicketCocina => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  estado,
  enColaDesde: new Date(Date.UTC(2026, 9, 15, 18, minuto)).toISOString(),
  renglones: [
    {
      tipo: 'platillo',
      cantidad: 1,
      nombre: 'Fajitas',
      variante: null,
      sinIngredientes: [],
      extras: [],
    },
  ],
});

const TERMINADO_EN = '2026-10-15T18:30:00.000Z';
const terminado = (folio: number, terminadoEn = TERMINADO_EN): TicketTerminadoCocina =>
  comoTerminado(ticket(folio), terminadoEn);

const AHORA = 1_000_000;

/** Por omisión, un Empezar recién tocado: en `preparando` y con Deshacer 10 s. */
const cambio = (folio: number, datos: Partial<CambioLocal> = {}): CambioLocal => ({
  folio,
  ticket: ticket(folio, 'en_cola'),
  estado: 'preparando',
  terminadoEn: null,
  venceEn: AHORA + 10_000,
  deshacer: true,
  lista: 3,
  ...datos,
});

/** Terminado en esta tablet: sin Deshacer, solo hasta que llegue una lista pedida después. */
const terminadoAqui = (folio: number): CambioLocal =>
  cambio(folio, {
    ticket: ticket(folio, 'preparando'),
    estado: 'listo',
    terminadoEn: TERMINADO_EN,
    venceEn: AHORA,
    deshacer: false,
  });

const sinCambios: CambiosLocales = new Map();
const con = (...cambios: CambioLocal[]): CambiosLocales =>
  cambios.reduce(registrarCambio, sinCambios);

const respuesta = (
  pedidos: TicketCocina[],
  terminados: TicketTerminadoCocina[] = [],
): RespuestaPedidosCocina => ({ pedidos, terminados });

const activos = (vista: VistaCocina) => vista.activos.map((v) => `${v.ticket.folio}:${v.estado}`);
const grises = (vista: VistaCocina) => vista.terminados.map((t) => t.folio);

describe('rutaAccion y botonDe', () => {
  it('arma la ruta de cada acción', () => {
    expect(rutaAccion(1001, 'empezar')).toBe('/cocina/pedidos/1001/empezar');
    expect(rutaAccion(1001, 'terminar')).toBe('/cocina/pedidos/1001/terminar');
    expect(rutaAccion(1001, 'deshacer')).toBe('/cocina/pedidos/1001/deshacer');
    expect(rutaAccion(1001, 'regresar')).toBe('/cocina/pedidos/1001/regresar');
  });

  it('Empezar en cola y Terminado al preparar', () => {
    expect(botonDe('en_cola')).toBe('empezar');
    expect(botonDe('preparando')).toBe('terminar');
  });
});

describe('venceEnDe', () => {
  const respuestaCambio = (cambiadoEn: string, deshacerHasta: string) => ({
    folio: 1001,
    folioTexto: '#1001',
    estado: 'preparando' as const,
    cambiadoEn,
    deshacerHasta,
  });

  it('usa el plazo que da la API sobre el reloj de la tablet, aunque esté desfasado', () => {
    // La hora de Postgres va una hora adelante de la tablet: solo importa la diferencia.
    const r = respuestaCambio('2026-10-15T19:00:00.000Z', '2026-10-15T19:00:10.000Z');
    expect(venceEnDe(r, AHORA)).toBe(AHORA + 10_000);
  });

  it('nunca da más de 10 s ni menos de 0', () => {
    expect(
      venceEnDe(respuestaCambio('2026-10-15T19:00:00.000Z', '2026-10-15T19:01:00.000Z'), AHORA),
    ).toBe(AHORA + 10_000);
    expect(
      venceEnDe(respuestaCambio('2026-10-15T19:00:10.000Z', '2026-10-15T19:00:00.000Z'), AHORA),
    ).toBe(AHORA);
  });

  it('con fechas que no se pueden leer, no ofrece Deshacer', () => {
    expect(venceEnDe(respuestaCambio('x', 'y'), AHORA)).toBe(AHORA);
  });
});

describe('registrarCambio y quitarCambio', () => {
  it('no modifican el mapa original', () => {
    const uno = con(cambio(1001));
    const dos = registrarCambio(uno, cambio(1002));
    expect(uno.size).toBe(1);
    expect(dos.size).toBe(2);
    expect(quitarCambio(dos, 1001).has(1001)).toBe(false);
    expect(dos.has(1001)).toBe(true);
  });

  it('Terminado tras Empezar reemplaza al cambio y se lleva su Deshacer', () => {
    const cambios = con(cambio(1001), terminadoAqui(1001));
    expect(cambios.get(1001)?.estado).toBe('listo');
    expect(cambios.get(1001)?.deshacer).toBe(false);
  });

  it('quitar un folio que no está devuelve el mismo mapa', () => {
    const cambios = con(cambio(1001));
    expect(quitarCambio(cambios, 9999)).toBe(cambios);
  });
});

describe('quitarVencidos', () => {
  it('se queda mientras no vence', () => {
    const cambios = con(cambio(1001));
    expect(quitarVencidos(cambios, AHORA + 9_999, 10)).toBe(cambios);
  });

  it('vencido y con una lista pedida después, se quita', () => {
    expect(quitarVencidos(con(cambio(1001)), AHORA + 10_000, 4).size).toBe(0);
  });

  it('vencido pero sin una lista posterior, se queda hasta que llegue', () => {
    expect(quitarVencidos(con(cambio(1001)), AHORA + 10_000, 3).size).toBe(1);
  });
});

describe('proximoVencimiento', () => {
  it('el más cercano en el futuro, o null', () => {
    const cambios = con(
      cambio(1001, { venceEn: AHORA + 8_000 }),
      cambio(1002, { venceEn: AHORA + 3_000 }),
    );
    expect(proximoVencimiento(cambios, AHORA)).toBe(AHORA + 3_000);
    expect(proximoVencimiento(cambios, AHORA + 3_000)).toBe(AHORA + 8_000);
    expect(proximoVencimiento(cambios, AHORA + 8_000)).toBeNull();
    expect(proximoVencimiento(sinCambios, AHORA)).toBeNull();
  });
});

describe('vistaCocina: cuadrícula', () => {
  it('sin cambios locales muestra la lista tal cual', () => {
    const lista = respuesta([ticket(1001), ticket(1002, 'preparando')], [terminado(1003)]);
    const vista = vistaCocina(lista, sinCambios, AHORA, 3);
    expect(activos(vista)).toEqual(['1001:en_cola', '1002:preparando']);
    expect(grises(vista)).toEqual([1003]);
  });

  it('una lista vieja (pedida antes de Empezar) no le gana al cambio local, con Deshacer', () => {
    const vista = vistaCocina(respuesta([ticket(1001)]), con(cambio(1001)), AHORA + 1_000, 3);
    expect(activos(vista)).toEqual(['1001:preparando']);
    expect(vista.activos[0]?.ticket.estado).toBe('preparando');
    expect(vista.activos[0]?.deshacerHasta).toBe(AHORA + 10_000);
  });

  it('el Deshacer de Empezar se apaga a los 10 s y manda la lista que llegue después', () => {
    const lista = respuesta([ticket(1001, 'preparando')]);
    const vista = vistaCocina(lista, con(cambio(1001)), AHORA + 10_000, 3);
    expect(vista.activos[0]?.deshacerHasta).toBeNull();
    expect(
      activos(vistaCocina(respuesta([ticket(1001)]), con(cambio(1001)), AHORA + 10_000, 4)),
    ).toEqual(['1001:en_cola']);
  });

  it('lo que regresó a la cola por Deshacer se muestra así hasta que llega una lista nueva', () => {
    const regreso = cambio(1001, { estado: 'en_cola', venceEn: AHORA, deshacer: false });
    const vieja = respuesta([ticket(1001, 'preparando')]);
    expect(activos(vistaCocina(vieja, con(regreso), AHORA + 500, 3))).toEqual(['1001:en_cola']);
    expect(vistaCocina(vieja, con(regreso), AHORA + 500, 3).activos[0]?.deshacerHasta).toBeNull();
  });
});

describe('vistaCocina: Terminado baja a los terminados recientes (US-52)', () => {
  it('al tocar Terminado sale de la cuadrícula y entra a los terminados, aunque la lista sea vieja', () => {
    const vieja = respuesta([ticket(1001), ticket(1002, 'preparando')]);
    const vista = vistaCocina(vieja, con(terminadoAqui(1002)), AHORA + 200, 3);
    expect(activos(vista)).toEqual(['1001:en_cola']);
    expect(grises(vista)).toEqual([1002]);
    expect(vista.terminados[0]?.terminadoEn).toBe(TERMINADO_EN);
    expect(vista.terminados[0]).not.toHaveProperty('estado');
  });

  it('el contador ya no lo cuenta: solo cuenta la cuadrícula', () => {
    const vieja = respuesta([ticket(1001), ticket(1002, 'preparando')], [terminado(1003)]);
    const vista = vistaCocina(vieja, con(terminadoAqui(1002)), AHORA + 200, 3);
    expect(contarPedidos(vista.activos)).toEqual({ enCola: 1, preparando: 0 });
  });

  it('si la lista también lo trae en terminados, la sección lo muestra una sola vez', () => {
    const lista = respuesta([ticket(1001)], [terminado(1002)]);
    const vista = vistaCocina(lista, con(terminadoAqui(1002)), AHORA + 200, 3);
    const enSeccion = terminadosVigentes(vista.terminados, Date.parse(TERMINADO_EN) + 60_000);
    expect(enSeccion.map((t) => t.folio)).toEqual([1002]);
  });

  it('con la lista pedida después manda la API (incluso una vieja sin terminados)', () => {
    const sinCampo = respuesta([ticket(1001)]);
    const vista = vistaCocina(sinCampo, con(terminadoAqui(1002)), AHORA + 200, 4);
    expect(activos(vista)).toEqual(['1001:en_cola']);
    expect(grises(vista)).toEqual([]);
  });
});

describe('vistaCocina: Regresar (US-52)', () => {
  it('vuelve a la cuadrícula en preparando y en su lugar, aunque la lista vieja lo traiga gris', () => {
    const vieja = respuesta([ticket(1001), ticket(1003)], [terminado(1002)]);
    const regreso = cambioRegresado(terminado(1002), AHORA, 3);
    const vista = vistaCocina(vieja, con(regreso), AHORA + 300, 3);
    expect(activos(vista)).toEqual(['1001:en_cola', '1002:preparando', '1003:en_cola']);
    expect(grises(vista)).toEqual([]);
    expect(vista.activos[1]?.deshacerHasta).toBeNull();
    expect(vista.activos[1]?.ticket.enColaDesde).toBe(ticket(1002).enColaDesde);
  });

  it('cuando llega la lista nueva, manda ella', () => {
    const regreso = cambioRegresado(terminado(1002), AHORA, 3);
    const nueva = respuesta([ticket(1001), ticket(1002, 'preparando')]);
    expect(activos(vistaCocina(nueva, con(regreso), AHORA + 300, 4))).toEqual([
      '1001:en_cola',
      '1002:preparando',
    ]);
  });

  it('cambioRegresado: sin Deshacer y solo hasta una lista posterior', () => {
    expect(cambioRegresado(terminado(1002), AHORA, 7)).toMatchObject({
      folio: 1002,
      estado: 'preparando',
      terminadoEn: null,
      venceEn: AHORA,
      deshacer: false,
      lista: 7,
    });
  });
});

describe('segundosRestantes', () => {
  it('redondea hacia arriba y nunca baja de 0', () => {
    expect(segundosRestantes(AHORA + 10_000, AHORA)).toBe(10);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 100)).toBe(10);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 9_001)).toBe(1);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 10_000)).toBe(0);
    expect(segundosRestantes(AHORA, AHORA + 5_000)).toBe(0);
  });
});

describe('mensajeErrorAccion', () => {
  const conflicto = (codigo: string, estadoActual: string, error = 'Texto de la API.') =>
    new ErrorApi(409, { error, codigo, estadoActual });

  it('409: el texto de la API, que ya viene en español', () => {
    const texto = 'El pedido #1001 ya no está en ese estado. Actualiza la lista.';
    expect(mensajeErrorAccion(conflicto('estado_cambio', 'listo', texto))).toBe(texto);
  });

  it('409 de Regresar: ya entregado, plazo vencido y cancelado, tal cual vienen', () => {
    const entregado = 'Caja ya entregó el pedido #1001.';
    expect(mensajeErrorAccion(conflicto('ya_entregado', 'entregado', entregado), 'regresar')).toBe(
      entregado,
    );
    const plazo = 'Ya pasó el tiempo para regresar el pedido #1001.';
    expect(mensajeErrorAccion(conflicto('plazo_vencido', 'listo', plazo), 'regresar')).toBe(plazo);
    const cancelado = 'El pedido #1001 se canceló.';
    expect(mensajeErrorAccion(conflicto('estado_cambio', 'cancelado', cancelado), 'regresar')).toBe(
      cancelado,
    );
  });

  it('409 de Regresar con el pedido ya en preparando: otra tablet lo regresó', () => {
    expect(mensajeErrorAccion(conflicto('estado_cambio', 'preparando'), 'regresar')).toBe(
      TEXTO_YA_REGRESADO,
    );
    // En otra acción, el mismo 409 sigue con el texto de la API.
    expect(mensajeErrorAccion(conflicto('estado_cambio', 'preparando'), 'empezar')).toBe(
      'Texto de la API.',
    );
  });

  it('409 con otra forma: texto genérico, sin códigos', () => {
    expect(mensajeErrorAccion(new ErrorApi(409, { otro: 1 }), 'regresar')).toBe(
      'El pedido ya no está en ese estado. Actualiza la lista.',
    );
  });

  it('404, 403 y cualquier otra falla', () => {
    expect(mensajeErrorAccion(new ErrorApi(404, null))).toMatch(/No encontramos/);
    expect(mensajeErrorAccion(new ErrorApi(403, null))).toMatch(/no puede cambiar/);
    const generico = 'No se pudo guardar el cambio. Revisa la conexión e intenta de nuevo.';
    expect(mensajeErrorAccion(new ErrorApi(500, null))).toBe(generico);
    expect(mensajeErrorAccion(new TypeError('Failed to fetch'), 'regresar')).toBe(generico);
  });
});

describe('erroresSinTicket', () => {
  it('solo los errores cuyo ticket ya no está, con su folio adelante', () => {
    const errores = new Map([
      [1001, { folioTexto: '#1001', texto: 'Caja ya entregó el pedido #1001.' }],
      [1002, { folioTexto: '#1002', texto: TEXTO_YA_REGRESADO }],
    ]);
    expect(erroresSinTicket(errores, new Set([1002]))).toEqual([
      { folio: 1001, texto: '#1001: Caja ya entregó el pedido #1001.' },
    ]);
    expect(erroresSinTicket(errores, new Set([1001, 1002]))).toEqual([]);
  });
});
