import {
  LIMITE_MENSAJES_CLIENTE,
  MAX_CARACTERES_MENSAJE,
  type ErrorChat,
  type MensajeAgente,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
  MENSAJE_NO_DISPONIBLE,
  MENSAJE_PETICION_INVALIDA,
  MENSAJE_TERMINADA,
  MENSAJE_TOPE_DIARIO,
  SALUDO,
  botonesRapidosVisibles,
  clasificarErrorChat,
  estadoInicial,
  mensajeLimite,
  puedeEscribir,
  reducirChat,
  validarTexto,
  type AccionChat,
  type EstadoChat,
} from '../src/lib/chat';

const ID = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c';

function mensaje(id: string, texto: string): MensajeAgente {
  return { id, texto, creadoEn: '2026-10-12T18:00:00.000Z' };
}

function errorApi(status: number, cuerpo: ErrorChat | null): ErrorApi {
  return new ErrorApi(status, cuerpo);
}

function aplicar(...acciones: AccionChat[]): EstadoChat {
  return acciones.reduce(reducirChat, estadoInicial());
}

const creada: AccionChat = {
  tipo: 'conversacionCreada',
  conversacionId: ID,
  mensajes: [],
  mensajesUsados: 0,
  limiteMensajes: 30,
};

const respuesta = (usados: number, limite = 30): AccionChat => ({
  tipo: 'respuesta',
  mensajes: [mensaje('m1', 'Claro, ¿qué te gustaría?')],
  mensajesUsados: usados,
  limiteMensajes: limite,
});

const noDisponible: AccionChat = {
  tipo: 'fallo',
  falla: clasificarErrorChat(new TypeError('Failed to fetch'), 'enviar', 30),
};

