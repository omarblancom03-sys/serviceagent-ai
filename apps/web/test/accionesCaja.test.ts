import { RespuestaCobroCajaSchema, type EstadoPedido, type PedidoCaja } from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abrirCobro,
  cancelarPaso,
  cerrarError,
  crearCandadoCaja,
  crearEsperaDeLista,
  empezarGuardado,
  estadoAccionesCajaInicial,
  mandarAccionCaja,
  mensajeErrorAccionCaja,
  muestraEntregar,
  pasoVigente,
  pedirEntrega,
  podarPasos,
  puedeCobrar,
  puedeEntregar,
  terminarGuardado,
  TEXTO_RESPUESTA_INESPERADA,
} from '../src/lib/accionesCaja';
import { ErrorApi } from '../src/lib/api';

const pedido = (estado: EstadoPedido, pagado = false, folio = 1001): PedidoCaja => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  telefonoFinal: '0101',
  estado,
  creadoEn: '2026-11-12T18:00:00.000Z',
  estadoDesde: '2026-11-12T18:00:00.000Z',
  totalCentavos: 18800,
  totalTexto: '$188.00',
  pagado,
  porCobrarCentavos: pagado ? 0 : 18800,
  porCobrarTexto: pagado ? '$0.00' : '$188.00',
  metodosPago: pagado ? ['efectivo'] : [],
});

const ESTADOS: EstadoPedido[] = [
  'confirmado',
  'esperando_pago',
  'en_cola',
  'preparando',
  'listo',
  'entregado',
  'cancelado',
  'expirado',
];

describe('qué botones tiene un pedido (US-21)', () => {
  it('Cobrar: solo sin pagar y en la cola, preparándose o listo', () => {
    expect(ESTADOS.filter((estado) => puedeCobrar(pedido(estado)))).toEqual([
      'en_cola',
      'preparando',
      'listo',
    ]);
    expect(ESTADOS.filter((estado) => puedeCobrar(pedido(estado, true)))).toEqual([]);
  });

  it('Entregado: sale solo en los listos, pagados o no', () => {
    expect(ESTADOS.filter((estado) => muestraEntregar(pedido(estado)))).toEqual(['listo']);
    expect(ESTADOS.filter((estado) => muestraEntregar(pedido(estado, true)))).toEqual(['listo']);
  });

  it('Entregado solo se puede tocar si el pedido listo ya está pagado', () => {
    expect(puedeEntregar(pedido('listo'))).toBe(false);
    expect(puedeEntregar(pedido('listo', true))).toBe(true);
    expect(puedeEntregar(pedido('preparando', true))).toBe(false);
  });
});

describe('pasos de los botones de caja (US-21)', () => {
  const inicial = estadoAccionesCajaInicial();

  it('Cobrar pide el método y Cancelar regresa a los botones', () => {
    const eligiendo = abrirCobro(inicial, 1001);
    expect(eligiendo.pasos.get(1001)).toEqual({ tipo: 'eligiendo_metodo' });
    expect(cancelarPaso(eligiendo, 1001).pasos.has(1001)).toBe(false);
  });

  it('Entregado pide confirmar', () => {
    expect(pedirEntrega(inicial, 1001).pasos.get(1001)).toEqual({ tipo: 'confirmando_entrega' });
  });

  it('cada pedido lleva su propio paso', () => {
    const estado = pedirEntrega(abrirCobro(inicial, 1001), 1002);
    expect([...estado.pasos.keys()]).toEqual([1001, 1002]);
    expect(cancelarPaso(estado, 1001).pasos.get(1002)).toEqual({ tipo: 'confirmando_entrega' });
  });

  it('mientras se guarda, tocar otro botón o Cancelar no cambia nada', () => {
    const guardando = empezarGuardado(abrirCobro(inicial, 1001), 1001);
    expect(guardando.pasos.get(1001)).toEqual({ tipo: 'guardando' });
    expect(abrirCobro(guardando, 1001)).toBe(guardando);
    expect(pedirEntrega(guardando, 1001)).toBe(guardando);
    expect(cancelarPaso(guardando, 1001)).toBe(guardando);
  });

  it('al terminar bien vuelven los botones, sin error', () => {
    const terminado = terminarGuardado(empezarGuardado(inicial, 1001), 1001, null);
    expect(terminado.pasos.has(1001)).toBe(false);
    expect(terminado.errores.has(1001)).toBe(false);
  });

  it('al fallar queda el error en el pedido, y se borra al volver a tocar un botón', () => {
    const conError = terminarGuardado(empezarGuardado(inicial, 1001), 1001, 'No se pudo guardar.');
    expect(conError.errores.get(1001)).toBe('No se pudo guardar.');
    expect(abrirCobro(conError, 1001).errores.has(1001)).toBe(false);
    expect(pedirEntrega(conError, 1001).errores.has(1001)).toBe(false);
    expect(empezarGuardado(conError, 1001).errores.has(1001)).toBe(false);
  });

  it('cancelar un pedido sin paso devuelve el mismo estado', () => {
    expect(cancelarPaso(inicial, 1001).pasos.size).toBe(0);
  });
});

