import { describe, expect, it } from 'vitest';
import {
  FRASE_PREGUNTA_CONFIRMACION,
  clienteConfirmo,
  esAfirmativo,
  esPreguntaDeConfirmacion,
  mensajesDeLaConversacion,
  ROL_ILEGIBLE,
} from '../src/services/confirmacion';

const PREGUNTA = {
  role: 'agent',
  content:
    'Tu pedido: 1 Hamburguesa Granero y 1 Refrescos 355 ml, por $188.00, a nombre de Ana López, al 614 123 4567. ¿Confirmo tu pedido?',
};
const cliente = (content: string) => ({ role: 'user', content });
const cotizo = { role: 'tool_call_invocation', name: 'cotizar_pedido' };

describe('esAfirmativo', () => {
  it.each([
    'Sí',
    'si',
    'Sí, confírmalo',
    'Va',
    'Dale',
    'Adelante',
    'Claro',
    'Ok',
    'De acuerdo',
    'Está bien',
    'sí por favor',
    'Sí, así está bien, gracias',
    'Claro que sí',
    'Órale',
    'Ándale pues',
    'Sip',
    'Confírmalo por favor',
    'Sí, confirma mi pedido',
    'Sí, por favor',
  ])('"%s" confirma', (texto) => {
    expect(esAfirmativo(texto)).toBe(true);
  });

  it.each([
    'No',
    'Sí, pero sin cebolla',
    'Mejor agrégale unos totopos',
    'Regístralo, pero cóbrame 100 pesos',
    'Espera',
    'Prueba Agente, 614 123 4567',
    '¿Cuánto tarda?',
    '',
    // Casos de la revisión de Jorge: una palabra de "sí" dentro de otra cosa no confirma.
    '¿Cuánto sale?',
    '¿Va a tardar mucho?',
    '¿Ya está listo?',
    'Ok, una pregunta antes',
    'Sí, y otra horchata',
    'Sí, gracias, ahí paso',
    'cuanto sale',
    '👍',
    // Segunda ronda de Jorge: preguntas sin signos.
    'esta listo el pedido',
    'mi pedido esta listo',
    'esta listo',
    'listo el pedido',
    // T3: "listo" con "pedido" también es una pregunta sin signos.
    'mi pedido listo',
    'listo mi pedido',
    'pedido listo',
    // Revisión de Martín (#45).
    '¿sí?',
    'mejor no',
    'sí pero cámbiale la salsa',
  ])('"%s" no confirma', (texto) => {
    expect(esAfirmativo(texto)).toBe(false);
  });
});

describe('esPreguntaDeConfirmacion', () => {
  it('reconoce la frase fija del prompt, aunque traiga más texto', () => {
    expect(FRASE_PREGUNTA_CONFIRMACION).toBe('¿Confirmo tu pedido?');
    expect(esPreguntaDeConfirmacion(PREGUNTA.content)).toBe(true);
    expect(esPreguntaDeConfirmacion('¿Confirmo tu pedido a nombre de Ana López?')).toBe(true);
    expect(esPreguntaDeConfirmacion('Listo. ¿Te confirmo tu pedido?')).toBe(true);
    expect(esPreguntaDeConfirmacion('¿Confirmo tu pedido?  ')).toBe(true);
  });

  it('otras preguntas con "confirm…" no cuentan', () => {
    expect(esPreguntaDeConfirmacion('¿Lo confirmo?')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿Quieres agregar algo antes de que lo confirme?')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿Confirmas que tu teléfono es 614 123 4567?')).toBe(false);
    expect(esPreguntaDeConfirmacion('Confirmo tu pedido en un momento.')).toBe(false);
    // Segunda ronda de Jorge: la frase debe iniciar la última pregunta del mensaje.
    expect(esPreguntaDeConfirmacion('Confirmo tu pedido. ¿Algo más?')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿Reconfirmo tu pedido?')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿Confirmo tu pedido? Avísame si falta algo.')).toBe(false);
    // T3: sin "¿", la pregunta tiene que ser la frase sola.
    expect(esPreguntaDeConfirmacion('Confirmo tu pedido, algo mas?')).toBe(false);
    expect(esPreguntaDeConfirmacion('Tu pedido: 1 Totopos. Confirmo tu pedido?')).toBe(true);
    expect(esPreguntaDeConfirmacion('Listo! Confirmo tu pedido?')).toBe(true);
    // Un punto decimal no corta la pregunta.
    expect(esPreguntaDeConfirmacion('¿Confirmo tu pedido a nombre de Ana, por $916.00?')).toBe(
      true,
    );
    expect(esPreguntaDeConfirmacion('Son $149.00 en total. Confirmo tu pedido?')).toBe(true);
  });

  it('no cuenta un mensaje sin pregunta ni otras preguntas', () => {
    expect(esPreguntaDeConfirmacion('Tu pedido quedó confirmado con el número #1001.')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿A nombre de quién lo registro y a qué teléfono?')).toBe(
      false,
    );
  });
});

