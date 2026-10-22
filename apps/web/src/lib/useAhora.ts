import { useEffect, useState } from 'react';

/**
 * Hora actual (ms) que se actualiza cada `intervaloMs` y al volver la pestaña a primer plano: con
 * la pestaña oculta el navegador frena los intervalos. Quien la usa calcula siempre a partir de
 * esta hora, nunca contando ticks.
 */
export function useAhora(intervaloMs: number): number {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const actualizar = () => setAhora(Date.now());
    const id = setInterval(actualizar, intervaloMs);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') actualizar();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [intervaloMs]);

  return ahora;
}
