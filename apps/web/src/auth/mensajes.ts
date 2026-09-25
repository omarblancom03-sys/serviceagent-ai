import { ErrorAuthSchema } from '@serviceagent/shared';

/** Texto para el empleado según la respuesta de `POST /auth/login` que no fue 200. */
export function mensajeErrorLogin(status: number, cuerpo: unknown): string {
  const error = ErrorAuthSchema.safeParse(cuerpo);
  const datos = error.success ? error.data : null;

  if (status === 423) {
    const minutos = datos?.minutosRestantes;
    return minutos
      ? `Demasiados intentos. Intenta de nuevo en ${minutos} min.`
      : 'Demasiados intentos. Intenta de nuevo más tarde.';
  }
  if (status === 401) {
    const restantes = datos?.intentosRestantes;
    if (restantes === undefined) return 'PIN incorrecto.';
    return `PIN incorrecto. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`;
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo o avisa al administrador.';
}
