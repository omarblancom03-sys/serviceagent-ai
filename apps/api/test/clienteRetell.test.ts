import { describe, expect, it } from 'vitest';
import { crearClienteRetell } from '../src/lib/clienteRetell';
import { aMensajesAgente, leerConfigChat, leerTopeDiario } from '../src/services/chat';

/** Cliente con un `fetch` falso: nunca sale a la red. Anota lo que se habría mandado. */
function clienteCon(responder: (url: string, init: RequestInit) => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return responder(url, init);
  }) as unknown as typeof fetch;
  const cliente = crearClienteRetell('llave_de_prueba', {
    fetch: fetchFalso,
    timeouts: { crearChat: 20, enviarMensaje: 20, consultarEstado: 20 },
  });
  return { cliente, llamadas };
}

const json = (cuerpo: unknown, status = 201) =>
  Promise.resolve(
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

/** Imita a un servidor que nunca responde: solo termina cuando se aborta la petición. */
const nuncaResponde = (_: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
  });

describe('Cliente de Retell: peticiones', () => {
  it('crea el chat con el agent_id, la versión publicada y la llave en Authorization', async () => {
    const { cliente, llamadas } = clienteCon(() =>
      json({ chat_id: 'chat_1', chat_status: 'ongoing', transcript: '' }),
    );

    const r = await cliente.crearChat('agent_1');

    expect(r).toEqual({ ok: true, datos: { chatId: 'chat_1', estado: 'ongoing', mensajes: [] } });
    expect(llamadas[0]?.url).toBe('https://api.retellai.com/create-chat');
    expect(llamadas[0]?.init.method).toBe('POST');
    expect(llamadas[0]?.init.headers).toMatchObject({ Authorization: 'Bearer llave_de_prueba' });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({
      agent_id: 'agent_1',
      agent_version: 'latest_published',
    });
  });

  it('manda el mensaje con chat_id y content y lee los mensajes nuevos', async () => {
    const { cliente, llamadas } = clienteCon(() =>
      json({
        messages: [
          {
            message_id: 'm1',
            role: 'tool_call_invocation',
            name: 'cotizar_pedido',
            arguments: '{}',
          },
          {
            message_id: 'm2',
            role: 'agent',
            content: 'Listo',
            created_timestamp: 1_791_000_000_000,
          },
          { role: 'agent', content: 'Sin id ni hora' },
          'basura',
          { content: 'sin rol' },
        ],
      }),
    );

    const r = await cliente.enviarMensaje('chat_1', 'dos tacos');

    expect(llamadas[0]?.url).toBe('https://api.retellai.com/create-chat-completion');
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({
      chat_id: 'chat_1',
      content: 'dos tacos',
    });
    expect(r).toEqual({
      ok: true,
      datos: {
        mensajes: [
          { rol: 'tool_call_invocation', id: 'm1', texto: null, creadoEnMs: null },
          { rol: 'agent', id: 'm2', texto: 'Listo', creadoEnMs: 1_791_000_000_000 },
          { rol: 'agent', id: null, texto: 'Sin id ni hora', creadoEnMs: null },
        ],
      },
    });
  });

  it('lee los mensajes iniciales de message_with_tool_calls al crear el chat', async () => {
    const { cliente } = clienteCon(() =>
      json({
        chat_id: 'chat_1',
        chat_status: 'ongoing',
        message_with_tool_calls: [{ message_id: 'm0', role: 'agent', content: 'Hola' }],
      }),
    );

    const r = await cliente.crearChat('agent_1');

    expect(r.ok && r.datos.mensajes).toEqual([
      { rol: 'agent', id: 'm0', texto: 'Hola', creadoEnMs: null },
    ]);
  });

  it('consulta el estado con GET /get-chat/{chat_id}', async () => {
    const { cliente, llamadas } = clienteCon(() =>
      json({ chat_id: 'chat/1', chat_status: 'ended' }, 200),
    );

    expect(await cliente.consultarEstado('chat/1')).toEqual({
      ok: true,
      datos: { estado: 'ended' },
    });
    expect(llamadas[0]?.url).toBe('https://api.retellai.com/get-chat/chat%2F1');
    expect(llamadas[0]?.init.method).toBe('GET');
    expect(llamadas[0]?.init.body).toBeUndefined();
  });
});

