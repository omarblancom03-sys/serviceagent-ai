import {
  ErrorChatSchema,
  LIMITE_MENSAJES_CLIENTE,
  RespuestaEnviarMensajeSchema,
  RespuestaIniciarConversacionSchema,
} from '@serviceagent/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { crearApp } from '../src/index';
import type { FallaRetell } from '../src/services/chat';
import {
  crearChatRepoEnMemoria,
  crearRetellFalso,
  mensajeRetell,
  mensajesDeHerramientas,
} from './chatEnMemoria';
import { crearRepoEnMemoria } from './repoEnMemoria';

const LLAVE = 'LLAVE_RETELL_DE_PRUEBA_NO_DEBE_SALIR';
const TEXTO = 'TEXTO_DEL_CLIENTE_NO_DEBE_SALIR';

const env = {
  SUPABASE_URL: 'http://no-se-usa-en-tests',
  SUPABASE_SERVICE_ROLE_KEY: 'no-se-usa-en-tests',
  JWT_SECRET: 'secreto-de-prueba-con-al-menos-32-caracteres',
  PIN_PEPPER: 'pepper-de-prueba-con-al-menos-32-caracteres',
  RETELL_API_KEY: LLAVE,
  RETELL_AGENT_ID: 'agent_de_prueba',
};

/** Versiones estrictas: si la API agrega un campo de Retell a la respuesta, fallan. */
const MensajeEstricto = z.strictObject({ id: z.string(), texto: z.string(), creadoEn: z.string() });
const IniciarEstricto = z.strictObject({
  conversacionId: z.string(),
  mensajes: z.array(MensajeEstricto),
  mensajesUsados: z.number(),
  limiteMensajes: z.number(),
});
const EnviarEstricto = IniciarEstricto.omit({ conversacionId: true });
const ErrorEstricto = z.strictObject(ErrorChatSchema.shape);

let enMemoria: ReturnType<typeof crearChatRepoEnMemoria>;
let falso: ReturnType<typeof crearRetellFalso>;
let llavesRecibidas: string[];
let app: ReturnType<typeof crearApp>;

beforeEach(() => {
  enMemoria = crearChatRepoEnMemoria();
  falso = crearRetellFalso();
  llavesRecibidas = [];
  app = crearApp({
    crearRepoChat: () => enMemoria.repo,
    crearClienteRetell: (llave) => {
      llavesRecibidas.push(llave);
      return falso.retell;
    },
  });
});

/*
 * Todas las respuestas y todos los logs de cada prueba: al final se revisa que nunca salga la
 * llave ni el chat_id (en respuestas) ni la llave, el texto del cliente o el chat_id (en logs).
 */
let cuerpos: string[] = [];
let escritos: unknown[][] = [];
beforeEach(() => {
  cuerpos = [];
  escritos = [];
  const guardar = (...args: unknown[]) => {
    escritos.push(args);
  };
  vi.spyOn(console, 'warn').mockImplementation(guardar);
  vi.spyOn(console, 'error').mockImplementation(guardar);
  vi.spyOn(console, 'log').mockImplementation(guardar);
});

const textoDeLogs = () =>
  escritos
    .flat()
    .map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : JSON.stringify(a)))
    .join('\n');

async function pedir(ruta: string, init: RequestInit, entorno: Record<string, string> = env) {
  const res = await app.request(ruta, init, entorno);
  const texto = await res.text();
  cuerpos.push(texto);
  return { status: res.status, cuerpo: texto === '' ? null : (JSON.parse(texto) as unknown) };
}

const iniciar = (entorno?: Record<string, string>) =>
  pedir('/chat/conversaciones', { method: 'POST' }, entorno);

