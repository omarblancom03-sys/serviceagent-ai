/*
 * Prueba del candado de `crear_pedido` contra la base real (US-08-P1-T1, D34): manda varias
 * llamadas idénticas a `POST /pedidos` AL MISMO TIEMPO y comprueba que se crea UN solo pedido y que
 * todas las respuestas traen el mismo folio. Los tests de Vitest usan un repo en memoria, así que
 * el candado por teléfono de la función SQL solo se puede probar así. No usa Retell (D22).
 *
 *   pnpm --filter @serviceagent/api probar-candado
 *
 * OJO: crea pedidos de prueba en la base a la que apunte la API ("Prueba Candado", una Orden de
 * chiles cada uno): uno por ronda, o uno por llamada en el modo de control. Quien los crea en
 * `serviceagent-dev` los cancela al terminar; el script lista sus folios al final.
 *
 * Variables:
 * - `URL_API`: por defecto http://localhost:8787.
 * - `RETELL_API_KEY`: la misma llave con la que corre la API, para firmar como Retell (se lee de
 *   `.dev.vars`).
 * - `LLAMADAS`: cuántas llamadas simultáneas por ronda; por defecto 2, de 2 a 10.
 * - `RONDAS`: cuántas veces se repite la carrera, cada una con otro teléfono; por defecto 1, de 1
 *   a 20. Una carrera no siempre se da: repetirla da más confianza.
 * - `TELEFONO`: 10 dígitos para la primera ronda; por defecto uno al azar, para que cada corrida
 *   sea un pedido nuevo y no el duplicado de la anterior.
 * - `CONTROL=1`: modo de control. Cada llamada usa un teléfono distinto, así que deben salir tantos
 *   pedidos como llamadas, con folios distintos. Comprueba que la prueba sí distingue un pedido de
 *   varios y que el candado no frena a clientes distintos.
 *
 * Termina con código 1 si alguna ronda falla.
 *
 * En local no hace falta la llave real de Retell: la firma solo tiene que coincidir con la de la
 * API. Basta arrancarla con un valor cualquiera y usar el mismo aquí:
 *
 *   pnpm exec wrangler dev --var RETELL_API_KEY:llave-local          (en apps/api)
 *   RETELL_API_KEY=llave-local pnpm --filter @serviceagent/api probar-candado
 */

interface Respuesta {
  status: number;
  ok?: boolean;
  folio?: number;
  yaExistia?: boolean;
  estado?: string;
}

