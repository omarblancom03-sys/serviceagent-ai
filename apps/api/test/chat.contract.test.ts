import {
  CODIGOS_ERROR_CHAT,
  EnviarMensajePeticionSchema,
  ErrorChatSchema,
  IdConversacionSchema,
  LIMITE_MENSAJES_CLIENTE,
  MAX_CARACTERES_MENSAJE,
  MensajeAgenteSchema,
  ParamsConversacionSchema,
  RespuestaEnviarMensajeSchema,
  RespuestaIniciarConversacionSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from '../src/index';

const mensaje = {
  id: 'msg_1',
  texto: '¡Hola! ¿Qué se te antoja hoy?',
  creadoEn: '2026-10-08T18:30:00.000Z',
};

/** Id de ejemplo: el uuid de `conversaciones_chat`, como lo genera Postgres. */
const idConversacion = crypto.randomUUID();

const respuestaEnviar = {
  mensajes: [mensaje],
  mensajesUsados: 1,
  limiteMensajes: LIMITE_MENSAJES_CLIENTE,
};

/*
 * Las respuestas no son estrictas en shared (un campo nuevo no debe romper a la web). Para
 * probar que el contrato no trae campos de herramientas, aquí se arman versiones estrictas
 * con las mismas llaves: si alguien agrega `role` o `tool_calls` al esquema, la versión
 * estricta lo admitiría y estas pruebas fallan.
 */
const MensajeEstricto = z.strictObject(MensajeAgenteSchema.shape);
const IniciarEstricto = z.strictObject({
  ...RespuestaIniciarConversacionSchema.shape,
  mensajes: z.array(MensajeEstricto),
});
const EnviarEstricto = z.strictObject({
  ...RespuestaEnviarMensajeSchema.shape,
  mensajes: z.array(MensajeEstricto),
});

/** Campos que trae Retell en sus mensajes y que nunca deben llegar al navegador. */
const camposDeRetell = [
  { role: 'agent' },
  { role: 'tool_call_invocation' },
  { tool_call_id: 'call_1' },
  { name: 'cotizar_pedido' },
  { arguments: '{"productos":[]}' },
  { content: 'texto crudo' },
  { created_timestamp: 1703302428855 },
];

describe('Contrato del chat: constantes', () => {
  it('limita a 30 mensajes del cliente y 500 caracteres por mensaje', () => {
    expect(LIMITE_MENSAJES_CLIENTE).toBe(30);
    expect(MAX_CARACTERES_MENSAJE).toBe(500);
  });
});

describe('Contrato del chat: enviar mensaje', () => {
  it('acepta un texto y le quita los espacios al inicio y al final', () => {
    expect(EnviarMensajePeticionSchema.parse({ texto: '  dos tacos  ' }).texto).toBe('dos tacos');
  });

  it('acepta 500 caracteres, contando después de recortar', () => {
    expect(() => EnviarMensajePeticionSchema.parse({ texto: 'a'.repeat(500) })).not.toThrow();
    expect(() =>
      EnviarMensajePeticionSchema.parse({ texto: `  ${'a'.repeat(500)}  ` }),
    ).not.toThrow();
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   \n\t '],
    ['de más de 500 caracteres', 'a'.repeat(501)],
  ])('rechaza un texto %s', (_, texto) => {
    expect(EnviarMensajePeticionSchema.safeParse({ texto }).success).toBe(false);
  });

  it.each([
    ['sin texto', {}],
    ['con texto numérico', { texto: 5 }],
    ['con texto null', { texto: null }],
    ['con una llave desconocida', { texto: 'hola', rol: 'sistema' }],
  ])('rechaza un cuerpo %s', (_, cuerpo) => {
    expect(EnviarMensajePeticionSchema.safeParse(cuerpo).success).toBe(false);
  });
});

describe('Contrato del chat: id de la conversación', () => {
  it.each([crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()])(
    'acepta el uuid %s',
    (id) => {
      expect(ParamsConversacionSchema.parse({ id }).id).toBe(id);
    },
  );

  it.each([
    'abc',
    '',
    '../x',
    'a/b',
    'a?b',
    'a b',
    '%2e%2e',
    'a1B2'.repeat(16),
    `${idConversacion}0`,
    `${idConversacion}\n`,
    ` ${idConversacion}`,
  ])('rechaza el id %j', (id) => {
    expect(IdConversacionSchema.safeParse(id).success).toBe(false);
  });
});

describe('Contrato del chat: respuestas', () => {
  it('acepta iniciar una conversación sin mensajes del agente', () => {
    const r = RespuestaIniciarConversacionSchema.parse({
      conversacionId: idConversacion,
      mensajes: [],
      mensajesUsados: 0,
      limiteMensajes: LIMITE_MENSAJES_CLIENTE,
    });
    expect(r.mensajes).toEqual([]);
  });

  it('acepta iniciar una conversación con el saludo del agente', () => {
    const r = RespuestaIniciarConversacionSchema.parse({
      conversacionId: idConversacion,
      mensajes: [mensaje],
      mensajesUsados: 0,
      limiteMensajes: LIMITE_MENSAJES_CLIENTE,
    });
    expect(r.mensajes[0]?.texto).toMatch(/Hola/);
  });

  it('rechaza un conversacionId con caracteres de ruta', () => {
    expect(
      RespuestaIniciarConversacionSchema.safeParse({
        conversacionId: '../x',
        mensajes: [],
        mensajesUsados: 0,
        limiteMensajes: 30,
      }).success,
    ).toBe(false);
  });

  it('acepta la respuesta de un mensaje, también al llegar justo al límite', () => {
    expect(RespuestaEnviarMensajeSchema.parse(respuestaEnviar).mensajesUsados).toBe(1);
    expect(() =>
      RespuestaEnviarMensajeSchema.parse({ ...respuestaEnviar, mensajesUsados: 30 }),
    ).not.toThrow();
  });

  it.each([
    ['mensajesUsados mayor que el límite', { mensajesUsados: 31 }],
    ['mensajesUsados negativo', { mensajesUsados: -1 }],
    ['mensajesUsados con decimales', { mensajesUsados: 1.5 }],
    ['limiteMensajes en 0', { limiteMensajes: 0, mensajesUsados: 0 }],
  ])('rechaza %s', (_, cambio) => {
    expect(RespuestaEnviarMensajeSchema.safeParse({ ...respuestaEnviar, ...cambio }).success).toBe(
      false,
    );
  });

  it.each([
    ['en milisegundos, como lo da Retell', 1703302428855],
    ['sin zona horaria', '2026-10-08T18:30:00'],
    ['en texto libre', 'hace un momento'],
  ])('rechaza creadoEn %s', (_, creadoEn) => {
    expect(MensajeAgenteSchema.safeParse({ ...mensaje, creadoEn }).success).toBe(false);
  });
});

describe('Contrato del chat: sin campos de herramientas', () => {
  it('las respuestas de ejemplo pasan con los esquemas estrictos', () => {
    expect(() => EnviarEstricto.parse(respuestaEnviar)).not.toThrow();
    expect(() =>
      IniciarEstricto.parse({
        conversacionId: idConversacion,
        ...respuestaEnviar,
        mensajesUsados: 0,
      }),
    ).not.toThrow();
  });

  it('el mensaje solo tiene id, texto y creadoEn', () => {
    expect(Object.keys(MensajeAgenteSchema.shape).sort()).toEqual(['creadoEn', 'id', 'texto']);
  });

  it.each(camposDeRetell)('un mensaje no admite %o', (campo) => {
    expect(MensajeEstricto.safeParse({ ...mensaje, ...campo }).success).toBe(false);
    expect(
      EnviarEstricto.safeParse({ ...respuestaEnviar, mensajes: [{ ...mensaje, ...campo }] })
        .success,
    ).toBe(false);
  });

  it.each([
    { message_with_tool_calls: [] },
    { transcript: 'Agent: hola' },
    { chat_status: 'ongoing' },
    { tool_calls: [] },
  ])('la respuesta no admite %o', (campo) => {
    expect(EnviarEstricto.safeParse({ ...respuestaEnviar, ...campo }).success).toBe(false);
    expect(
      IniciarEstricto.safeParse({
        conversacionId: idConversacion,
        ...respuestaEnviar,
        mensajesUsados: 0,
        ...campo,
      }).success,
    ).toBe(false);
  });
});

describe('Contrato del chat: errores', () => {
  it('tiene exactamente los cinco códigos acordados', () => {
    expect([...CODIGOS_ERROR_CHAT].sort()).toEqual([
      'conversacion_no_encontrada',
      'conversacion_terminada',
      'limite_alcanzado',
      'peticion_invalida',
      'servicio_no_disponible',
    ]);
  });

  it.each(CODIGOS_ERROR_CHAT)('acepta el código %s', (codigo) => {
    expect(ErrorChatSchema.parse({ error: 'Texto para el cliente.', codigo }).codigo).toBe(codigo);
  });

  it('rechaza un código desconocido, sin código o sin texto', () => {
    expect(ErrorChatSchema.safeParse({ error: 'x', codigo: 'retell_401' }).success).toBe(false);
    expect(ErrorChatSchema.safeParse({ error: 'x' }).success).toBe(false);
    expect(ErrorChatSchema.safeParse({ error: '', codigo: 'peticion_invalida' }).success).toBe(
      false,
    );
  });
});

describe('Documentación del chat', () => {
  it('publica las dos rutas del chat en el OpenAPI con sus estados exactos', async () => {
    const res = await app.request('/openapi.json');

    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
    };
    expect(Object.keys(doc.paths['/chat/conversaciones']?.post?.responses ?? {})).toEqual([
      '201',
      '503',
    ]);
    expect(
      Object.keys(doc.paths['/chat/conversaciones/{id}/mensajes']?.post?.responses ?? {}),
    ).toEqual(['200', '400', '404', '409', '429', '503']);
  });
});