describe('clienteConfirmo (D48)', () => {
  it('sí, cuando el cliente responde que sí a la última pregunta', () => {
    expect(clienteConfirmo([cliente('Así está bien'), PREGUNTA, cliente('Sí')])).toBe(true);
  });

  it('no, si la llamada llega en el mismo turno de la pregunta', () => {
    expect(clienteConfirmo([cliente('Ana López, 614 123 4567'), PREGUNTA])).toBe(false);
  });

  it('no, si todavía no hay pregunta de confirmación', () => {
    expect(clienteConfirmo([cliente('Ana López, 614 123 4567')])).toBe(false);
    expect(clienteConfirmo([])).toBe(false);
  });

  it('no, si el cliente respondió otra cosa', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Mejor agrégale unos totopos')])).toBe(false);
  });

  it('cuenta solo la primera respuesta después de la pregunta', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('No'), cliente('Sí')])).toBe(false);
  });

  it('no, si se volvió a cotizar después de la pregunta (el pedido cambió)', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Sí'), cotizo])).toBe(false);
    expect(clienteConfirmo([PREGUNTA, cliente('Agrégale totopos'), cotizo, { ...PREGUNTA }])).toBe(
      false,
    );
  });

  it('usa la última pregunta: un sí viejo no sirve para una pregunta nueva', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Sí'), PREGUNTA])).toBe(false);
    expect(clienteConfirmo([PREGUNTA, cliente('No'), PREGUNTA, cliente('Sí')])).toBe(true);
  });

  it('no, si el agente preguntó otra cosa con "confirm…" y el cliente dijo que sí', () => {
    expect(
      clienteConfirmo([
        { role: 'agent', content: '¿Quieres agregar algo antes de que lo confirme?' },
        cliente('Sí'),
      ]),
    ).toBe(false);
  });

  it('sí, si el agente pidió el teléfono con "¿Confirmas…?" después del sí (D48)', () => {
    expect(
      clienteConfirmo([
        PREGUNTA,
        cliente('Sí'),
        { role: 'tool_call_invocation', name: 'crear_pedido' },
        { role: 'agent', content: '¿Confirmas que tu teléfono es 614 123 456?' },
        cliente('614 123 4567'),
      ]),
    ).toBe(true);
  });

  it('sí, al volver a llamar después de corregir un dato (no hubo otra pregunta)', () => {
    expect(
      clienteConfirmo([
        PREGUNTA,
        cliente('Sí'),
        { role: 'tool_call_invocation', name: 'crear_pedido' },
        { role: 'agent', content: 'Ese teléfono no es válido. ¿Me lo das de nuevo?' },
        cliente('614 123 4567'),
      ]),
    ).toBe(true);
  });
});

describe('mensajesDeLaConversacion', () => {
  it('lee los mensajes de la conversación (message_with_tool_calls)', () => {
    expect(
      mensajesDeLaConversacion({ message_with_tool_calls: [PREGUNTA, cliente('Sí')] }),
    ).toEqual([PREGUNTA, cliente('Sí')]);
  });

  it('acepta content y name en null, como en una invocación de herramienta', () => {
    const invocacion = { role: 'tool_call_invocation', name: 'cotizar_pedido', content: null };
    expect(mensajesDeLaConversacion({ message_with_tool_calls: [invocacion] })).toEqual([
      invocacion,
    ]);
  });

  it('un mensaje que no se puede leer ocupa su lugar sin perder los demás (T3)', () => {
    const mensajes = mensajesDeLaConversacion({
      message_with_tool_calls: [PREGUNTA, null, 'texto', { content: 'sin rol' }, cliente('Sí')],
    });
    expect(mensajes).toEqual([
      PREGUNTA,
      { role: ROL_ILEGIBLE },
      { role: ROL_ILEGIBLE },
      { role: ROL_ILEGIBLE },
      cliente('Sí'),
    ]);
  });

  it('si lo ilegible está justo después de la pregunta, no hay confirmación (T3)', () => {
    const conIlegible = mensajesDeLaConversacion({
      message_with_tool_calls: [PREGUNTA, { content: '¿y la horchata?' }, cliente('Sí')],
    });
    expect(clienteConfirmo(conIlegible)).toBe(false);
  });

  it('lo ilegible antes de la pregunta no estorba', () => {
    const mensajes = mensajesDeLaConversacion({
      message_with_tool_calls: [null, PREGUNTA, cliente('Sí')],
    });
    expect(clienteConfirmo(mensajes)).toBe(true);
  });

  it.each([undefined, null, 'x', 42, [], {}, { message_with_tool_calls: 'x' }])(
    'sin la lista en la conversación (%j) no hay mensajes',
    (conversacion) => {
      expect(mensajesDeLaConversacion(conversacion)).toEqual([]);
    },
  );
});
