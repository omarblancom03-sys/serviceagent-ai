/*
 * Prueba del candado de `crear_pedido` contra la base real (US-08-P1-T1, D34): manda varias
 * llamadas idénticas a `POST /pedidos` AL MISMO TIEMPO y comprueba que se crea UN solo pedido y que
 * todas las respuestas traen el mismo folio. Los tests de Vitest usan un repo en memoria, así que
 * el candado por teléfono de la función SQL solo se puede probar así. No usa Retell (D22).
 *
 *   pnpm --filter @serviceagent/api probar-candado
 *
 * OJO: crea un pedido de prueba en la base a la que apunte la API ("Prueba Candado", una Orden de
 * chiles). En `serviceagent-dev` solo se corre con el OK de un PO (D16).
 *
 * Variables: `URL_API` (por defecto http://localhost:8787), `RETELL_API_KEY` (la misma llave con la
 * que corre la API, para firmar como Retell; se lee de `.dev.vars`), `LLAMADAS` (por defecto 2, de
 * 2 a 10) y `TELEFONO` (10 dígitos; por defecto uno al azar, para que cada corrida sea un pedido
 * nuevo y no el duplicado de la corrida anterior). Termina con código 1 si la prueba falla.
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

const llamadas = Number(process.env.LLAMADAS ?? '2');
if (!Number.isInteger(llamadas) || llamadas < 2 || llamadas > 10) {
  console.error('LLAMADAS debe ser un entero de 2 a 10.');
  process.exit(2);
}

/** Teléfono de prueba: 10 dígitos que empiezan con 55 5 y no chocan con la corrida anterior. */
const telefono =
  process.env.TELEFONO ?? `555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
if (!/^[2-9]\d{9}$/.test(telefono)) {
  console.error('TELEFONO debe tener 10 dígitos y no empezar con 0 ni 1.');
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

/*
 * El sobre que manda Retell en un agente de chat. La conversación trae la pregunta de confirmación
 * y el "sí" del cliente: sin eso, la API responde `faltaConfirmacion` y no crea nada (D48).
 */
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
    nombre: 'Prueba Candado',
    telefono,
  },
});

async function crearPedido(): Promise<Respuesta> {
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

console.log(
  `${llamadas} llamadas simultáneas a ${urlApi}/pedidos (teléfono de prueba ${telefono})\n`,
);

// Las firmas se calculan dentro de cada llamada; `Promise.all` las lanza sin esperar a la anterior.
const respuestas = await Promise.all(Array.from({ length: llamadas }, () => crearPedido()));
respuestas.forEach((r, i) => {
  console.log(
    `  ${i + 1}. HTTP ${r.status} · ok ${r.ok} · folio ${r.folio ?? '—'} · yaExistia ${r.yaExistia ?? '—'} · ${r.estado ?? '—'}`,
  );
});

// Una llamada más, ya sin carrera: tiene que devolver el mismo folio como duplicado.
const despues = await crearPedido();
console.log(
  `  después: HTTP ${despues.status} · folio ${despues.folio ?? '—'} · yaExistia ${despues.yaExistia ?? '—'}\n`,
);

const fallas: string[] = [];
if (respuestas.some((r) => r.status !== 200 || r.ok !== true)) {
  fallas.push('alguna llamada no respondió 200 con ok: true');
}
const folios = new Set(respuestas.map((r) => r.folio));
if (folios.size !== 1 || folios.has(undefined)) {
  fallas.push(`las respuestas traen folios distintos: ${[...folios].join(', ')}`);
}
const nuevos = respuestas.filter((r) => r.yaExistia === false).length;
if (nuevos !== 1) {
  fallas.push(`debió crearse exactamente un pedido y se crearon ${nuevos}`);
}
if (despues.folio !== respuestas[0]?.folio || despues.yaExistia !== true) {
  fallas.push('la llamada posterior no devolvió el mismo folio como duplicado');
}

if (fallas.length > 0) {
  console.error(`FALLÓ:\n- ${fallas.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `PASÓ: un solo pedido (#${respuestas[0]?.folio}) y el mismo folio en todas las respuestas.`,
);
