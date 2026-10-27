import {
  ConversacionRetellSchema,
  MensajeConversacionSchema,
  type MensajeConversacion,
} from '@serviceagent/shared';

/*
 * ¿El cliente confirmó el pedido? (D48, US-08-P2-T1). El modelo a veces llama a `crear_pedido` en
 * el mismo turno en que pregunta "¿Confirmo tu pedido…?", sin esperar la respuesta. El prompt no
 * basta para impedirlo, así que el backend lo revisa en la conversación que manda Retell en `chat`
 * (voz: pendiente, Sprint 10):
 *
 * 1. Busca la ÚLTIMA pregunta de confirmación del agente: la frase fija del prompt, "¿Confirmo tu
 *    pedido?" (`FRASE_PREGUNTA_CONFIRMACION`).
 * 2. El primer mensaje del cliente después de esa pregunta debe ser un "sí" claro, sin nada más.
 * 3. Después de esa pregunta no puede haber otra llamada a `cotizar_pedido`: el pedido cambió y hay
 *    que volver a confirmarlo.
 *
 * Si la llamada llega en el mismo turno de la pregunta, todavía no hay respuesta del cliente después
 * de ella: no hay confirmación, venga o no esa pregunta en la lista. Sin mensajes, tampoco.
 */

/** Palabras sueltas, sin acentos ni signos: "¡Sí, confírmalo!" → ["si", "confirmalo"]. */
function palabrasDe(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palabra) => palabra !== '');
}

/** Palabras que confirman por sí solas: "sí", "va", "dale", "adelante", "confírmalo", "órale"… */
const AFIRMATIVAS: ReadonlySet<string> = new Set([
  'si',
  'sip',
  'va',
  'dale',
  'adelante',
  'confirmo',
  'confirma',
  'confirmalo',
  'confirmado',
  'claro',
  'ok',
  'okay',
  'sale',
  'correcto',
  'perfecto',
  'exacto',
  'listo',
  'simon',
  'orale',
  'andale',
  'acuerdo', // "de acuerdo"
  'bien', // "está bien", "muy bien"
]);

/**
 * Palabras que pueden acompañar a un "sí" sin pedir otra cosa: "sí, así está bien, gracias",
 * "confírmalo por favor", "claro que sí". Cualquier otra palabra ("sí, y otra horchata", "ok, una
 * pregunta") hace que la respuesta no confirme: el agente atiende eso y vuelve a preguntar.
 */
const RELLENO: ReadonlySet<string> = new Set([
  'de',
  'que',
  'asi',
  'esta',
  'es',
  'eso',
  'todo',
  'muy',
  'por',
  'favor',
  'porfa',
  'gracias',
  'muchas',
  'lo',
  'mi',
  'pedido',
  'pues',
  'entonces',
]);

/**
 * "Sí", "sí, confírmalo", "va", "de acuerdo", "así está bien, gracias". Todas las palabras deben ser
 * de "sí" o de relleno, y al menos una de "sí"; una pregunta nunca confirma, tampoco sin signos
 * ("está listo", "mi pedido está listo"). Así "¿Cuánto sale?", "¿Ya está listo?", "Sí, y otra
 * horchata" o "Sí, pero sin cebolla" no crean el pedido.
 */
export function esAfirmativo(texto: string): boolean {
  if (texto.includes('?') || texto.includes('¿')) return false;
  const palabras = palabrasDe(texto);
  // "¿Ya está listo?" escrito sin signos: es una pregunta, no un sí.
  if (palabras.includes('esta') && palabras.includes('listo')) return false;
  return (
    palabras.some((palabra) => AFIRMATIVAS.has(palabra)) &&
    palabras.every((palabra) => AFIRMATIVAS.has(palabra) || RELLENO.has(palabra))
  );
}

/**
 * Frase fija con la que el agente debe pedir la confirmación. La usará agent/prompt.md desde US-08-P2
 * ("Cómo registras el pedido"); si el prompt la cambia, hay que cambiarla aquí, o ningún pedido se
 * crearía.
 */
export const FRASE_PREGUNTA_CONFIRMACION = '¿Confirmo tu pedido?';
const FRASE_NORMALIZADA = palabrasDe(FRASE_PREGUNTA_CONFIRMACION).join(' ');
// Las palabras se unen con un espacio: la frase va al inicio y termina en espacio o al final.
const INICIO_PREGUNTA = new RegExp(`^(te )?${FRASE_NORMALIZADA}( |$)`);

/**
 * Mensaje del agente que pide la confirmación del pedido: termina en una pregunta que empieza con
 * "Confirmo tu pedido" ("Tu pedido: … ¿Confirmo tu pedido?"). Otras preguntas no cuentan: "¿Quieres
 * agregar algo antes de que lo confirme?", "¿Confirmas que tu teléfono es…?" o "Confirmo tu pedido.
 * ¿Algo más?", donde un "sí" significa otra cosa.
 */
export function esPreguntaDeConfirmacion(texto: string): boolean {
  const recortado = texto.trim();
  if (!recortado.endsWith('?')) return false;
  const ultimaPregunta = recortado.slice(recortado.lastIndexOf('¿') + 1);
  return INICIO_PREGUNTA.test(palabrasDe(ultimaPregunta).join(' '));
}

/** `true` si el cliente respondió que sí a la última pregunta de confirmación y nada cambió después. */
export function clienteConfirmo(mensajes: readonly MensajeConversacion[]): boolean {
  let pregunta = -1;
  mensajes.forEach((m, i) => {
    if (m.role === 'agent' && esPreguntaDeConfirmacion(m.content ?? '')) pregunta = i;
  });
  if (pregunta === -1) return false;

  const despues = mensajes.slice(pregunta + 1);
  if (despues.some((m) => m.role === 'tool_call_invocation' && m.name === 'cotizar_pedido')) {
    return false;
  }
  const respuesta = despues.find((m) => m.role === 'user');
  return respuesta !== undefined && esAfirmativo(respuesta.content ?? '');
}

/**
 * Los mensajes de `chat.message_with_tool_calls`. Si no trae la lista, no hay mensajes (y el pedido
 * no se crea). Un mensaje sin `role` o que no es objeto se descarta sin perder los demás.
 */
export function mensajesDeLaConversacion(conversacion: unknown): MensajeConversacion[] {
  const leida = ConversacionRetellSchema.safeParse(conversacion);
  if (!leida.success) return [];
  return leida.data.message_with_tool_calls.flatMap((mensaje) => {
    const leido = MensajeConversacionSchema.safeParse(mensaje);
    return leido.success ? [leido.data] : [];
  });
}
