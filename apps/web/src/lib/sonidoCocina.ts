import type { Sonador } from './avisoCocina';

/** Dos tonos cortos (Hz) y cuánto dura cada uno (s). */
const TONOS_HZ = [880, 660];
const DURACION_TONO_S = 0.18;
const VOLUMEN = 0.3;

/** Si el navegador tiene Web Audio. Sin ella, la pantalla avisa que no puede sonar. */
export function hayWebAudio(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

/**
 * Aviso de cocina con la Web Audio API, sin archivos (US-12). El `AudioContext` se crea en la
 * primera `activar()`, que la página llama tras un toque: antes de eso el navegador no deja sonar.
 */
export function crearSonadorWebAudio(): Sonador {
  const Contexto = hayWebAudio() ? window.AudioContext : undefined;
  let contexto: AudioContext | null = null;

  return {
    disponible: Contexto !== undefined,
    async activar() {
      if (!Contexto) return false;
      contexto ??= new Contexto();
      await contexto.resume();
      return contexto.state === 'running';
    },
    sonar() {
      const ctx = contexto;
      if (ctx?.state !== 'running') return false;
      // Si el navegador falla al crear o arrancar los tonos, se trata como audio bloqueado: la
      // pantalla vuelve a pedir que la toquen en lugar de mostrar un error de carga.
      try {
        TONOS_HZ.forEach((hz, i) => {
          const desde = ctx.currentTime + i * DURACION_TONO_S;
          const hasta = desde + DURACION_TONO_S;
          const oscilador = ctx.createOscillator();
          const volumen = ctx.createGain();
          oscilador.frequency.value = hz;
          // Subida y bajada rápidas para que no truene al empezar y al cortar.
          volumen.gain.setValueAtTime(0, desde);
          volumen.gain.linearRampToValueAtTime(VOLUMEN, desde + 0.02);
          volumen.gain.linearRampToValueAtTime(0, hasta);
          oscilador.connect(volumen).connect(ctx.destination);
          oscilador.start(desde);
          oscilador.stop(hasta);
        });
        return true;
      } catch {
        return false;
      }
    },
    cerrar() {
      // `close()` rechaza si ya estaba cerrado; al salir de la pantalla no hay nada que avisar.
      void contexto?.close().catch(() => undefined);
      contexto = null;
    },
  };
}
