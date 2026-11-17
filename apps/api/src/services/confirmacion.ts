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
 * ("está listo", "mi pedido está listo", "pedido listo"). Así "¿Cuánto sale?", "¿Ya está listo?",
 * "Sí, y otra horchata" o "Sí, pero sin cebolla" no crean el pedido.
 */
export function esAfirmativo(
  texto: string,
  otrasAfirmativas: ReadonlySet<string> = new Set(),
): boolean {
  if (texto.includes('?') || texto.includes('¿')) return false;
  const palabras = palabrasDe(texto);
  // "¿Ya está listo?" o "¿mi pedido listo?" escrito sin signos: es una pregunta, no un sí.
  if (palabras.includes('listo') && (palabras.includes('esta') || palabras.includes('pedido'))) {
    return false;
  }
  const afirma = (palabra: string) => AFIRMATIVAS.has(palabra) || otrasAfirmativas.has(palabra);
  return (
    palabras.some(afirma) && palabras.every((palabra) => afirma(palabra) || RELLENO.has(palabra))
  );
}

/**
 * Frase fija con la que el agente debe pedir la confirmación. La usará agent/prompt.md desde US-08-P2
 * ("Cómo registras el pedido"); si el prompt la cambia, hay que cambiarla aquí, o ningún pedido se
 * crearía.
 */
export const FRASE_PREGUNTA_CONFIRMACION = '¿Confirmo tu pedido?';

/**
 * Frase fija con la que el agente pregunta si cancela un pedido (D73): "¿Cancelo tu pedido #1025?".
 * Justo después va el número de pedido, que se compara con el folio a cancelar (D74). La usará
 * agent/prompt.md desde US-14-P2 ("Cómo cancelas un pedido", #75); si cambia allá, cambia aquí.
 */
export const FRASE_PREGUNTA_CANCELACION = '¿Cancelo tu pedido?';

interface PreguntaFija {
  /** Con "¿": la última pregunta empieza con la frase. */
  inicio: RegExp;
  /** Sin "¿": la última pregunta es la frase sola. */
  exacta: RegExp;
}

function preguntaFija(frase: string): PreguntaFija {
  // Las palabras se unen con un espacio: la frase va al inicio y termina en espacio o al final.
  const normalizada = palabrasDe(frase).join(' ');
  return {
    inicio: new RegExp(`^(te )?${normalizada}( |$)`),
    exacta: new RegExp(`^(te )?${normalizada}$`),
  };
}

const PREGUNTA_CONFIRMACION = preguntaFija(FRASE_PREGUNTA_CONFIRMACION);
const PREGUNTA_CANCELACION = preguntaFija(FRASE_PREGUNTA_CANCELACION);

/** Palabras que, solo como respuesta a "¿Cancelo tu pedido?", también dicen que sí: "sí, cancélalo". */
const AFIRMATIVAS_CANCELACION: ReadonlySet<string> = new Set(['cancelalo', 'cancela', 'cancelado']);

/**
 * Mensaje del agente que pide la confirmación del pedido: termina en una pregunta que empieza con
 * "Confirmo tu pedido" ("Tu pedido: … ¿Confirmo tu pedido?"). Otras preguntas no cuentan: "¿Quieres
 * agregar algo antes de que lo confirme?", "¿Confirmas que tu teléfono es…?" o "Confirmo tu pedido.
 * ¿Algo más?", donde un "sí" significa otra cosa.
 */
export function esPreguntaDeConfirmacion(texto: string): boolean {
  return terminaEnPregunta(texto, PREGUNTA_CONFIRMACION);
}

/** Mensaje del agente que pregunta si cancela el pedido: "… ¿Cancelo tu pedido #1025?" (D73). */
export function esPreguntaDeCancelacion(texto: string): boolean {
  return terminaEnPregunta(texto, PREGUNTA_CANCELACION);
}

/**
 * La última pregunta de un mensaje, ya normalizada ("cancelo tu pedido 1001"), y el signo que la
 * abre; `null` si el mensaje no termina en "?".
 */
function ultimaPreguntaDe(texto: string): { pregunta: string; abre: string | undefined } | null {
  const recortado = texto.trim();
  if (!recortado.endsWith('?')) return null;
  // La última pregunta empieza después del último "¿", o del último ".", "!" o "?" seguido de un
  // espacio (un punto decimal, como en "$149.00", no termina una oración).
  const sinFinal = recortado.slice(0, -1);
  let corte = -1;
  for (const signo of sinFinal.matchAll(/¿|[.!?](?=\s)/g)) corte = signo.index;
  return { pregunta: palabrasDe(recortado.slice(corte + 1)).join(' '), abre: sinFinal[corte] };
}

