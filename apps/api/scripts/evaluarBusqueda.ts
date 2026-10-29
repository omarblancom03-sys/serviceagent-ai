/*
 * Evaluación de la búsqueda semántica del menú (criterio 5 de US-16): manda las 20 preguntas de
 * `preguntasBusqueda.json` a `POST /agente/buscar-menu` de una API que ya está corriendo y cuenta
 * en cuántas sale un platillo correcto en el top 3 (la meta es 18 de 20). Aparte, y sin contar
 * para la meta, muestra qué devuelve lo que el menú no tiene ("ramen"): lo ideal es nada. Usa
 * Workers AI de verdad, así que no corre en CI.
 *
 *   pnpm --filter @serviceagent/api evaluar-busqueda
 *
 * Variables: `URL_API` (por defecto http://localhost:8787) y `RETELL_API_KEY`, la misma llave con
 * la que corre la API, para firmar las peticiones como Retell. Termina con código 1 si no se
 * cumple la meta. El resultado de la última corrida se anota en `evaluacionBusqueda.md`.
 */
import { readFileSync } from 'node:fs';

interface Pregunta {
  consulta: string;
  correctos: string[];
}

const META = 18;
const TOP = 3;

const archivo = new URL('./preguntasBusqueda.json', import.meta.url);
const { preguntas, sinResultados } = JSON.parse(readFileSync(archivo, 'utf-8')) as {
  preguntas: Pregunta[];
  sinResultados: string[];
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

/** Nombres de los platillos que devuelve la búsqueda, en orden. */
async function buscar(consulta: string): Promise<string[]> {
  const cuerpo = JSON.stringify({ name: 'buscar_menu', chat: {}, args: { consulta } });
  const res = await fetch(`${urlApi}/agente/buscar-menu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Retell-Signature': await firmar(cuerpo, Date.now()),
    },
    body: cuerpo,
  });
  if (!res.ok) throw new Error(`"${consulta}": la API respondió ${res.status} ${await res.text()}`);
  const { resultados } = (await res.json()) as { resultados: { nombre: string }[] };
  return resultados.map((r) => r.nombre);
}

let aciertos = 0;
console.log(`Top ${TOP} de ${preguntas.length} preguntas contra ${urlApi}\n`);
for (const [i, { consulta, correctos }] of preguntas.entries()) {
  const nombres = await buscar(consulta);
  const posicion = nombres.findIndex((nombre) => correctos.includes(nombre));
  const acierto = posicion !== -1 && posicion < TOP;
  if (acierto) aciertos += 1;
  const marca = acierto ? 'OK ' : 'NO ';
  const donde = posicion === -1 ? 'no salió' : `#${posicion + 1}`;
  console.log(`${marca}${i + 1}. "${consulta}" (${donde}) → ${nombres.join(' | ') || '(nada)'}`);
}

let vacias = 0;
console.log('\nLo que el menú no tiene (lo ideal es que venga vacío; no cuenta para la meta):');
for (const consulta of sinResultados) {
  const nombres = await buscar(consulta);
  if (nombres.length === 0) vacias += 1;
  console.log(
    `${nombres.length === 0 ? 'OK ' : 'NO '}"${consulta}" → ${nombres.join(' | ') || '(nada)'}`,
  );
}

console.log(`\nAciertos en el top ${TOP}: ${aciertos} de ${preguntas.length} (meta: ${META}).`);
console.log(`Sin resultados cuando no hay nada: ${vacias} de ${sinResultados.length}.`);
process.exit(aciertos >= META ? 0 : 1);
