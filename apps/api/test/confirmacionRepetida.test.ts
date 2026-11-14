import { RespuestaEnviarMensajeSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import { crearClienteRetell } from '../src/lib/clienteRetell';
import type { Bindings } from '../src/lib/env';
import { aMensajesAgente, sinConfirmacionRepetida, type MensajeRetell } from '../src/services/chat';
import { crearChatRepoEnMemoria, crearRetellFalso } from './chatEnMemoria';

/*
 * US-08-P2-T4 (D69): si el modelo pregunta "¿Confirmo tu pedido?" y en ese mismo turno llama a
 * `crear_pedido`, el backend no crea nada (D48) y el modelo repite la pregunta. El chat web deja
 * pasar solo la primera.
 */

const RESUMEN =
  'Tu pedido: 1 Hamburguesa Granero, por $149.00, a nombre de Ana López, al 614 123 4567. ¿Confirmo tu pedido?';
const SOLO_PREGUNTA = '¿Confirmo tu pedido?';

let siguiente = 0;
const agente = (texto: string): MensajeRetell => ({
  rol: 'agent',
  id: `msg_${++siguiente}`,
  texto,
  creadoEnMs: 1_791_000_000_000 + siguiente,
});
const llamada = (nombre: string): MensajeRetell => ({
  rol: 'tool_call_invocation',
  id: null,
  texto: null,
  creadoEnMs: null,
  nombre,
});
const resultado = (texto: string): MensajeRetell => ({
  rol: 'tool_call_result',
  id: null,
  texto,
  creadoEnMs: null,
});
const FALTA_CONFIRMACION = resultado(
  '{"ok":false,"faltaConfirmacion":true,"aclaraciones":[],"datosCliente":[]}',
);

const textos = (mensajes: MensajeRetell[]) =>
  aMensajesAgente(mensajes, new Date('2026-11-13T18:00:00Z')).map((m) => m.texto);

describe('sinConfirmacionRepetida (D69)', () => {
  it('pregunta, crear_pedido sin el "sí" y la pregunta otra vez: el cliente la ve una sola vez', () => {
    expect(
      textos([agente(RESUMEN), llamada('crear_pedido'), FALTA_CONFIRMACION, agente(SOLO_PREGUNTA)]),
    ).toEqual([RESUMEN]);
  });

  it('también si la segunda vez repite el resumen completo', () => {
    expect(
      textos([agente(RESUMEN), llamada('crear_pedido'), FALTA_CONFIRMACION, agente(RESUMEN)]),
    ).toEqual([RESUMEN]);
  });

  it('si se repite tres veces, queda la primera', () => {
    expect(textos([agente(RESUMEN), agente(SOLO_PREGUNTA), agente(RESUMEN)])).toEqual([RESUMEN]);
  });

  it('conserva la primera, que es la que trae el resumen', () => {
    const [primera] = sinConfirmacionRepetida([agente(RESUMEN), agente(SOLO_PREGUNTA)]).filter(
      (m) => m.rol === 'agent',
    );
    expect(primera?.texto).toBe(RESUMEN);
  });

  it('si entre las dos se volvió a cotizar, pasan las dos: es otra cotización', () => {
    const nueva = RESUMEN.replace('$149.00', '$188.00');
    expect(
      textos([agente(RESUMEN), llamada('cotizar_pedido'), resultado('{"ok":true}'), agente(nueva)]),
    ).toEqual([RESUMEN, nueva]);
  });

  it('después de volver a cotizar, una tercera igual sí se quita', () => {
    const nueva = RESUMEN.replace('$149.00', '$188.00');
    expect(
      textos([
        agente(RESUMEN),
        llamada('cotizar_pedido'),
        agente(nueva),
        llamada('crear_pedido'),
        FALTA_CONFIRMACION,
        agente(SOLO_PREGUNTA),
      ]),
    ).toEqual([RESUMEN, nueva]);
  });

  it('otro mensaje del agente después de la pregunta sí pasa', () => {
    const telefono = 'El teléfono debe ser de México: 10 dígitos. ¿Me lo repites?';
    expect(textos([agente(RESUMEN), llamada('crear_pedido'), agente(telefono)])).toEqual([
      RESUMEN,
      telefono,
    ]);
  });

  it('no toca preguntas que no son la de confirmación, aunque se repitan', () => {
    expect(textos([agente('¿Algo más?'), agente('¿Algo más?')])).toEqual([
      '¿Algo más?',
      '¿Algo más?',
    ]);
  });

  it('una sola pregunta de confirmación pasa igual', () => {
    expect(textos([agente(RESUMEN)])).toEqual([RESUMEN]);
    expect(textos([llamada('cotizar_pedido'), agente(RESUMEN)])).toEqual([RESUMEN]);
  });

  it('cada respuesta se revisa por separado: la pregunta del turno siguiente no se quita', () => {
    expect(textos([agente(RESUMEN)])).toEqual([RESUMEN]);
    expect(textos([agente(SOLO_PREGUNTA)])).toEqual([SOLO_PREGUNTA]);
  });

  it('no quita ni cambia los mensajes de herramientas (los filtra aMensajesAgente después)', () => {
    const mensajes = [agente(RESUMEN), llamada('crear_pedido'), FALTA_CONFIRMACION];
    expect(sinConfirmacionRepetida(mensajes)).toEqual(mensajes);
  });
});

describe('POST /chat/conversaciones/{id}/mensajes: pregunta de confirmación repetida (D69)', () => {
  const env = { RETELL_API_KEY: 'llave', RETELL_AGENT_ID: 'agent_1' } as Bindings;

  it('responde la pregunta una sola vez y nada de las herramientas', async () => {
    const enMemoria = crearChatRepoEnMemoria();
    const falso = crearRetellFalso();
    const app = crearApp({
      crearRepoChat: () => enMemoria.repo,
      crearClienteRetell: () => falso.retell,
    });
    const abierta = await app.request('/chat/conversaciones', { method: 'POST' }, env);
    const { conversacionId } = (await abierta.json()) as { conversacionId: string };
    falso.respuestas.enviarMensaje = () => ({
      ok: true,
      datos: {
        mensajes: [
          agente(RESUMEN),
          llamada('crear_pedido'),
          FALTA_CONFIRMACION,
          agente(SOLO_PREGUNTA),
        ],
      },
    });

    const res = await app.request(
      `/chat/conversaciones/${conversacionId}/mensajes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: 'Ana López, 614 123 4567' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const cuerpo = RespuestaEnviarMensajeSchema.parse(await res.json());
    expect(cuerpo.mensajes.map((m) => m.texto)).toEqual([RESUMEN]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/crear_pedido|faltaConfirmacion|tool_call/);
  });
});

describe('clienteRetell: nombre de la herramienta (D69)', () => {
  it('lee `name` de los mensajes de create-chat-completion y no lo pone si no viene', async () => {
    const respuesta = {
      messages: [
        { role: 'agent', message_id: 'm1', content: RESUMEN, created_timestamp: 1 },
        { role: 'tool_call_invocation', tool_call_id: 't1', name: 'crear_pedido', arguments: '{}' },
        { role: 'tool_call_result', tool_call_id: 't1', content: '{"ok":false}' },
      ],
    };
    const cliente = crearClienteRetell('llave', {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(respuesta), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    });

    const enviado = await cliente.enviarMensaje('chat_1', 'hola');

    if (!enviado.ok) throw new Error('se esperaba ok');
    expect(enviado.datos.mensajes.map((m) => [m.rol, m.nombre ?? null])).toEqual([
      ['agent', null],
      ['tool_call_invocation', 'crear_pedido'],
      ['tool_call_result', null],
    ]);
  });
});