function terminaEnPregunta(texto: string, pregunta: PreguntaFija): boolean {
  const ultima = ultimaPreguntaDe(texto);
  if (ultima === null) return false;
  // Con "¿" basta que empiece con la frase ("¿Confirmo tu pedido a nombre de…?"). Sin "¿" tiene que
  // ser la frase sola: "Confirmo tu pedido, algo más?" escrito sin signos no es la pregunta. Y no
  // puede venir justo después de otra pregunta: en "¿Algo más? Confirmo tu pedido?" un "sí" puede
  // ser "sí, quiero algo más".
  if (ultima.abre === '¿') return pregunta.inicio.test(ultima.pregunta);
  if (ultima.abre === '?') return false;
  return pregunta.exacta.test(ultima.pregunta);
}

// "cancelo tu pedido 1001", "cancelo tu pedido numero 1001", "cancelo tu pedido con folio 1001".
const FOLIO_EN_PREGUNTA = new RegExp(
  `^(?:te )?${palabrasDe(FRASE_PREGUNTA_CANCELACION).join(' ')} (?:con )?(?:numero |folio )?([0-9]{1,10})(?: |$)`,
);

/**
 * El número de pedido que nombra la pregunta de cancelación ("¿Cancelo tu pedido #1001?" → 1001),
 * o `null` si no trae uno justo después de la frase (D74). También `null` si la pregunta nombra
 * otro número después ("¿Cancelo tu pedido #1001 o el #1002?"): un "sí" ahí no dice cuál.
 */
export function folioDeLaPreguntaDeCancelacion(texto: string): number | null {
  if (!esPreguntaDeCancelacion(texto)) return null;
  const pregunta = ultimaPreguntaDe(texto)?.pregunta ?? '';
  const encontrado = FOLIO_EN_PREGUNTA.exec(pregunta);
  if (!encontrado?.[1]) return null;
  if (/[0-9]/.test(pregunta.slice(encontrado[0].length))) return null;
  return Number(encontrado[1]);
}

/** Rol que se le pone a un mensaje de la conversación que no se pudo leer. */
export const ROL_ILEGIBLE = 'ilegible';

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
  return respondioQueSi(despues, esPreguntaDeCancelacion);
}

/**
 * Lo mismo para cancelar (D73 y D74): `true` si el cliente respondió que sí a la última pregunta
 * "¿Cancelo tu pedido #N?" y ese N es el `folio` que se va a cancelar. Si el modelo llama a
 * `cancelar_pedido` en el turno en que pregunta, sin preguntar, con una pregunta sin número o con
 * el "sí" que el cliente dio para otro pedido, no hay confirmación y el pedido no se cancela.
 */
export function clienteConfirmoCancelacion(
  mensajes: readonly MensajeConversacion[],
  folio: number,
): boolean {
  let pregunta = -1;
  mensajes.forEach((m, i) => {
    if (m.role === 'agent' && esPreguntaDeCancelacion(m.content ?? '')) pregunta = i;
  });
  if (pregunta === -1) return false;
  if (folioDeLaPreguntaDeCancelacion(mensajes[pregunta]?.content ?? '') !== folio) return false;
  return respondioQueSi(
    mensajes.slice(pregunta + 1),
    esPreguntaDeConfirmacion,
    AFIRMATIVAS_CANCELACION,
  );
}

/**
 * El primer mensaje del cliente es un "sí". Un mensaje que no se pudo leer ocupa su lugar: si es el
 * primero, pudo ser la respuesta del cliente, así que no hay confirmación (falla hacia lo seguro).
 * Si antes de esa respuesta el agente hizo la otra pregunta fija (`esPreguntaAjena`), el "sí" es de
 * esa pregunta y no de esta: así un solo "sí" nunca vale para crear y cancelar a la vez.
 */
function respondioQueSi(
  despues: readonly MensajeConversacion[],
  esPreguntaAjena: (texto: string) => boolean,
  otrasAfirmativas?: ReadonlySet<string>,
): boolean {
  const indice = despues.findIndex((m) => m.role === 'user' || m.role === ROL_ILEGIBLE);
  const respuesta = despues[indice];
  if (respuesta?.role !== 'user') return false;
  const antes = despues.slice(0, indice);
  if (antes.some((m) => m.role === 'agent' && esPreguntaAjena(m.content ?? ''))) return false;
  return esAfirmativo(respuesta.content ?? '', otrasAfirmativas);
}

/**
 * Los mensajes de `chat.message_with_tool_calls`. Si no trae la lista, no hay mensajes (y el pedido
 * no se crea). Un mensaje sin `role` o que no es objeto queda como `ROL_ILEGIBLE`, en su lugar, sin
 * perder los demás.
 */
export function mensajesDeLaConversacion(conversacion: unknown): MensajeConversacion[] {
  const leida = ConversacionRetellSchema.safeParse(conversacion);
  if (!leida.success) return [];
  return leida.data.message_with_tool_calls.flatMap((mensaje) => {
    const leido = MensajeConversacionSchema.safeParse(mensaje);
    return [leido.success ? leido.data : { role: ROL_ILEGIBLE }];
  });
}
