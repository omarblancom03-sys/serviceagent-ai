import {
  EmpleadoPublicoSchema,
  TokenPayloadSchema,
  type EmpleadoPublico,
  type TokenPayload,
} from '@serviceagent/shared';

/** Llave de `localStorage` donde vive la sesión del empleado. */
export const LLAVE_SESION = 'serviceagent.sesion';

/** Sesión del empleado en el navegador: el token y los datos que llegaron con el login. */
export interface SesionActiva {
  token: string;
  payload: TokenPayload;
  empleado: EmpleadoPublico;
}

/**
 * Lee el payload del JWT **sin verificar la firma**: eso solo lo puede hacer la API.
 * La web lo usa para saber el rol y la expiración y ordenar la navegación; la seguridad real
 * está en la API. Devuelve `null` si el token no tiene el formato esperado.
 */
export function leerPayload(token: string): TokenPayload | null {
  const parte = token.split('.')[1];
  if (!parte) return null;
  try {
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (caracter) => caracter.charCodeAt(0));
    const resultado = TokenPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

/** `true` si el token ya venció. `ahora` en milisegundos (para tests). */
export function tokenVencido(payload: TokenPayload, ahora: number = Date.now()): boolean {
  return payload.exp * 1000 <= ahora;
}

/** Arma la sesión a partir de la respuesta del login. `null` si el token no cuadra con el empleado. */
export function crearSesion(
  token: string,
  empleado: EmpleadoPublico,
  ahora: number = Date.now(),
): SesionActiva | null {
  const payload = leerPayload(token);
  if (!payload || tokenVencido(payload, ahora)) return null;
  if (payload.sub !== empleado.id || payload.rol !== empleado.rol) return null;
  return { token, payload, empleado };
}

/**
 * Recupera la sesión guardada en `localStorage`. Si está vencida, dañada o no cuadra con el
 * token, devuelve `null` (y quien la llame la borra).
 */
export function leerSesionGuardada(
  texto: string | null,
  ahora: number = Date.now(),
): SesionActiva | null {
  if (!texto) return null;
  try {
    const guardada = JSON.parse(texto) as { token?: unknown; empleado?: unknown };
    const empleado = EmpleadoPublicoSchema.safeParse(guardada.empleado);
    if (typeof guardada.token !== 'string' || !empleado.success) return null;
    return crearSesion(guardada.token, empleado.data, ahora);
  } catch {
    return null;
  }
}

/** Lo que se guarda en `localStorage`: solo el token y los datos públicos del empleado. */
export function serializarSesion({ token, empleado }: SesionActiva): string {
  return JSON.stringify({ token, empleado });
}