describe('pasoVigente (US-21)', () => {
  const inicial = estadoAccionesCajaInicial();

  it('sin paso no hay nada que pintar', () => {
    expect(pasoVigente(pedido('listo'), inicial)).toBeNull();
  });

  it('elegir método deja de valer si otra caja ya lo cobró', () => {
    const eligiendo = abrirCobro(inicial, 1001);
    expect(pasoVigente(pedido('listo'), eligiendo)).toEqual({ tipo: 'eligiendo_metodo' });
    expect(pasoVigente(pedido('listo', true), eligiendo)).toBeNull();
    expect(pasoVigente(pedido('cancelado'), eligiendo)).toBeNull();
  });

  it('confirmar la entrega deja de valer si el pedido ya no está listo y pagado', () => {
    const confirmando = pedirEntrega(inicial, 1001);
    expect(pasoVigente(pedido('listo', true), confirmando)).toEqual({
      tipo: 'confirmando_entrega',
    });
    expect(pasoVigente(pedido('entregado', true), confirmando)).toBeNull();
    expect(pasoVigente(pedido('preparando', true), confirmando)).toBeNull();
    expect(pasoVigente(pedido('listo'), confirmando)).toBeNull();
  });

  it('"Guardando" vale aunque la lista ya traiga el pedido cambiado', () => {
    const guardando = empezarGuardado(inicial, 1001);
    expect(pasoVigente(pedido('entregado', true), guardando)).toEqual({ tipo: 'guardando' });
  });
});

describe('mensajeErrorAccionCaja (US-21)', () => {
  it('en un 409 muestra el texto de la API', () => {
    const error = new ErrorApi(409, {
      error: 'El pedido #1001 ya está pagado.',
      codigo: 'ya_pagado',
      estadoActual: 'listo',
    });
    expect(mensajeErrorAccionCaja(error)).toBe('El pedido #1001 ya está pagado.');
  });

  it('un 409 con otra forma no muestra nada técnico', () => {
    expect(mensajeErrorAccionCaja(new ErrorApi(409, { detalle: 'x' }))).toBe(
      'El pedido cambió mientras tanto. Revisa cómo quedó.',
    );
  });

  it('404, 403 y lo demás', () => {
    expect(mensajeErrorAccionCaja(new ErrorApi(404, null))).toBe(
      'No encontramos ese pedido. Actualiza la lista.',
    );
    expect(mensajeErrorAccionCaja(new ErrorApi(403, null))).toBe(
      'Tu usuario no puede cobrar ni entregar pedidos.',
    );
    expect(mensajeErrorAccionCaja(new ErrorApi(500, { error: 'detalle interno' }))).toBe(
      'No se pudo guardar. Revisa la conexión e intenta de nuevo.',
    );
    expect(mensajeErrorAccionCaja(new TypeError('Failed to fetch'))).toBe(
      'No se pudo guardar. Revisa la conexión e intenta de nuevo.',
    );
  });
});

