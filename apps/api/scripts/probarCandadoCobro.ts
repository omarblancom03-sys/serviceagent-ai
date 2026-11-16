/*
 * Prueba del candado de `cobrar_pedido_caja` contra la base real (US-21, D66): crea un pedido de
 * prueba con `crear_pedido` y manda varios `POST /caja/pedidos/{folio}/cobrar` AL MISMO TIEMPO,
 * como si dos o más cajas lo cobraran a la vez. Comprueba que solo uno cobra (200) y que los demás
 * reciben 409 `ya_pagado`. Los tests de Vitest usan un repo en memoria y el ensayo SQL corre en
 * una sola transacción, así que el `for update` de la función solo se puede probar así. No usa
 * Retell (D22).
 *
 *   pnpm --filter @serviceagent/api probar-candado-cobro
 *
 * OJO: crea en la base a la que apunte la API un pedido de prueba por ronda ("Prueba Cobro", una
 * Orden de chiles) y lo deja pagado, con el pago a nombre de `ID_EMPLEADO`. Quien lo corre en
 * `serviceagent-dev` cancela o entrega esos pedidos al terminar; el script lista sus folios.
 *
 * Variables:
 * - `URL_API`: por defecto http://localhost:8787.
 * - `RETELL_API_KEY`: la misma llave con la que corre la API, para crear el pedido como Retell.
 * - `JWT_SECRET`: el mismo de la API, para firmar la sesión de caja (se lee de `.dev.vars`).
 * - `ID_EMPLEADO`: id (uuid) de un empleado activo con rol `caja`; queda como quien cobró.
 * - `LLAMADAS`: cuántos cobros simultáneos por ronda; por defecto 2, de 2 a 10.
 * - `RONDAS`: cuántas veces se repite la carrera, cada una con un pedido nuevo; de 1 a 20.
 *
 * Termina con código 1 si alguna ronda falla.
 *
 *   pnpm exec wrangler dev --var RETELL_API_KEY:llave-local          (en apps/api)
 *   RETELL_API_KEY=llave-local ID_EMPLEADO=<uuid> pnpm --filter @serviceagent/api probar-candado-cobro
 */
import { sign } from 'hono/jwt';

const urlApi = process.env.URL_API ?? 'http://localhost:8787';
const llaveRetell = process.env.RETELL_API_KEY;
const secretoJwt = process.env.JWT_SECRET;
const idEmpleado = process.env.ID_EMPLEADO;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!llaveRetell || !secretoJwt || !idEmpleado || !UUID.test(idEmpleado)) {
  console.error('Faltan RETELL_API_KEY, JWT_SECRET o ID_EMPLEADO (uuid de un empleado de caja).');
  process.exit(2);
}

function leerEntero(nombre: string, porDefecto: number, minimo: number, maximo: number): number {
  const valor = Number(process.env[nombre] ?? porDefecto);
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    console.error(`${nombre} debe ser un entero de ${minimo} a ${maximo}.`);
    process.exit(2);
  }
  return valor;
}

const llamadas = leerEntero('LLAMADAS', 2, 2, 10);
const rondas = leerEntero('RONDAS', 1, 1, 20);

/** Firma igual que Retell: `v=<timestamp>,d=<HMAC-SHA256(cuerpo + timestamp, llave) en hex>`. */
async function firmarRetell(cuerpo: string): Promise<string> {
  const timestamp = Date.now();
  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(llaveRetell),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(cuerpo + timestamp));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v=${timestamp},d=${hex}`;
}

/** Crea un pedido nuevo (teléfono al azar) con la confirmación del cliente en la conversación (D48). */
async function crearPedido(): Promise<number> {
  const telefono = `555${String(Math.floor(Math.random() * 9_000_000)).padStart(7, '0')}`;
  const cuerpo = JSON.stringify({
    name: 'crear_pedido',
    chat: {
      message_with_tool_calls: [
        { role: 'agent', content: 'Tu pedido: 1 Orden de chiles. ¿Confirmo tu pedido?' },
        { role: 'user', content: 'Sí' },
      ],
    },
    args: {
      productos: [{ producto: 'Orden de chiles', cantidad: 1 }],
      nombre: 'Prueba Cobro',
      telefono,
    },
  });
  const res = await fetch(`${urlApi}/pedidos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Retell-Signature': await firmarRetell(cuerpo),
    },
    body: cuerpo,
  });
  const datos = (await res.json().catch(() => ({}))) as { ok?: boolean; folio?: number };
  if (res.status !== 200 || datos.ok !== true || datos.folio === undefined) {
    throw new Error(`No se pudo crear el pedido de prueba (HTTP ${res.status}).`);
  }
  return datos.folio;
}

interface Respuesta {
  status: number;
  codigo?: string;
  montoCentavos?: number;
}

async function cobrar(folio: number, metodo: 'efectivo' | 'tarjeta', token: string) {
  const res = await fetch(`${urlApi}/caja/pedidos/${folio}/cobrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ metodo }),
  });
  const datos = (await res.json().catch(() => ({}))) as Omit<Respuesta, 'status'>;
  return { status: res.status, codigo: datos.codigo, montoCentavos: datos.montoCentavos };
}

const exp = Math.floor(Date.now() / 1000) + 15 * 60;
const token = await sign({ sub: idEmpleado, rol: 'caja', exp }, secretoJwt, 'HS256');

console.log(`${rondas} ronda(s) de ${llamadas} cobros simultáneos del mismo pedido en ${urlApi}`);

const creados: number[] = [];
let rondasConFalla = 0;
for (let ronda = 1; ronda <= rondas; ronda++) {
  console.log(`\nRonda ${ronda}`);
  const folio = await crearPedido();
  creados.push(folio);
  console.log(`  pedido de prueba #${folio}`);
  const respuestas = await Promise.all(
    Array.from({ length: llamadas }, (_, i) =>
      cobrar(folio, i % 2 ? 'tarjeta' : 'efectivo', token),
    ),
  );
  respuestas.forEach((r, i) =>
    console.log(`  ${i + 1}. HTTP ${r.status} · ${r.codigo ?? `cobró ${r.montoCentavos}`}`),
  );

  const fallas: string[] = [];
  const cobros = respuestas.filter((r) => r.status === 200).length;
  if (cobros !== 1) fallas.push(`debió cobrar exactamente una caja y cobraron ${cobros}`);
  if (respuestas.some((r) => r.status !== 200 && !(r.status === 409 && r.codigo === 'ya_pagado'))) {
    fallas.push('alguna caja respondió algo distinto de 200 o 409 ya_pagado');
  }
  if (fallas.length > 0) {
    rondasConFalla += 1;
    console.error(`  FALLÓ:\n  - ${fallas.join('\n  - ')}`);
  } else {
    console.log('  PASÓ');
  }
}

console.log(
  `\nPedidos de prueba creados y pagados (cancélalos o entrégalos): ${creados.map((f) => `#${f}`).join(', ')}`,
);
if (rondasConFalla > 0) {
  console.error(`FALLÓ en ${rondasConFalla} de ${rondas} ronda(s).`);
  // `exitCode` y no `process.exit(1)`, igual que en probarCandado.ts (Windows y `fetch`).
  process.exitCode = 1;
} else {
  console.log('PASÓ: un solo cobro por pedido; las demás cajas recibieron ya_pagado.');
}