describe('estado del chat', () => {
  it('empieza con el saludo local, sin conversación, en 0 y con el límite del contrato', () => {
    const estado = estadoInicial();
    expect(estado.burbujas).toEqual([{ id: 'saludo', autor: 'asistente', texto: SALUDO }]);
    expect(estado.conversacionId).toBeNull();
    expect(estado.mensajesUsados).toBe(0);
    expect(estado.limiteMensajes).toBe(LIMITE_MENSAJES_CLIENTE);
    expect(estado.fase).toBe('listo');
    expect(puedeEscribir(estado)).toBe(true);
    expect(botonesRapidosVisibles(estado)).toBe(true);
  });

  it('al enviar, la burbuja del cliente aparece de inmediato y se bloquea la caja', () => {
    const estado = aplicar({ tipo: 'enviar', texto: 'Ver menú' });
    expect(estado.burbujas.at(-1)).toEqual({
      id: 'cliente-1',
      autor: 'cliente',
      texto: 'Ver menú',
    });
    expect(estado.fase).toBe('enviando');
    expect(estado.pendiente).toBe('Ver menú');
    expect(puedeEscribir(estado)).toBe(false);
  });

  it('los botones rápidos se ocultan después del primer mensaje y no vuelven', () => {
    const estado = aplicar({ tipo: 'enviar', texto: 'Quiero pedir' }, creada, respuesta(1));
    expect(botonesRapidosVisibles(estado)).toBe(false);
  });

  it('no se puede enviar dos veces mientras espera respuesta', () => {
    const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, { tipo: 'enviar', texto: 'otra' });
    expect(estado.burbujas.filter((b) => b.autor === 'cliente')).toHaveLength(1);
  });

  it('con la respuesta exitosa guarda el id, agrega lo del agente y actualiza el contador', () => {
    const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, respuesta(1));
    expect(estado.conversacionId).toBe(ID);
    expect(estado.burbujas.at(-1)).toEqual({
      id: 'm1',
      autor: 'asistente',
      texto: 'Claro, ¿qué te gustaría?',
    });
    expect(estado.mensajesUsados).toBe(1);
    expect(estado.fase).toBe('listo');
    expect(estado.pendiente).toBeNull();
    expect(estado.aviso).toBeNull();
  });

  it('si la respuesta llega al límite pasa a limite con el mismo aviso que el 429', () => {
    const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, respuesta(30));
    expect(estado.fase).toBe('limite');
    expect(estado.aviso).toEqual({ mensaje: mensajeLimite(30), accion: 'iniciar_otra' });
    expect(estado.aviso?.mensaje).toBe(
      'Llegaste al límite de 30 mensajes de esta conversación. Puedes iniciar otra.',
    );
    expect(puedeEscribir(estado)).toBe(false);
  });

  it('en error la caja queda bloqueada y Reintentar reenvía sin duplicar la burbuja', () => {
    const conError = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, noDisponible);
    expect(conError.fase).toBe('error');
    expect(conError.aviso?.accion).toBe('reintentar');
    expect(conError.pendiente).toBe('hola');
    expect(puedeEscribir(conError)).toBe(false);

    const reintento = reducirChat(conError, { tipo: 'reintentar' });
    expect(reintento.fase).toBe('enviando');
    expect(reintento.aviso).toBeNull();
    expect(reintento.burbujas).toEqual(conError.burbujas);
    expect(reintento.conversacionId).toBe(ID);
  });

  it('si falló la creación, Reintentar sigue sin conversación para volver a crearla', () => {
    const conError = aplicar({ tipo: 'enviar', texto: 'hola' }, noDisponible);
    const reintento = reducirChat(conError, { tipo: 'reintentar' });
    expect(reintento.conversacionId).toBeNull();
    expect(reintento.pendiente).toBe('hola');
  });

  it('Reintentar no hace nada fuera de la fase error', () => {
    const estado = estadoInicial();
    expect(reducirChat(estado, { tipo: 'reintentar' })).toBe(estado);
  });

  it('409 y 404 pasan a terminada y sin texto pendiente', () => {
    for (const codigo of ['conversacion_terminada', 'conversacion_no_encontrada'] as const) {
      const falla = clasificarErrorChat(
        errorApi(codigo === 'conversacion_terminada' ? 409 : 404, { error: 'x', codigo }),
        'enviar',
        30,
      );
      const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, { tipo: 'fallo', falla });
      expect(estado.fase).toBe('terminada');
      expect(estado.pendiente).toBeNull();
      expect(puedeEscribir(estado)).toBe(false);
    }
  });

  it('Iniciar otra vuelve al saludo con los botones rápidos y sin conversación', () => {
    const terminada = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, respuesta(1), {
      tipo: 'fallo',
      falla: clasificarErrorChat(
        errorApi(409, { error: 'x', codigo: 'conversacion_terminada' }),
        'enviar',
        30,
      ),
    });
    const nueva = reducirChat(terminada, { tipo: 'iniciarOtra' });
    expect(nueva).toEqual(estadoInicial());
    expect(botonesRapidosVisibles(nueva)).toBe(true);
  });

  it('429 pasa a limite, deja el contador en el límite y bloquea la caja', () => {
    const falla = clasificarErrorChat(
      errorApi(429, { error: 'x', codigo: 'limite_alcanzado' }),
      'enviar',
      30,
    );
    const estado = aplicar(
      { tipo: 'enviar', texto: 'hola' },
      creada,
      respuesta(5),
      {
        tipo: 'enviar',
        texto: 'otra',
      },
      { tipo: 'fallo', falla },
    );
    expect(estado.fase).toBe('limite');
    expect(estado.aviso).toEqual({ mensaje: mensajeLimite(30), accion: 'iniciar_otra' });
    expect(estado.mensajesUsados).toBe(30);
    expect(puedeEscribir(estado)).toBe(false);
  });

  it('Iniciar otra desde el límite vuelve al estado inicial', () => {
    const enLimite = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, respuesta(30));
    expect(enLimite.fase).toBe('limite');
    const nueva = reducirChat(enLimite, { tipo: 'iniciarOtra' });
    expect(nueva).toEqual(estadoInicial());
    expect(puedeEscribir(nueva)).toBe(true);
  });

  it('el tope diario bloquea la caja y no ofrece Reintentar', () => {
    const falla = clasificarErrorChat(
      errorApi(503, { error: MENSAJE_TOPE_DIARIO, codigo: 'servicio_no_disponible' }),
      'crear',
      30,
    );
    const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, { tipo: 'fallo', falla });
    expect(estado.fase).toBe('tope_diario');
    expect(estado.pendiente).toBeNull();
    expect(puedeEscribir(estado)).toBe(false);
  });

  it('400 deja escribir de nuevo con un aviso genérico', () => {
    const falla = clasificarErrorChat(
      errorApi(400, { error: 'x', codigo: 'peticion_invalida' }),
      'enviar',
      30,
    );
    const estado = aplicar({ tipo: 'enviar', texto: 'hola' }, creada, { tipo: 'fallo', falla });
    expect(estado.fase).toBe('listo');
    expect(estado.aviso?.mensaje).toBe(MENSAJE_PETICION_INVALIDA);
    expect(puedeEscribir(estado)).toBe(true);
  });
});

