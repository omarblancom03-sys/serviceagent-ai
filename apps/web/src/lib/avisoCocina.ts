import type { TicketCocina } from '@serviceagent/shared';

/*
 * Aviso sonoro y contador de la pantalla de cocina (US-12, D58). Lógica pura: el audio real vive en
 * `sonidoCocina.ts` y aquí se recibe como `Sonador`, para probarlo con uno falso.
 */

export interface ConteoCocina {
  enCola: number;
  preparando: number;
}

export function contarPedidos(tickets: readonly TicketCocina[]): ConteoCocina {
  return {
    enCola: tickets.filter((t) => t.estado === 'en_cola').length,
    preparando: tickets.filter((t) => t.estado === 'preparando').length,
  };
}

export function textoContador({ enCola, preparando }: ConteoCocina): string {
  return `En cola: ${enCola} · Preparando: ${preparando}`;
}

/**
 * `bloqueado`: el navegador no deja sonar hasta que se toque la página. `sin_audio`: el navegador no
 * tiene Web Audio.
 */
export type EstadoSonido = 'bloqueado' | 'activo' | 'silenciado' | 'sin_audio';

/** Aviso visible para cada estado (`null`: no hace falta avisar nada). */
export const AVISO_SONIDO: Record<EstadoSonido, string | null> = {
  bloqueado: 'Toca la pantalla para activar el sonido',
  activo: null,
  silenciado: 'Sonido silenciado: no sonará cuando llegue un pedido',
  sin_audio: 'Este navegador no puede reproducir el aviso sonoro',
};

/** Texto del botón; con `sin_audio` no hay botón. */
export function textoBotonSonido(estado: EstadoSonido): string {
  return estado === 'silenciado' ? 'Activar sonido' : 'Silenciar aviso';
}

/** El sonido real. `sonar` devuelve `false` si el navegador volvió a bloquear el audio. */
export interface Sonador {
  disponible: boolean;
  activar(): Promise<boolean>;
  sonar(): boolean;
}

/**
 * Si una tanda de pedidos nuevos merece aviso (supuesto por confirmar con el PO). Solo cuentan los
 * que llegan `en_cola`: un pedido que vuelve a la lista por Deshacer de Terminado (D56) llega en
 * `preparando` y no debe sonar.
 */
export function debeSonar(nuevos: readonly TicketCocina[]): boolean {
  return nuevos.some((t) => t.estado === 'en_cola');
}

export interface AvisoSonoro {
  estado(): EstadoSonido;
  /** Primer toque o tecla en la página: desbloquea el audio si aún no se pudo. */
  interaccion(): Promise<void>;
  /** Botón Silenciar / Activar sonido. El silencio no se guarda: al recargar vuelve a sonar. */
  alternarSilencio(): void;
  /** Pedidos que acaban de aparecer en una recarga: suena una sola vez por tanda. */
  pedidosNuevos(nuevos: readonly TicketCocina[]): void;
}

export function crearAvisoSonoro(
  sonador: Sonador,
  alCambiar: (estado: EstadoSonido) => void,
): AvisoSonoro {
  let desbloqueado = false;
  let silenciado = false;
  let activando = false;

  function estado(): EstadoSonido {
    if (!sonador.disponible) return 'sin_audio';
    if (silenciado) return 'silenciado';
    return desbloqueado ? 'activo' : 'bloqueado';
  }

  /** Aplica un cambio y avisa solo si el estado visible cambió. */
  function cambiar(accion: () => void) {
    const antes = estado();
    accion();
    const despues = estado();
    if (despues !== antes) alCambiar(despues);
  }

  return {
    estado,
    async interaccion() {
      if (!sonador.disponible || desbloqueado || activando) return;
      activando = true;
      try {
        const listo = await sonador.activar().catch(() => false);
        cambiar(() => (desbloqueado = listo));
      } finally {
        activando = false;
      }
    },
    alternarSilencio() {
      if (!sonador.disponible) return;
      cambiar(() => (silenciado = !silenciado));
    },
    pedidosNuevos(nuevos) {
      if (estado() !== 'activo' || !debeSonar(nuevos)) return;
      if (!sonador.sonar()) cambiar(() => (desbloqueado = false));
    },
  };
}
