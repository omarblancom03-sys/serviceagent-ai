/**
 * Turnstile en `/pedir` (US-19-P1-T2, D68 y D77): lógica pura del token. El script y el widget
 * viven en `useTurnstile.ts`. El token sirve una sola vez y vence a los 300 s.
 */

/** Cuánto se espera un token antes de rendirse, por ejemplo si Managed pide la casilla. */
export const ESPERA_TOKEN_MS = 60_000;

/**
 * No se obtuvo token: `sin_llave` si la web se compiló sin `VITE_TURNSTILE_SITE_KEY` (reintentar
 * no ayuda); `fallo` si el script no cargó, el widget falló o tardó demasiado.
 */
export class ErrorTurnstile extends Error {
  readonly motivo: 'sin_llave' | 'fallo';

  constructor(motivo: 'sin_llave' | 'fallo') {
    super(`Turnstile: ${motivo}`);
    this.name = 'ErrorTurnstile';
    this.motivo = motivo;
  }
}

/** La llave del sitio sin espacios, o `null` si falta o está en blanco. */
export function leerLlaveSitio(valor: string | undefined): string | null {
  const limpia = valor?.trim() ?? '';
  return limpia === '' ? null : limpia;
}

/**
 * Guarda el último token del widget y se lo entrega a quien lo pida, una sola vez. Si todavía no
 * hay token, espera al siguiente (hasta `limiteMs`); si el widget falla mientras espera, rechaza.
 */
export class EsperaToken {
  private token: string | null = null;
  private fallido = false;
  private pendiente: {
    resolver: (token: string) => void;
    rechazar: (error: ErrorTurnstile) => void;
    temporizador: ReturnType<typeof setTimeout>;
  } | null = null;

  /** El widget falló y nadie lo ha reiniciado: hay que reiniciarlo antes de esperar. */
  get enFalla(): boolean {
    return this.fallido;
  }

  recibir(token: string): void {
    this.fallido = false;
    const pendiente = this.soltarPendiente();
    if (pendiente) pendiente.resolver(token);
    else this.token = token;
  }

  /** El token venció sin usarse; el widget trae otro solo. */
  vencer(): void {
    this.token = null;
  }

  /** El widget falló: quien esperaba se entera ya y el siguiente intento lo reinicia. */
  fallar(): void {
    this.token = null;
    this.fallido = true;
    this.soltarPendiente()?.rechazar(new ErrorTurnstile('fallo'));
  }

  /** Olvida el token y la falla; se usa al reiniciar el widget. */
  descartar(): void {
    this.token = null;
    this.fallido = false;
  }

  /** Entrega el token vigente y lo da por usado, o espera al siguiente. */
  tomar(limiteMs: number = ESPERA_TOKEN_MS): Promise<string> {
    if (this.token !== null) {
      const token = this.token;
      this.token = null;
      return Promise.resolve(token);
    }
    if (this.fallido) return Promise.reject(new ErrorTurnstile('fallo'));
    // Solo una apertura a la vez: si alguien ya esperaba, se le cancela.
    this.soltarPendiente()?.rechazar(new ErrorTurnstile('fallo'));
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.pendiente = null;
        rechazar(new ErrorTurnstile('fallo'));
      }, limiteMs);
      this.pendiente = { resolver, rechazar, temporizador };
    });
  }

  private soltarPendiente() {
    const pendiente = this.pendiente;
    if (pendiente) clearTimeout(pendiente.temporizador);
    this.pendiente = null;
    return pendiente;
  }
}