describe('clasificarErrorChat', () => {
  const reintentar = {
    fase: 'error',
    aviso: { mensaje: MENSAJE_NO_DISPONIBLE, accion: 'reintentar' },
  };

  it('error de red: no disponible con Reintentar', () => {
    expect(clasificarErrorChat(new TypeError('Failed to fetch'), 'crear', 30)).toEqual(reintentar);
  });

  it('respuesta fuera de contrato (ZodError): no disponible con Reintentar', () => {
    const zod = Object.assign(new Error('formato'), { name: 'ZodError' });
    expect(clasificarErrorChat(zod, 'enviar', 30)).toEqual(reintentar);
  });

  it('503 de Retell al crear o al enviar: no disponible con Reintentar, sin códigos HTTP', () => {
    const cuerpo: ErrorChat = {
      error: 'El chat no está disponible en este momento. Intenta de nuevo en unos minutos.',
      codigo: 'servicio_no_disponible',
    };
    expect(clasificarErrorChat(errorApi(503, cuerpo), 'crear', 30)).toEqual(reintentar);
    expect(clasificarErrorChat(errorApi(503, cuerpo), 'enviar', 30)).toEqual(reintentar);
    expect(MENSAJE_NO_DISPONIBLE).not.toMatch(/\d{3}/);
  });

  it('503 con el texto del tope diario al crear: tope diario sin Reintentar', () => {
    const cuerpo: ErrorChat = { error: MENSAJE_TOPE_DIARIO, codigo: 'servicio_no_disponible' };
    expect(clasificarErrorChat(errorApi(503, cuerpo), 'crear', 30)).toEqual({
      fase: 'tope_diario',
      aviso: { mensaje: MENSAJE_TOPE_DIARIO, accion: 'ninguna' },
    });
  });

  it('el tope se reconoce sin importar acentos ni mayúsculas', () => {
    const cuerpo: ErrorChat = {
      error: 'EL CHAT LLEGO A SU LIMITE DE HOY.',
      codigo: 'servicio_no_disponible',
    };
    expect(clasificarErrorChat(errorApi(503, cuerpo), 'crear', 30).fase).toBe('tope_diario');
  });

  it('el mismo texto al enviar no es tope diario (el tope solo ocurre al crear)', () => {
    const cuerpo: ErrorChat = { error: MENSAJE_TOPE_DIARIO, codigo: 'servicio_no_disponible' };
    expect(clasificarErrorChat(errorApi(503, cuerpo), 'enviar', 30)).toEqual(reintentar);
  });

  it('503 sin cuerpo válido: no disponible con Reintentar', () => {
    expect(clasificarErrorChat(errorApi(503, null), 'crear', 30)).toEqual(reintentar);
  });

  it('409 y 404: conversación terminada con Iniciar otra', () => {
    const esperado = {
      fase: 'terminada',
      aviso: { mensaje: MENSAJE_TERMINADA, accion: 'iniciar_otra' },
    };
    expect(
      clasificarErrorChat(
        errorApi(409, { error: 'x', codigo: 'conversacion_terminada' }),
        'enviar',
        30,
      ),
    ).toEqual(esperado);
    expect(
      clasificarErrorChat(
        errorApi(404, { error: 'x', codigo: 'conversacion_no_encontrada' }),
        'enviar',
        30,
      ),
    ).toEqual(esperado);
  });

  it('429: el aviso usa limiteMensajes de la API, no un 30 fijo', () => {
    const falla = clasificarErrorChat(
      errorApi(429, { error: 'x', codigo: 'limite_alcanzado' }),
      'enviar',
      12,
    );
    expect(falla).toEqual({
      fase: 'limite',
      aviso: { mensaje: mensajeLimite(12), accion: 'iniciar_otra' },
    });
    expect(falla.aviso.mensaje).toContain('12');
    expect(falla.aviso.mensaje).not.toContain('30');
  });

  it('400: aviso genérico sin Reintentar', () => {
    expect(
      clasificarErrorChat(errorApi(400, { error: 'x', codigo: 'peticion_invalida' }), 'enviar', 30),
    ).toEqual({ fase: 'listo', aviso: { mensaje: MENSAJE_PETICION_INVALIDA, accion: 'ninguna' } });
  });

  it('un estado inesperado sin código conocido: no disponible con Reintentar', () => {
    expect(clasificarErrorChat(errorApi(500, null), 'enviar', 30)).toEqual(reintentar);
  });
});

describe('validarTexto', () => {
  it('recorta los espacios', () => {
    expect(validarTexto('  hola  ')).toEqual({ ok: true, texto: 'hola' });
  });

  it('rechaza el texto vacío o solo con espacios', () => {
    expect(validarTexto('').ok).toBe(false);
    expect(validarTexto('   \n ').ok).toBe(false);
  });

  it('acepta exactamente el máximo y rechaza uno más', () => {
    expect(validarTexto('a'.repeat(MAX_CARACTERES_MENSAJE)).ok).toBe(true);
    const largo = validarTexto('a'.repeat(MAX_CARACTERES_MENSAJE + 1));
    expect(largo.ok).toBe(false);
    if (!largo.ok) expect(largo.mensaje).toContain(String(MAX_CARACTERES_MENSAJE));
  });

  it('mide después de recortar', () => {
    expect(validarTexto(`  ${'a'.repeat(MAX_CARACTERES_MENSAJE)}  `).ok).toBe(true);
  });
});
