/**
 * Hash de PIN (decisión D13): HMAC-SHA256 con `PIN_PEPPER` y después PBKDF2-SHA256 con sal por
 * empleado. Mismo código en Workers y en Node, con Web Crypto y sin dependencias.
 *
 * Un PIN de 4 dígitos solo tiene 10 000 combinaciones: sin el pepper (secreto del servidor que no
 * vive en la base), un hash robado no se puede atacar probándolas. Las iteraciones son pocas por el
 * límite de 10 ms de CPU del plan Free de Workers.
 *
 * Formato guardado: `pbkdf2_sha256$<iteraciones>$<sal base64>$<hash base64>`.
 * Las iteraciones viajan dentro del hash, así que cambiar `ITERACIONES_PIN` no invalida los PIN
 * que ya existen; cambiar `PIN_PEPPER`, sí. Este archivo no importa nada para que
 * `scripts/hashPin.ts` lo use desde Node.
 */
export const ITERACIONES_PIN = 2_000;

const PREFIJO = 'pbkdf2_sha256';
const BYTES_SAL = 16;
const BITS_HASH = 256;
const LARGO_MINIMO_PEPPER = 32;

/** Devuelve el pepper o falla con un mensaje claro si falta o es demasiado corto. */
export function leerPepper(pepper: string | undefined): string {
  if (!pepper || pepper.length < LARGO_MINIMO_PEPPER) {
    throw new Error(
      'PIN_PEPPER falta o tiene menos de 32 caracteres. Genéralo con: openssl rand -base64 32',
    );
  }
  return pepper;
}

export async function hashPin(
  pin: string,
  pepper: string,
  iteraciones = ITERACIONES_PIN,
): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(BYTES_SAL));
  const hash = await derivar(pin, pepper, sal, iteraciones);
  return [PREFIJO, iteraciones, aBase64(sal), aBase64(hash)].join('$');
}

/**
 * `true` solo si `pin` corresponde a `guardado`. Un hash con formato inválido nunca coincide.
 * Sin pepper válido lanza error: es un problema de configuración, no un PIN incorrecto.
 */
export async function verificarPin(
  pin: string,
  guardado: string,
  pepper: string,
): Promise<boolean> {
  leerPepper(pepper);
  const partes = guardado.split('$');
  const [prefijo, iteracionesTexto, salTexto, hashTexto] = partes;
  const iteraciones = Number(iteracionesTexto);
  if (
    partes.length !== 4 ||
    prefijo !== PREFIJO ||
    !Number.isInteger(iteraciones) ||
    iteraciones < 1 ||
    !salTexto ||
    !hashTexto
  ) {
    return false;
  }

  let sal: Uint8Array<ArrayBuffer>;
  let esperado: Uint8Array<ArrayBuffer>;
  try {
    sal = deBase64(salTexto);
    esperado = deBase64(hashTexto);
  } catch {
    return false;
  }

  const calculado = await derivar(pin, pepper, sal, iteraciones);
  return igualesEnTiempoConstante(calculado, esperado);
}

async function derivar(
  pin: string,
  pepper: string,
  sal: Uint8Array<ArrayBuffer>,
  iteraciones: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const codificador = new TextEncoder();
  const clavePepper = await crypto.subtle.importKey(
    'raw',
    codificador.encode(leerPepper(pepper)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const pinConPepper = await crypto.subtle.sign('HMAC', clavePepper, codificador.encode(pin));

  const clave = await crypto.subtle.importKey('raw', pinConPepper, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
    clave,
    BITS_HASH,
  );
  return new Uint8Array(bits);
}

/** Recorre todos los bytes aunque encuentre una diferencia, para no filtrar información por el tiempo. */
function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diferencia === 0;
}

function aBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(texto), (caracter) => caracter.charCodeAt(0));
}