const enviar = (id: string, cuerpo: unknown, entorno?: Record<string, string>) =>
  pedir(
    `/chat/conversaciones/${id}/mensajes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    },
    entorno,
  );

async function conversacionAbierta() {
  const { status, cuerpo } = await iniciar();
  expect(status).toBe(201);
  return RespuestaIniciarConversacionSchema.parse(cuerpo).conversacionId;
}

const fallaRetell = (falla: FallaRetell, status?: number) => () =>
  ({ ok: false, falla, status }) as const;

afterEach(() => {
  vi.restoreAllMocks();
  for (const cuerpo of cuerpos) {
    expect(cuerpo).not.toContain(LLAVE);
    expect(cuerpo).not.toContain('CHAT_SECRETO');
  }
  const logs = textoDeLogs();
  expect(logs).not.toContain(LLAVE);
  expect(logs).not.toContain(TEXTO);
  expect(logs).not.toContain('CHAT_SECRETO');
});

describe('POST /chat/conversaciones', () => {
  it('abre la conversación: uuid propio, saludo del agente, 0 usados y límite 30', async () => {
    const { status, cuerpo } = await iniciar();

    expect(status).toBe(201);
    const r = IniciarEstricto.parse(RespuestaIniciarConversacionSchema.parse(cuerpo));
    expect(r.conversacionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.mensajes.map((m) => m.texto)).toEqual(['¡Hola! ¿Qué se te antoja hoy?']);
    expect(r.mensajesUsados).toBe(0);
    expect(r.limiteMensajes).toBe(LIMITE_MENSAJES_CLIENTE);
    expect(falso.llamadas.crearChat).toEqual(['agent_de_prueba']);
    expect(llavesRecibidas).toEqual([LLAVE]);
    expect(enMemoria.filas.get(r.conversacionId)?.chatIdRetell).toBe('CHAT_SECRETO_1');
  });

  it('filtra los mensajes iniciales de herramientas y responde vacío si no hay del agente', async () => {
    falso.respuestas.crearChat = () => ({
      ok: true,
      datos: { chatId: 'CHAT_SECRETO_X', estado: 'ongoing', mensajes: mensajesDeHerramientas },
    });

    const { status, cuerpo } = await iniciar();

    expect(status).toBe(201);
    expect(IniciarEstricto.parse(cuerpo).mensajes).toEqual([]);
  });

  it('completa el id y la hora de un saludo que Retell manda sin ellos', async () => {
    falso.respuestas.crearChat = () => ({
      ok: true,
      datos: {
        chatId: 'CHAT_SECRETO_X',
        estado: 'ongoing',
        mensajes: [mensajeRetell('agent', 'Hola', null, null)],
      },
    });
    const antes = Date.now();

    const { status, cuerpo } = await iniciar();

    expect(status).toBe(201);
    const [saludo] = RespuestaIniciarConversacionSchema.parse(cuerpo).mensajes;
    expect(saludo?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(saludo?.creadoEn ?? '')).toBeGreaterThanOrEqual(antes - 1000);
  });

  it.each([
    ['RETELL_API_KEY', { RETELL_API_KEY: '' }],
    ['RETELL_AGENT_ID', { RETELL_AGENT_ID: '  ' }],
  ])(
    'sin %s responde 503 antes de abrir la conversación (no gasta tope ni llama a Retell)',
    async (_, faltante) => {
      const { status, cuerpo } = await iniciar({ ...env, ...faltante });

      expect(status).toBe(503);
      expect(ErrorEstricto.parse(cuerpo).codigo).toBe('servicio_no_disponible');
      expect(enMemoria.llamadas.abrir).toBe(0);
      expect(falso.llamadas.crearChat).toEqual([]);
    },
  );

  it('sin RETELL_AGENT_ID en el entorno (variable ausente) tampoco abre', async () => {
    const sinAgente: Record<string, string> = { ...env };
    delete sinAgente.RETELL_AGENT_ID;
    expect((await iniciar(sinAgente)).status).toBe(503);
    expect(enMemoria.llamadas.abrir).toBe(0);
  });

  it('al llegar al tope diario responde 503 con otro texto y sin llamar a Retell', async () => {
    // La primera apertura falla en Retell: gasta su lugar (D39) y da el texto de "no disponible".
    const creaBien = falso.respuestas.crearChat;
    falso.respuestas.crearChat = fallaRetell('incierta', 500);
    const noDisponible = await iniciar();
    falso.respuestas.crearChat = creaBien;
    expect((await iniciar()).status).toBe(201);
    expect((await iniciar()).status).toBe(201);
    const llamadasAntes = falso.llamadas.crearChat.length;

    const tope = await iniciar();

    expect(tope.status).toBe(503);
    const error = ErrorEstricto.parse(tope.cuerpo);
    expect(error.codigo).toBe('servicio_no_disponible');
    expect(error.error).toBe('El chat llegó a su límite de hoy. Intenta de nuevo mañana.');
    expect(error.error).not.toBe(ErrorChatSchema.parse(noDisponible.cuerpo).error);
    expect(falso.llamadas.crearChat).toHaveLength(llamadasAntes);
  });

  it.each([
    ['rechazo', 'rechazo', 402],
    ['sin conexión', 'sin_conexion', undefined],
    ['timeout', 'timeout', undefined],
    ['5xx', 'incierta', 500],
  ] as const)(
    'si Retell falla al abrir (%s) termina la conversación y responde 503; el lugar queda gastado',
    async (_, falla, status) => {
      falso.respuestas.crearChat = fallaRetell(falla, status);

      const { status: http, cuerpo } = await iniciar();

      expect(http).toBe(503);
      expect(ErrorEstricto.parse(cuerpo).codigo).toBe('servicio_no_disponible');
      expect(enMemoria.llamadas.terminar).toHaveLength(1);
      const [fila] = [...enMemoria.filas.values()];
      expect(fila?.terminadaEn).not.toBeNull();
    },
  );

  it('si Retell crea un chat que no está activo, lo trata como falla', async () => {
    falso.respuestas.crearChat = () => ({
      ok: true,
      datos: { chatId: 'CHAT_SECRETO_X', estado: 'error', mensajes: [] },
    });

    expect((await iniciar()).status).toBe(503);
    expect(enMemoria.llamadas.terminar).toHaveLength(1);
  });

  it('si no se puede asociar el chat de Retell, termina y responde 503', async () => {
    enMemoria.repo.asociarChatRetell = async () => false;

    expect((await iniciar()).status).toBe(503);
    expect(enMemoria.llamadas.terminar).toHaveLength(1);
  });

  it('si falla la base al abrir, responde 503 sin llamar a Retell', async () => {
    enMemoria.repo.abrir = async () => {
      throw new Error('Falló abrir_conversacion_chat (código 08006)');
    };

    expect((await iniciar()).status).toBe(503);
    expect(falso.llamadas.crearChat).toEqual([]);
  });
});

describe('POST /chat/conversaciones/{id}/mensajes', () => {
  it('responde solo los mensajes del agente, con la hora en ISO, y cuenta el mensaje', async () => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = () => ({
      ok: true,
      datos: {
        mensajes: [
          ...mensajesDeHerramientas,
          mensajeRetell('agent', 'Son $403.00', 'msg_1', 1_791_000_000_000),
          mensajeRetell('agent', '', 'msg_vacio'),
          mensajeRetell('agent', '¿Algo más?', 'msg_2', 1_791_000_001_500),
        ],
      },
    });

    const { status, cuerpo } = await enviar(id, { texto: `  ${TEXTO}  ` });

    expect(status).toBe(200);
    expect(EnviarEstricto.parse(RespuestaEnviarMensajeSchema.parse(cuerpo))).toEqual({
      mensajes: [
        { id: 'msg_1', texto: 'Son $403.00', creadoEn: '2026-10-03T04:00:00.000Z' },
        { id: 'msg_2', texto: '¿Algo más?', creadoEn: '2026-10-03T04:00:01.500Z' },
      ],
      mensajesUsados: 1,
      limiteMensajes: 30,
    });
    expect(falso.llamadas.enviarMensaje).toEqual([{ chatId: 'CHAT_SECRETO_1', texto: TEXTO }]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/tool_call|cotizar_pedido|totalCentavos|role/);
  });

  it('si Retell no trae ningún mensaje del agente, responde 200 con mensajes vacío', async () => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = () => ({
      ok: true,
      datos: { mensajes: mensajesDeHerramientas },
    });

    const { status, cuerpo } = await enviar(id, { texto: 'hola' });

    expect(status).toBe(200);
    expect(EnviarEstricto.parse(cuerpo)).toMatchObject({ mensajes: [], mensajesUsados: 1 });
  });

  it('el conteo sube con cada mensaje', async () => {
    const id = await conversacionAbierta();
    for (let n = 1; n <= 3; n++) {
      const { cuerpo } = await enviar(id, { texto: `mensaje ${n}` });
      expect(RespuestaEnviarMensajeSchema.parse(cuerpo).mensajesUsados).toBe(n);
    }
  });

  it('el mensaje 31 responde 429 sin llamar a Retell', async () => {
    const id = await conversacionAbierta();
    for (let n = 1; n <= LIMITE_MENSAJES_CLIENTE; n++) {
      expect((await enviar(id, { texto: `mensaje ${n}` })).status).toBe(200);
    }
    const llamadasAntes = falso.llamadas.enviarMensaje.length;

    const { status, cuerpo } = await enviar(id, { texto: 'uno más' });

    expect(status).toBe(429);
    expect(ErrorEstricto.parse(cuerpo).codigo).toBe('limite_alcanzado');
    expect(falso.llamadas.enviarMensaje).toHaveLength(llamadasAntes);
    expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(30);
  });

  it('un uuid que no existe responde 404', async () => {
    const { status, cuerpo } = await enviar(crypto.randomUUID(), { texto: 'hola' });

    expect(status).toBe(404);
    expect(ErrorEstricto.parse(cuerpo).codigo).toBe('conversacion_no_encontrada');
  });

  it('una conversación terminada responde 409 sin llamar a Retell', async () => {
    const id = await conversacionAbierta();
    await enMemoria.repo.terminar(id, new Date());

    const { status, cuerpo } = await enviar(id, { texto: 'hola' });

    expect(status).toBe(409);
    expect(ErrorEstricto.parse(cuerpo).codigo).toBe('conversacion_terminada');
    expect(falso.llamadas.enviarMensaje).toEqual([]);
  });

  it.each([
    ['400', 400],
    ['401', 401],
    ['402', 402],
    ['422', 422],
    ['429', 429],
  ])('Retell rechaza con %s: devuelve el mensaje y responde 503', async (_, status) => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = fallaRetell('rechazo', status);

    const { status: http, cuerpo } = await enviar(id, { texto: 'hola' });

    expect(http).toBe(503);
    expect(ErrorEstricto.parse(cuerpo).codigo).toBe('servicio_no_disponible');
    expect(enMemoria.llamadas.devolver).toEqual([id]);
    expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(0);
  });

  it('sin conexión con Retell: devuelve el mensaje y responde 503', async () => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = fallaRetell('sin_conexion');

    expect((await enviar(id, { texto: 'hola' })).status).toBe(503);
    expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(0);
  });

  it.each([
    ['timeout', 'timeout', undefined],
    ['500', 'incierta', 500],
    ['503', 'incierta', 503],
    ['respuesta que no se entiende', 'incierta', 201],
  ] as const)(
    'Retell con %s: el mensaje se queda contado y responde 503',
    async (_, falla, status) => {
      const id = await conversacionAbierta();
      falso.respuestas.enviarMensaje = fallaRetell(falla, status);

      const { status: http, cuerpo } = await enviar(id, { texto: 'hola' });

      expect(http).toBe(503);
      expect(ErrorEstricto.parse(cuerpo).codigo).toBe('servicio_no_disponible');
      expect(enMemoria.llamadas.devolver).toEqual([]);
      expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(1);
    },
  );

  it.each([400, 422])(
    'Retell responde %s y el chat ya terminó allá: termina, devuelve y responde 409',
    async (status) => {
      const id = await conversacionAbierta();
      falso.respuestas.enviarMensaje = fallaRetell('rechazo', status);
      falso.respuestas.consultarEstado = () => ({ ok: true, datos: { estado: 'ended' } });

      const { status: http, cuerpo } = await enviar(id, { texto: 'hola' });

      expect(http).toBe(409);
      expect(ErrorEstricto.parse(cuerpo).codigo).toBe('conversacion_terminada');
      expect(falso.llamadas.consultarEstado).toEqual(['CHAT_SECRETO_1']);
      expect(enMemoria.filas.get(id)?.terminadaEn).not.toBeNull();
      expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(0);
      expect((await enviar(id, { texto: 'otra vez' })).status).toBe(409);
    },
  );

  it.each([
    ['sigue activo', () => ({ ok: true, datos: { estado: 'ongoing' } }) as const],
    ['está en error', () => ({ ok: true, datos: { estado: 'error' } }) as const],
    ['no se pudo consultar', fallaRetell('timeout')],
  ])(
    'Retell responde 400 y el chat %s: falla clara, devuelve y responde 503',
    async (_, consultar) => {
      const id = await conversacionAbierta();
      falso.respuestas.enviarMensaje = fallaRetell('rechazo', 400);
      falso.respuestas.consultarEstado = consultar;

      expect((await enviar(id, { texto: 'hola' })).status).toBe(503);
      expect(enMemoria.filas.get(id)?.terminadaEn).toBeNull();
      expect(enMemoria.filas.get(id)?.mensajesUsados).toBe(0);
    },
  );

  it('con un rechazo que no es 400 ni 422 no consulta el estado del chat', async () => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = fallaRetell('rechazo', 429);

    await enviar(id, { texto: 'hola' });

    expect(falso.llamadas.consultarEstado).toEqual([]);
  });

  it('sin RETELL_API_KEY responde 503 sin tocar la base', async () => {
    const id = await conversacionAbierta();
    const registrosAntes = enMemoria.llamadas.registrar;

    const { status } = await enviar(id, { texto: 'hola' }, { ...env, RETELL_API_KEY: '' });

    expect(status).toBe(503);
    expect(enMemoria.llamadas.registrar).toBe(registrosAntes);
  });

  it('si falla la base al registrar, responde 503 sin llamar a Retell', async () => {
    const id = await conversacionAbierta();
    enMemoria.repo.registrarMensaje = async () => {
      throw new Error('Falló registrar_mensaje_chat (código 08006)');
    };

    expect((await enviar(id, { texto: 'hola' })).status).toBe(503);
    expect(falso.llamadas.enviarMensaje).toEqual([]);
  });

  it('si falla devolver después de un rechazo, igual responde 503', async () => {
    const id = await conversacionAbierta();
    falso.respuestas.enviarMensaje = fallaRetell('rechazo', 401);
    enMemoria.repo.devolverMensaje = async () => {
      throw new Error('Falló devolver_mensaje_chat (código 08006)');
    };

    expect((await enviar(id, { texto: 'hola' })).status).toBe(503);
  });
});

describe('POST /chat/conversaciones/{id}/mensajes: petición inválida', () => {
  it.each([
    ['un id que no es uuid', 'abc', { texto: 'hola' }],
    ['un texto vacío', null, { texto: '' }],
    ['un texto con solo espacios', null, { texto: '   \n\t ' }],
    ['un texto de más de 500 caracteres', null, { texto: 'a'.repeat(501) }],
    ['un cuerpo sin texto', null, {}],
    ['una llave desconocida', null, { texto: 'hola', rol: 'sistema' }],
    ['un JSON mal formado', null, '{"texto": '],
  ])('responde 400 peticion_invalida con %s, sin tocar la base', async (_, idFijo, cuerpo) => {
    const id = idFijo ?? (await conversacionAbierta());
    const registrosAntes = enMemoria.llamadas.registrar;

    const { status, cuerpo: respuesta } = await enviar(id, cuerpo);

    expect(status).toBe(400);
    expect(ErrorEstricto.parse(respuesta).codigo).toBe('peticion_invalida');
    expect(enMemoria.llamadas.registrar).toBe(registrosAntes);
    expect(falso.llamadas.enviarMensaje).toEqual([]);
  });

  it('acepta 500 caracteres después de recortar', async () => {
    const id = await conversacionAbierta();
    expect((await enviar(id, { texto: ` ${'a'.repeat(500)} ` })).status).toBe(200);
  });
});

describe('CHAT_TOPE_DIARIO', () => {
  /** Abre conversaciones hasta que una responde 503 y cuenta cuántas se abrieron. */
  async function abiertasConTope(valor: string | undefined) {
    const entorno: Record<string, string> =
      valor === undefined ? env : { ...env, CHAT_TOPE_DIARIO: valor };
    let abiertas = 0;
    while ((await iniciar(entorno)).status === 201) {
      abiertas++;
      if (abiertas > 10) break;
    }
    return abiertas;
  }

  it.each([
    ['ausente', undefined, 3],
    ['vacío', '', 3],
    ['no numérico', 'muchas', 3],
    ['con decimales', '3.5', 3],
    ['en 0', '0', 3],
    ['en 101', '101', 3],
    ['en 5', '5', 5],
  ])('%s: abre %#', async (_, valor, esperado) => {
    expect(await abiertasConTope(valor)).toBe(esperado);
  });
});

describe('Logs del chat', () => {
  it('ninguna falla escribe la llave, el texto del cliente ni el chat_id', async () => {
    const fallas: [FallaRetell, number | undefined][] = [
      ['rechazo', 400],
      ['rechazo', 401],
      ['rechazo', 429],
      ['sin_conexion', undefined],
      ['timeout', undefined],
      ['incierta', 500],
    ];
    const id = await conversacionAbierta();
    falso.respuestas.consultarEstado = fallaRetell('incierta', 500);
    for (const [falla, status] of fallas) {
      falso.respuestas.enviarMensaje = fallaRetell(falla, status);
      await enviar(id, { texto: TEXTO });
    }
    falso.respuestas.consultarEstado = () => ({ ok: true, datos: { estado: 'ended' } });
    falso.respuestas.enviarMensaje = fallaRetell('rechazo', 422);
    await enviar(id, { texto: TEXTO });

    falso.respuestas.crearChat = fallaRetell('incierta', 500);
    await iniciar({ ...env, CHAT_TOPE_DIARIO: '100' });
    await iniciar({ ...env, RETELL_AGENT_ID: '' });
    await enviar(id, { texto: TEXTO }, { ...env, RETELL_API_KEY: '' });
    enMemoria.repo.registrarMensaje = async () => {
      throw new Error('Falló registrar_mensaje_chat (código 08006)');
    };
    await enviar(id, { texto: TEXTO });

    // Que de verdad se escribieron logs; el afterEach revisa que no lleven nada sensible.
    expect(escritos.length).toBeGreaterThanOrEqual(10);
    const logs = textoDeLogs();
    expect(logs).toMatch(/create-chat-completion/);
    expect(logs).toMatch(/"status":401/);
    expect(logs).not.toContain(LLAVE);
    expect(logs).not.toContain(TEXTO);
    expect(logs).not.toContain('CHAT_SECRETO');
  });
});

describe('Errores fuera del chat (onError)', () => {
  it('POST /auth/login con JSON mal formado responde igual que antes: 400 en texto de Hono', async () => {
    const res = await app.request(
      '/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pin": ' },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Malformed JSON in request body');
  });

  it('una ruta inexistente responde 404 como antes', async () => {
    const res = await app.request('/no-existe', {}, env);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('404 Not Found');
  });

  it('un error inesperado fuera del chat responde 500 en texto, como el manejador de Hono', async () => {
    const { repo } = await crearRepoEnMemoria();
    repo.listarActivos = async () => {
      throw new Error('falla de prueba');
    };
    const conRepoRoto = crearApp({ crearRepoEmpleados: () => repo });

    const res = await conRepoRoto.request('/auth/empleados', {}, env);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');
    expect(escritos).toHaveLength(1);
  });
});
