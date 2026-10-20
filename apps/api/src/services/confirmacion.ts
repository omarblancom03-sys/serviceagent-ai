import type { MensajeConversacion } from '@serviceagent/shared';

/*
 * ¿El cliente confirmó el pedido? (D48, US-08-P2-T1). El modelo a veces llama a `crear_pedido` en
 * el mismo turno en que pregunta "¿Confirmo tu pedido…?", sin esperar la respuesta. El prompt no
 * basta para impedirlo, así que el backend lo revisa en la conversación que manda Retell en `call`:
 *
 * 1. Busca la ÚLTIMA pregunta de confirmación del agente (un mensaje con "?" y una palabra que
 *    empieza con "confirm": "¿Confirmo tu pedido a nombre de…?").
 * 2. El primer mensaje del cliente después de esa pregunta debe ser un "sí" claro.
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

/** Respuestas que confirman: "sí", "va", "dale", "adelante", "confírmalo", "de acuerdo"… */
const AFIRMATIVAS: ReadonlySet<string> = new Set([
  'si',
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
  'acuerdo', // "de acuerdo"
  'bien', // "está bien", "muy bien"
]);

/**
 * Palabras que, junto a un "sí", piden otra cosa: "sí, pero sin cebolla", "mejor agrégale…". Con
 * cualquiera de ellas la respuesta no confirma y el agente debe atender eso primero.
 */
const NO_CONFIRMAN: ReadonlySet<string> = new Set([
  'no',
  'pero',
  'mejor',
  'espera',
  'esperate',
  'aun',
  'todavia',
  'cambia',
  'cambiale',
  'cambialo',
  'cambiar',
  'agrega',
  'agregale',
  'agregar',
  'quita',
  'quitale',
  'quitar',
  'sin',
  'cancela',
  'cancelalo',
  'cobrame',
]);

/** "Sí", "sí, confírmalo", "va", "de acuerdo"; no "sí, pero…", "no" ni "mejor agrégale totopos". */
export function esAfirmativo(texto: string): boolean {
  const palabras = palabrasDe(texto);
  if (palabras.some((palabra) => NO_CONFIRMAN.has(palabra))) return false;
  return palabras.some((palabra) => AFIRMATIVAS.has(palabra));
}

/** Mensaje del agente que pregunta la confirmación: trae "?" y una palabra "confirm…". */
export function esPreguntaDeConfirmacion(texto: string): boolean {
  return texto.includes('?') && palabrasDe(texto).some((palabra) => palabra.startsWith('confirm'));
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
