const URL_API = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

/** Cualquier esquema de zod de `@serviceagent/shared` (solo se usa su `parse`). */
interface Esquema<T> {
  parse(datos: unknown): T;
}

/** El servidor respondió con un estado que no es 2xx. `cuerpo` es el JSON de error, si lo hubo. */
export class ErrorApi extends Error {
  readonly status: number;
  readonly cuerpo: unknown;

  constructor(status: number, cuerpo: unknown) {
    super(`El servidor respondió ${status}`);
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

/**
 * `POST` con JSON al servidor del simulador y valida la respuesta con `esquema`.
 * Lanza `ErrorApi` si el estado no es 2xx, y el error de `fetch` si no hay conexión.
 */
export async function enviarApi<T>(ruta: string, esquema: Esquema<T>, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(`${URL_API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const json: unknown = await respuesta.json().catch(() => null);

  if (!respuesta.ok) throw new ErrorApi(respuesta.status, json);
  return esquema.parse(json);
}