describe('Cliente de Retell: clasificación de fallas (D39)', () => {
  it.each([400, 401, 402, 422, 429])('%i es rechazo', async (status) => {
    const { cliente } = clienteCon(() => json({ status: 'error', message: 'detalle' }, status));
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toEqual({
      ok: false,
      falla: 'rechazo',
      status,
    });
  });

  it.each([500, 502, 503, 403, 404, 409])('%i es incierta', async (status) => {
    const { cliente } = clienteCon(() => json({ status: 'error' }, status));
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toEqual({
      ok: false,
      falla: 'incierta',
      status,
    });
  });

  it('un error de conexión antes de responder es sin_conexion', async () => {
    const { cliente } = clienteCon(() => Promise.reject(new TypeError('Network connection lost')));
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toEqual({
      ok: false,
      falla: 'sin_conexion',
    });
  });

  it('si Retell no responde a tiempo es timeout', async () => {
    const { cliente } = clienteCon(nuncaResponde);
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toEqual({ ok: false, falla: 'timeout' });
    expect(await cliente.crearChat('agent_1')).toEqual({ ok: false, falla: 'timeout' });
  });

  it.each([
    ['sin messages', { mensajes: [] }],
    ['con messages que no es arreglo', { messages: 'hola' }],
  ])('un 201 %s es incierta', async (_, cuerpo) => {
    const { cliente } = clienteCon(() => json(cuerpo));
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toEqual({
      ok: false,
      falla: 'incierta',
      status: 201,
    });
  });

  it('un 201 que no es JSON es incierta', async () => {
    const { cliente } = clienteCon(() => Promise.resolve(new Response('<html>', { status: 201 })));
    expect(await cliente.enviarMensaje('chat_1', 'hola')).toMatchObject({ falla: 'incierta' });
  });

  it.each([
    ['sin chat_id', { chat_status: 'ongoing' }],
    ['con chat_id vacío', { chat_id: '', chat_status: 'ongoing' }],
    ['con chat_id de más de 128 caracteres', { chat_id: 'a'.repeat(129), chat_status: 'ongoing' }],
  ])('crear un chat %s es incierta', async (_, cuerpo) => {
    const { cliente } = clienteCon(() => json(cuerpo));
    expect(await cliente.crearChat('agent_1')).toMatchObject({ ok: false, falla: 'incierta' });
  });
});

describe('Mensajes del agente para el cliente', () => {
  const ahora = new Date('2026-10-12T20:00:00.000Z');

  it('deja solo los del agente con texto y completa id y hora faltantes', () => {
    const mensajes = aMensajesAgente(
      [
        { rol: 'agent', id: 'm1', texto: 'Hola', creadoEnMs: 1_791_000_000_000 },
        { rol: 'agent', id: null, texto: 'Sin id', creadoEnMs: null },
        { rol: 'agent', id: 'm3', texto: '   ', creadoEnMs: null },
        { rol: 'agent', id: 'm4', texto: null, creadoEnMs: null },
        { rol: 'tool_call_result', id: 'm5', texto: '{"ok":true}', creadoEnMs: null },
      ],
      ahora,
    );

    expect(mensajes).toHaveLength(2);
    expect(mensajes[0]).toEqual({ id: 'm1', texto: 'Hola', creadoEn: '2026-10-03T04:00:00.000Z' });
    expect(mensajes[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mensajes[1]?.creadoEn).toBe('2026-10-12T20:00:00.000Z');
  });
});

describe('Configuración del chat', () => {
  it.each([
    [undefined, 3],
    ['', 3],
    ['   ', 3],
    ['muchas', 3],
    ['3.5', 3],
    ['-1', 3],
    ['0', 3],
    ['101', 3],
    ['1e2', 3],
    ['5', 5],
    [' 7 ', 7],
    ['1', 1],
    ['100', 100],
  ])('CHAT_TOPE_DIARIO %j da %i', (valor, esperado) => {
    expect(leerTopeDiario(valor)).toBe(esperado);
  });

  it('una llave o un agente vacíos o solo con espacios cuentan como faltantes', () => {
    expect(leerConfigChat({ RETELL_API_KEY: '  ', RETELL_AGENT_ID: '' })).toEqual({
      llave: null,
      agentId: null,
      topeDiario: 3,
    });
    expect(leerConfigChat({ RETELL_API_KEY: ' k ', RETELL_AGENT_ID: 'a' })).toMatchObject({
      llave: 'k',
      agentId: 'a',
    });
  });
});
