import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorTurnstile, EsperaToken, leerLlaveSitio } from './turnstile';

/**
 * Widget de Turnstile de `/pedir` con el script de Cloudflare, sin dependencia npm. Se carga solo
 * en esta pantalla, desde la URL oficial: Cloudflare pide no copiarlo ni cachearlo.
 * Referencia: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Lo que usamos de `window.turnstile`. */
interface ApiTurnstile {
  render(contenedor: HTMLElement, opciones: Record<string, unknown>): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

let cargando: Promise<ApiTurnstile> | null = null;

/** Inserta el script una sola vez. Si falla, la siguiente llamada lo vuelve a intentar. */
function cargarScript(): Promise<ApiTurnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  cargando ??= new Promise<ApiTurnstile>((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = URL_SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolver(window.turnstile) : rechazar(new ErrorTurnstile('fallo'));
    script.onerror = () => {
      script.remove();
      rechazar(new ErrorTurnstile('fallo'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    cargando = null;
    throw error;
  });
  return cargando;
}

/**
 * Monta el widget en `contenedorRef` al cargar la pantalla, invisible salvo que Managed pida la
 * casilla. `obtenerToken` da el token vigente o espera uno nuevo; `renovar` reinicia el widget
 * (después de cada uso del token y al iniciar otra conversación).
 */
export function useTurnstile(
  valorLlave: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY,
) {
  const llave = leerLlaveSitio(valorLlave);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [espera] = useState(() => new EsperaToken());
  const widget = useRef<{ api: ApiTurnstile; id: string } | null>(null);

  const montar = useCallback(async () => {
    if (!llave || widget.current) return;
    const api = await cargarScript();
    if (!contenedorRef.current || widget.current) return;
    const id = api.render(contenedorRef.current, {
      sitekey: llave,
      appearance: 'interaction-only',
      theme: 'light',
      callback: (token: string) => espera.recibir(token),
      'expired-callback': () => espera.vencer(),
      'timeout-callback': () => espera.vencer(),
      'error-callback': () => espera.fallar(),
    });
    if (!id) throw new ErrorTurnstile('fallo');
    widget.current = { api, id };
  }, [llave, espera]);

  useEffect(() => {
    if (!llave) console.warn('Turnstile: falta VITE_TURNSTILE_SITE_KEY; el chat no puede abrir.');
    montar().catch(() => espera.fallar());
    return () => {
      widget.current?.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [llave, montar, espera]);

  const renovar = useCallback(() => {
    espera.descartar();
    if (widget.current) widget.current.api.reset(widget.current.id);
  }, [espera]);

  const obtenerToken = useCallback(async (): Promise<string> => {
    if (!llave) throw new ErrorTurnstile('sin_llave');
    try {
      await montar();
    } catch {
      throw new ErrorTurnstile('fallo');
    }
    if (espera.enFalla) renovar();
    return espera.tomar();
  }, [llave, montar, espera, renovar]);

  return { contenedorRef, obtenerToken, renovar };
}
