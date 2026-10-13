/** Un pedazo del texto de un mensaje: texto normal o una URL que se muestra como enlace. */
export type Segmento = { tipo: 'texto'; valor: string } | { tipo: 'enlace'; url: string };

// Solo http y https: cualquier otro esquema (javascript:, data:…) queda como texto.
const PATRON_URL = /https?:\/\/[^\s<>"]+/gi;
// Puntuación que cierra una oración y no forma parte de la URL: "mira https://x.com."
const PUNTUACION_FINAL = /[.,;:!?)\]}'"»]+$/;

function esUrlSegura(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Separa un mensaje en texto y enlaces para pintarlo sin HTML. */
export function separarEnlaces(texto: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let textoPendiente = '';
  let ultimo = 0;

  for (const coincidencia of texto.matchAll(PATRON_URL)) {
    const crudo = coincidencia[0];
    const url = crudo.replace(PUNTUACION_FINAL, '');
    textoPendiente += texto.slice(ultimo, coincidencia.index);
    ultimo = coincidencia.index + crudo.length;

    if (!esUrlSegura(url)) {
      textoPendiente += crudo;
      continue;
    }
    if (textoPendiente) segmentos.push({ tipo: 'texto', valor: textoPendiente });
    segmentos.push({ tipo: 'enlace', url });
    textoPendiente = crudo.slice(url.length);
  }

  textoPendiente += texto.slice(ultimo);
  if (textoPendiente) segmentos.push({ tipo: 'texto', valor: textoPendiente });
  return segmentos;
}
