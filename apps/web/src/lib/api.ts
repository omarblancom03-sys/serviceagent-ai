const URL_API = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

/** Cualquier esquema de zod de `@serviceagent/shared` (solo se usa su `parse`). */
interface Esquema<T> {
  parse(datos: unknown): T;
}

interface OpcionesApi {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  token?: string | null;
}

/** La API respondió con un estado que no es 2xx. `cuerpo` es el JSON de error, si lo hubo. */
export class ErrorApi extends Error {
  readonly status: number;
  readonly cuerpo: unknown;

  constructor(status: number, cuerpo: unknown) {
    super(`La API respondió ${status}`);
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

/**
 * Llama a la API y valida la respuesta con `esquema`.
 * Lanza `ErrorApi` si el estado no es 2xx, y el error de `fetch` si no hay conexión.
 */
export async function pedirApi<T>(
  ruta: string,
  esquema: Esquema<T>,
  { metodo = 'GET', cuerpo, token }: OpcionesApi = {},
): Promise<T> {
  const encabezados: Record<string, string> = {};
  if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';
  if (token) encabezados.Authorization = `Bearer ${token}`;

  const respuesta = await fetch(`${URL_API}${ruta}`, {
    method: metodo,
    headers: encabezados,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const json: unknown = await respuesta.json().catch(() => null);

  if (!respuesta.ok) throw new ErrorApi(respuesta.status, json);
  return esquema.parse(json);
}
