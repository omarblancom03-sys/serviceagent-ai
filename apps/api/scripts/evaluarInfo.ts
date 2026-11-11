/*
 * Calibración de la información del restaurante (US-17, D62): manda las preguntas de
 * `preguntasInfo.json` a `POST /agente/info-restaurante` de una API que ya está corriendo y cuenta
 * en cuántas viene el tema correcto entre los resultados (la meta es todas). Aparte, y sin contar
 * para la meta, muestra qué devuelve lo que la información no tiene ("¿aceptan mascotas?"): lo
 * ideal es nada. Usa Workers AI de verdad, así que no corre en CI.
 *
 *   pnpm --filter @serviceagent/api evaluar-info
 *
 * Variables: `URL_API` (por defecto http://localhost:8787) y `RETELL_API_KEY`, la misma llave con
 * la que corre la API, para firmar las peticiones como Retell. Termina con código 1 si no se
 * cumple la meta. El resultado de la última corrida se anota en `evaluacionInfo.md`.
 */
import { readFileSync } from 'node:fs';

interface Pregunta {
  consulta: string;
  tema: string;
}

const archivo = new URL('./preguntasInfo.json', import.meta.url);
const { preguntas, sinRespuesta } = JSON.parse(readFileSync(archivo, 'utf-8')) as {
  preguntas: Pregunta[];
  sinRespuesta: string[];
};

const urlApi = process.env.URL_API ?? 'http://localhost:8787';
const llave = process.env.RETELL_API_KEY;
if (!llave) {
  console.error('Falta RETELL_API_KEY: la misma llave con la que corre la API.');
  process.exit(2);
}

/** Firma igual que Retell: `v=<timestamp>,d=<HMAC-SHA256(cuerpo + timestamp, llave) en hex>`. */
async function firmar(cuerpo: string, timestamp: number): Promise<string> {
  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(llave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(cuerpo + timestamp));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v=${timestamp},d=${hex}`;
}

/** Temas que devuelve la API, en orden. */
async function consultar(consulta: string): Promise<string[]> {
  const cuerpo = JSON.stringify({ name: 'info_restaurante', chat: {}, args: { consulta } });
  const res = await fetch(`${urlApi}/agente/info-restaurante`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Retell-Signature': await firmar(cuerpo, Date.now()),
    },
    body: cuerpo,
  });
  if (!res.ok) throw new Error(`"${consulta}": la API respondió ${res.status} ${await res.text()}`);
  const { resultados } = (await res.json()) as { resultados: { tema: string }[] };
  return resultados.map((r) => r.tema);
}

let aciertos = 0;
let solos = 0;
console.log(`${preguntas.length} preguntas contra ${urlApi}\n`);
for (const [i, { consulta, tema }] of preguntas.entries()) {
  const temas = await consultar(consulta);
  const acierto = temas.includes(tema);
  if (acierto) aciertos += 1;
  if (temas.length === 1 && acierto) solos += 1;
  console.log(
    `${acierto ? 'OK ' : 'NO '}${i + 1}. "${consulta}" (${tema}) → ${temas.join(' | ') || '(nada)'}`,
  );
}

let vacias = 0;
console.log(
  '\nLo que la información no tiene (lo ideal es que venga vacío; no cuenta para la meta):',
);
for (const consulta of sinRespuesta) {
  const temas = await consultar(consulta);
  if (temas.length === 0) vacias += 1;
  console.log(
    `${temas.length === 0 ? 'OK ' : 'NO '}"${consulta}" → ${temas.join(' | ') || '(nada)'}`,
  );
}

console.log(`\nCon su tema: ${aciertos} de ${preguntas.length} (solo su tema: ${solos}).`);
console.log(`Sin resultados cuando no hay respuesta: ${vacias} de ${sinRespuesta.length}.`);
process.exit(aciertos === preguntas.length ? 0 : 1);
