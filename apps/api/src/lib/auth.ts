import { TokenPayloadSchema, type Rol, type TokenPayload } from '@serviceagent/shared';
import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';
import type { AppEnv } from './env';

/**
 * JWT propio (docs/negocio.md → Autenticación y roles; decisión D12).
 * Lo firma y verifica esta API con `JWT_SECRET`. No depende de Supabase.
 */

const ALGORITMO = 'HS256';
const LARGO_MINIMO_SECRETO = 32;
const DURACION_POR_DEFECTO = '8h';
const SEGUNDOS_POR_UNIDAD = { s: 1, m: 60, h: 3600 } as const;

/** Devuelve el secreto o falla con un mensaje claro si falta o es demasiado corto. */
export function leerSecreto(secreto: string | undefined): string {
  if (!secreto || secreto.length < LARGO_MINIMO_SECRETO) {
    throw new Error(
      'JWT_SECRET falta o tiene menos de 32 caracteres. Genéralo con: openssl rand -base64 32',
    );
  }
  return secreto;
}

/** Convierte `8h`, `30m` o `900s` a segundos. */
export function duracionEnSegundos(texto: string = DURACION_POR_DEFECTO): number {
  const coincidencia = /^(\d+)([smh])$/.exec(texto.trim());
  const cantidad = Number(coincidencia?.[1]);
  const unidad = coincidencia?.[2] as keyof typeof SEGUNDOS_POR_UNIDAD | undefined;
  if (!unidad || !Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error(`JWT_EXPIRES_IN inválido: "${texto}". Usa por ejemplo 8h, 30m o 900s.`);
  }
  return cantidad * SEGUNDOS_POR_UNIDAD[unidad];
}

/** Firma un token con exactamente `sub`, `rol` y `exp`. `ahora` en milisegundos (para tests). */
export async function firmarToken(
  datos: { sub: string; rol: Rol },
  secreto: string,
  duracionSegundos: number,
  ahora: number = Date.now(),
): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(ahora / 1000) + duracionSegundos;
  const payload: TokenPayload = { sub: datos.sub, rol: datos.rol, exp };
  const token = await sign(payload, leerSecreto(secreto), ALGORITMO);
  return { token, exp };
}

/** Payload del token si la firma, el algoritmo, la expiración y los campos son válidos; si no, `null`. */
export async function verificarToken(token: string, secreto: string): Promise<TokenPayload | null> {
  const clave = leerSecreto(secreto);
  try {
    const payload = await verify(token, clave, ALGORITMO);
    const resultado = TokenPayloadSchema.safeParse(payload);
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

/**
 * Protege una ruta: exige `Authorization: Bearer <token>` válido y uno de los `roles`.
 * `admin` siempre pasa. Responde 401 sin token o con token inválido/vencido y 403 con otro rol.
 */
export function requiereRol(...roles: Rol[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const encabezado = c.req.header('Authorization');
    const token = encabezado?.startsWith('Bearer ') ? encabezado.slice('Bearer '.length) : null;
    const sesion = token ? await verificarToken(token, c.env.JWT_SECRET) : null;

    if (!sesion) {
      return c.json({ error: 'Sesión inválida o vencida. Vuelve a iniciar sesión.' }, 401);
    }
    if (sesion.rol !== 'admin' && !roles.includes(sesion.rol)) {
      return c.json({ error: 'No tienes permiso para esta acción.' }, 403);
    }

    c.set('sesion', sesion);
    await next();
  });
}