describe('revisión de Saúl al #68 (US-21-T1)', () => {
  it('cerrarError quita el aviso de ese pedido y deja los demás', () => {
    let estado = terminarGuardado(
      empezarGuardado(estadoAccionesCajaInicial(), 1001),
      1001,
      'Ya pagado',
    );
    estado = terminarGuardado(empezarGuardado(estado, 1002), 1002, 'Otro error');
    const despues = cerrarError(estado, 1001);
    expect(despues.errores.has(1001)).toBe(false);
    expect(despues.errores.get(1002)).toBe('Otro error');
  });

  it('podarPasos borra la confirmación de entrega si cocina regresó el pedido', () => {
    const estado = pedirEntrega(estadoAccionesCajaInicial(), 1001);
    const regresado = podarPasos(estado, [pedido('preparando', true)]);
    expect(regresado.pasos.has(1001)).toBe(false);
    // Cuando lo vuelve a terminar, ya no reaparece "¿Entregar…?".
    expect(pasoVigente(pedido('listo', true), regresado)).toBeNull();
  });

  it('podarPasos borra el paso de cobro si otra caja ya lo cobró', () => {
    const estado = abrirCobro(estadoAccionesCajaInicial(), 1001);
    expect(podarPasos(estado, [pedido('en_cola', true)]).pasos.has(1001)).toBe(false);
  });

  it('podarPasos borra los pasos de pedidos que ya no vienen en la lista', () => {
    const estado = pedirEntrega(estadoAccionesCajaInicial(), 1001);
    expect(podarPasos(estado, []).pasos.has(1001)).toBe(false);
  });

  it('podarPasos no toca lo que se está guardando ni los pasos que siguen valiendo', () => {
    let estado = empezarGuardado(estadoAccionesCajaInicial(), 1001);
    estado = abrirCobro(estado, 1002);
    const despues = podarPasos(estado, [
      pedido('en_cola', true, 1001),
      pedido('en_cola', false, 1002),
    ]);
    expect(despues).toBe(estado);
  });

  it('si la respuesta llegó 2xx pero no cumple el contrato, dice que sí se guardó', () => {
    const errorZod = Object.assign(new Error('contrato'), { name: 'ZodError' });
    expect(mensajeErrorAccionCaja(errorZod)).toBe(TEXTO_RESPUESTA_INESPERADA);
    expect(TEXTO_RESPUESTA_INESPERADA).toContain('Se guardó');
    expect(TEXTO_RESPUESTA_INESPERADA).not.toContain('conexión');
  });

  it('un error que llega después de cerrar el anterior sí se ve', () => {
    let estado = terminarGuardado(
      empezarGuardado(estadoAccionesCajaInicial(), 1001),
      1001,
      'Primer error',
    );
    estado = cerrarError(estado, 1001);
    estado = terminarGuardado(empezarGuardado(estado, 1001), 1001, 'Segundo error');
    expect(estado.errores.get(1001)).toBe('Segundo error');
  });

  it('una lista vieja no borra un paso recién abierto', () => {
    // La lista se pidió antes de tocar Cobrar y trae el pedido igual: el paso sigue valiendo.
    const estado = abrirCobro(estadoAccionesCajaInicial(), 1001);
    const despues = podarPasos(estado, [pedido('listo', false)]);
    expect(despues).toBe(estado);
    expect(pasoVigente(pedido('listo', false), despues)).toEqual({ tipo: 'eligiendo_metodo' });
  });

  it('un 2xx que no cumple el contrato también recarga la lista, y avisa que sí se guardó', async () => {
    let estado = abrirCobro(estadoAccionesCajaInicial(), 1001);
    const actualizar = (cambio: (previo: typeof estado) => typeof estado) => {
      estado = cambio(estado);
    };
    const orden: string[] = [];
    const candado = crearCandadoCaja();
    await mandarAccionCaja(
      1001,
      async () => {
        orden.push('pedir');
        // Lo que hace pedirApi con una respuesta 2xx de otra forma: el esquema la rechaza.
        RespuestaCobroCajaSchema.parse({ ok: true });
      },
      async () => {
        orden.push('recargar');
        expect(estado.pasos.get(1001)).toEqual({ tipo: 'guardando' });
      },
      candado,
      actualizar,
    );
    expect(orden).toEqual(['pedir', 'recargar']);
    expect(estado.pasos.has(1001)).toBe(false);
    expect(estado.errores.get(1001)).toBe(TEXTO_RESPUESTA_INESPERADA);
    expect(candado.tomar(1001)).toBe(true);
  });
});

describe('crearCandadoCaja (US-21)', () => {
  it('un pedido solo se toma una vez hasta que se suelta; otro pedido no estorba', () => {
    const candado = crearCandadoCaja();
    expect(candado.tomar(1001)).toBe(true);
    expect(candado.tomar(1001)).toBe(false);
    expect(candado.tomar(1002)).toBe(true);
    candado.soltar(1001);
    expect(candado.tomar(1001)).toBe(true);
  });
});

describe('crearEsperaDeLista (US-21)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** `true` cuando la promesa ya se resolvió, sin esperar a que lo haga. */
  async function resuelta(promesa: Promise<void>): Promise<boolean> {
    let lista = false;
    void promesa.then(() => {
      lista = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    return lista;
  }

  it('una lista que ya venía en camino no cuenta: espera a la siguiente', async () => {
    const espera = crearEsperaDeLista();
    const enCamino = espera.alEmpezar();
    const siguiente = espera.siguiente();

    espera.alTerminar(enCamino);
    expect(await resuelta(siguiente)).toBe(false);

    espera.alTerminar(espera.alEmpezar());
    expect(await resuelta(siguiente)).toBe(true);
  });

  it('sin ninguna en camino, se resuelve con la primera que se pida', async () => {
    const espera = crearEsperaDeLista();
    const siguiente = espera.siguiente();
    const numero = espera.alEmpezar();
    expect(await resuelta(siguiente)).toBe(false);
    espera.alTerminar(numero);
    expect(await resuelta(siguiente)).toBe(true);
  });

  it('varias esperas se resuelven con la misma lista', async () => {
    const espera = crearEsperaDeLista();
    const una = espera.siguiente();
    const otra = espera.siguiente();
    espera.alTerminar(espera.alEmpezar());
    expect(await resuelta(una)).toBe(true);
    expect(await resuelta(otra)).toBe(true);
  });

  it('si la lista nunca llega, se resuelve al pasar el plazo', async () => {
    vi.useFakeTimers();
    const espera = crearEsperaDeLista(10_000);
    const siguiente = espera.siguiente();
    vi.advanceTimersByTime(9_999);
    expect(await resuelta(siguiente)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await resuelta(siguiente)).toBe(true);
  });
});
