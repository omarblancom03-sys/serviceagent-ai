/*
 * Ejemplos reales de `parecido` (US-15-P1, D72): para cada texto que el menú no tiene, muestra los
 * 3 platillos más parecidos según los embeddings de `buscar_menu` y su similitud coseno, y cuál
 * sale como `parecido` con el umbral actual. Sirve para revisar el umbral con casos de verdad.
 * Usa Workers AI real (con `getPlatformProxy` de Wrangler, sin levantar el Worker) y la función
 * `buscar_platillos_similares` de la base de `.dev.vars`. Solo lee: no sincroniza el índice.
 *
 *   pnpm --filter @serviceagent/api evaluar-parecidos
 *   pnpm --filter @serviceagent/api evaluar-parecidos -- "pizza de pepperoni" "sushi"
 *
 * Necesita sesión de Wrangler (el binding `AI` siempre es remoto y tiene costo, muy bajo) y
 * `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `apps/api/.dev.vars`.
 *
 * El modelo y el umbral son los de `src/services/busquedaMenu.ts` (MODELO_EMBEDDINGS y
 * UMBRAL_SIMILITUD): si cambian allá, cambian aquí. Node no resuelve los imports de `src` sin
 * extensión, por eso van copiados.
 */
import { createClient } from '@supabase/supabase-js';
import { getPlatformProxy } from 'wrangler';

const MODELO = '@cf/baai/bge-m3';
const UMBRAL = 0.47;
const POR_DEFECTO = [
  'pizza de pepperoni',
  'tacos al pastor',
  'coca',
  'sushi',
  'hamburguesa clásica',
  'alitas',
  'helado de pistache',
];
const consultas = process.argv.slice(2).filter((a) => a !== '--');
const textos = consultas.length > 0 ? consultas : POR_DEFECTO;

const url = process.env.SUPABASE_URL;
const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !llave) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (se leen de .dev.vars).');
  process.exit(2);
}

interface Similar {
  id_platillo: number;
  similitud: number;
}

const proxy = await getPlatformProxy<{ AI: Ai }>();
try {
  const cliente = createClient(url, llave, { auth: { persistSession: false } });
  const { data: platillos, error } = await cliente.from('platillo').select('id_platillo, nombre');
  if (error) throw new Error(`No se pudo leer el menú: ${error.message}`);
  const nombre = new Map(
    (platillos ?? []).map((p: { id_platillo: number; nombre: string }) => [
      p.id_platillo,
      p.nombre,
    ]),
  );

  const respuesta = (await proxy.env.AI.run(MODELO, { text: textos, truncate_inputs: true })) as {
    data: number[][];
  };
  console.log(`Umbral: ${UMBRAL} · modelo ${MODELO}\n`);
  for (const [i, texto] of textos.entries()) {
    const { data, error: errorRpc } = await cliente.rpc('buscar_platillos_similares', {
      p_embedding: `[${(respuesta.data[i] ?? []).join(',')}]`,
      p_modelo: MODELO,
      p_limite: 3,
    });
    if (errorRpc) throw new Error(`No se pudo buscar: ${errorRpc.message}`);
    const similares = (data ?? []) as Similar[];
    const top = similares.map(
      (s) => `${nombre.get(s.id_platillo) ?? s.id_platillo} (${s.similitud.toFixed(3)})`,
    );
    const mejor = similares[0];
    const parecido = mejor && mejor.similitud >= UMBRAL ? nombre.get(mejor.id_platillo) : null;
    console.log(`"${texto}" → parecido: ${parecido ?? 'null'}\n   top 3: ${top.join(' · ')}`);
  }
} finally {
  await proxy.dispose();
}
