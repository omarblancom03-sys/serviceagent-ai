import { TokenPayloadSchema, type Sesion } from '@serviceagent/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ErrorApi, pedirApi } from '../lib/api';
import {
  crearSesion,
  LLAVE_SESION,
  leerSesionGuardada,
  serializarSesion,
  type SesionActiva,
} from './token';

interface ValorSesion {
  /** Empleado con sesión iniciada, o `null`. */
  sesion: SesionActiva | null;
  /** Guarda la sesión que devolvió `POST /auth/login`. `false` si el token no es válido. */
  iniciarSesion(respuesta: Sesion): boolean;
  cerrarSesion(): void;
  /** Llama a la API con el token del empleado. Si la API responde 401, cierra la sesión. */
  pedirConSesion: typeof pedirApi;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

// localStorage puede fallar (modo privado, almacenamiento bloqueado): la app sigue sin sesión.
function leerAlmacenada(): SesionActiva | null {
  try {
    const sesion = leerSesionGuardada(localStorage.getItem(LLAVE_SESION));
    if (!sesion) localStorage.removeItem(LLAVE_SESION);
    return sesion;
  } catch {
    return null;
  }
}

function guardar(sesion: SesionActiva | null) {
  try {
    if (sesion) localStorage.setItem(LLAVE_SESION, serializarSesion(sesion));
    else localStorage.removeItem(LLAVE_SESION);
  } catch {
    // Sin almacenamiento la sesión dura solo mientras la pestaña esté abierta.
  }
}

/**
 * Sesión del empleado (docs/negocio.md → Autenticación y roles). El token vive en `localStorage`
 * hasta que vence (8 h). Al cargar la app se descarta si venció y se confirma con
 * `GET /auth/sesion`; al llegar la hora de `exp` se cierra sola.
 */
export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<SesionActiva | null>(leerAlmacenada);

  const cerrarSesion = useCallback(() => {
    guardar(null);
    setSesion(null);
  }, []);

  const iniciarSesion = useCallback((respuesta: Sesion) => {
    const nueva = crearSesion(respuesta.token, respuesta.empleado);
    guardar(nueva);
    setSesion(nueva);
    return nueva !== null;
  }, []);

  const token = sesion?.token ?? null;
  const exp = sesion?.payload.exp ?? null;

  // Cierra la sesión justo cuando vence el token.
  useEffect(() => {
    if (exp === null) return;
    const temporizador = setTimeout(cerrarSesion, Math.max(0, exp * 1000 - Date.now()));
    return () => clearTimeout(temporizador);
  }, [exp, cerrarSesion]);

  // Confirma con la API que el token guardado sigue siendo válido (firma y secreto actuales).
  useEffect(() => {
    if (!token) return;
    pedirApi('/auth/sesion', TokenPayloadSchema, { token }).catch((error: unknown) => {
      if (error instanceof ErrorApi && error.status === 401) cerrarSesion();
    });
  }, [token, cerrarSesion]);

  const pedirConSesion = useCallback<typeof pedirApi>(
    async (ruta, esquema, opciones = {}) => {
      try {
        return await pedirApi(ruta, esquema, { ...opciones, token });
      } catch (error) {
        if (error instanceof ErrorApi && error.status === 401) cerrarSesion();
        throw error;
      }
    },
    [token, cerrarSesion],
  );

  const valor = useMemo(
    () => ({ sesion, iniciarSesion, cerrarSesion, pedirConSesion }),
    [sesion, iniciarSesion, cerrarSesion, pedirConSesion],
  );

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): ValorSesion {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion debe usarse dentro de <SesionProvider>');
  return valor;
}