const urlApi = process.env.URL_API ?? 'http://localhost:8787';
const llave = process.env.RETELL_API_KEY;
if (!llave) {
  console.error('Falta RETELL_API_KEY: la misma llave con la que corre la API.');
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
const control = process.env.CONTROL === '1';

const TELEFONO_VALIDO = /^[2-9]\d{9}$/;
if (process.env.TELEFONO !== undefined && !TELEFONO_VALIDO.test(process.env.TELEFONO)) {
  console.error('TELEFONO debe tener 10 dígitos y no empezar con 0 ni 1.');
  process.exit(2);
}

/**
 * Teléfonos de prueba: empiezan con 555 y van consecutivos desde uno al azar (o desde `TELEFONO`),
 * así ninguno se repite entre rondas ni entre las llamadas del modo de control.
 */
const primerTelefono = Number(
  process.env.TELEFONO ?? `555${String(Math.floor(Math.random() * 9_000_000)).padStart(7, '0')}`,
);
let telefonosUsados = 0;
const siguienteTelefono = () => String(primerTelefono + telefonosUsados++);

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

/*
 * El sobre que manda Retell en un agente de chat. La conversación trae la pregunta de confirmación
 * y el "sí" del cliente: sin eso, la API responde `faltaConfirmacion` y no crea nada (D48).
 */
const cuerpoPara = (telefono: string) =>
  JSON.stringify({
    name: 'crear_pedido',
    chat: {
      message_with_tool_calls: [
        { role: 'agent', content: 'Tu pedido: 1 Orden de chiles. ¿Confirmo tu pedido?' },
        { role: 'user', content: 'Sí' },
      ],
    },
    args: {
      productos: [{ producto: 'Orden de chiles', cantidad: 1 }],
      nombre: 'Prueba Candado',
      telefono,
    },
  });

async function crearPedido(telefono: string): Promise<Respuesta> {
  const cuerpo = cuerpoPara(telefono);
  const res = await fetch(`${urlApi}/pedidos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Retell-Signature': await firmar(cuerpo, Date.now()),
    },
    body: cuerpo,
  });
  const datos = (await res.json().catch(() => ({}))) as Omit<Respuesta, 'status'>;
  return {
    status: res.status,
    ok: datos.ok,
    folio: datos.folio,
    yaExistia: datos.yaExistia,
    estado: datos.estado,
  };
}

const linea = (r: Respuesta) =>
  `HTTP ${r.status} · ok ${r.ok} · folio ${r.folio ?? '—'} · yaExistia ${r.yaExistia ?? '—'} · ${r.estado ?? '—'}`;

const creados = new Set<number>();
const anotar = (respuestas: Respuesta[]) => {
  for (const r of respuestas) if (r.folio !== undefined) creados.add(r.folio);
};

/** La carrera: las mismas llamadas, con el mismo teléfono, a la vez. Debe salir un solo pedido. */
async function rondaDeCarrera(): Promise<string[]> {
  const telefono = siguienteTelefono();
  console.log(`  teléfono de prueba ${telefono}`);
  // Las firmas se calculan dentro de cada llamada; `Promise.all` las lanza sin esperar a la anterior.
  const respuestas = await Promise.all(
    Array.from({ length: llamadas }, () => crearPedido(telefono)),
  );
  respuestas.forEach((r, i) => console.log(`  ${i + 1}. ${linea(r)}`));
  // Una llamada más, ya sin carrera: tiene que devolver el mismo folio como duplicado.
  const despues = await crearPedido(telefono);
  console.log(`  después: ${linea(despues)}`);
  anotar([...respuestas, despues]);

  const fallas: string[] = [];
  if (respuestas.some((r) => r.status !== 200 || r.ok !== true)) {
    fallas.push('alguna llamada no respondió 200 con ok: true');
  }
  const folios = new Set(respuestas.map((r) => r.folio));
  if (folios.size !== 1 || folios.has(undefined)) {
    fallas.push(`las respuestas traen folios distintos: ${[...folios].join(', ')}`);
  }
  const nuevos = respuestas.filter((r) => r.yaExistia === false).length;
  if (nuevos !== 1) fallas.push(`debió crearse exactamente un pedido y se crearon ${nuevos}`);
  if (despues.folio !== respuestas[0]?.folio || despues.yaExistia !== true) {
    fallas.push('la llamada posterior no devolvió el mismo folio como duplicado');
  }
  return fallas;
}

/** El control: cada llamada con su teléfono. Deben salir tantos pedidos como llamadas. */
async function rondaDeControl(): Promise<string[]> {
  const telefonos = Array.from({ length: llamadas }, () => siguienteTelefono());
  const respuestas = await Promise.all(telefonos.map((telefono) => crearPedido(telefono)));
  respuestas.forEach((r, i) => console.log(`  ${i + 1}. teléfono ${telefonos[i]} · ${linea(r)}`));
  anotar(respuestas);

  const fallas: string[] = [];
  if (respuestas.some((r) => r.status !== 200 || r.ok !== true)) {
    fallas.push('alguna llamada no respondió 200 con ok: true');
  }
  const folios = new Set(respuestas.map((r) => r.folio));
  if (folios.size !== llamadas || folios.has(undefined)) {
    fallas.push(`debieron salir ${llamadas} folios distintos y salieron ${folios.size}`);
  }
  if (respuestas.some((r) => r.yaExistia !== false)) {
    fallas.push('algún pedido salió como duplicado aunque el teléfono era otro');
  }
  return fallas;
}

console.log(
  control
    ? `Control: ${rondas} ronda(s) de ${llamadas} llamadas simultáneas con teléfonos distintos a ${urlApi}/pedidos`
    : `${rondas} ronda(s) de ${llamadas} llamadas simultáneas idénticas a ${urlApi}/pedidos`,
);

let rondasConFalla = 0;
for (let ronda = 1; ronda <= rondas; ronda++) {
  console.log(`\nRonda ${ronda}`);
  const fallas = control ? await rondaDeControl() : await rondaDeCarrera();
  if (fallas.length > 0) {
    rondasConFalla += 1;
    console.error(`  FALLÓ:\n  - ${fallas.join('\n  - ')}`);
  } else {
    console.log('  PASÓ');
  }
}

const folios = [...creados].sort((a, b) => a - b).map((folio) => `#${folio}`);
console.log(
  `\nPedidos de prueba creados (cancélalos al terminar): ${folios.join(', ') || 'ninguno'}`,
);

if (rondasConFalla > 0) {
  console.error(`FALLÓ en ${rondasConFalla} de ${rondas} ronda(s).`);
  // `exitCode` y no `process.exit(1)`: en Windows, salir de golpe con conexiones de `fetch` todavía
  // cerrándose hace que Node termine con un error interno en lugar del código 1.
  process.exitCode = 1;
} else {
  console.log(
    control
      ? `PASÓ el control: ${llamadas} pedidos distintos por ronda.`
      : 'PASÓ: un solo pedido por ronda y el mismo folio en todas sus respuestas.',
  );
}
