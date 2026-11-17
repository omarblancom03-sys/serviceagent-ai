import {
  ConflictoCajaSchema,
  ESTADOS_COBRABLES_CAJA,
  type EstadoPedido,
  type MetodoCobroCaja,
  type PedidoCaja,
} from '@serviceagent/shared';
import { ErrorApi } from './api';

/*
 * Lógica pura de los botones de caja (US-21, D66): Cobrar (efectivo o tarjeta) y Entregado. El
 * componente `AccionesCaja.tsx` solo pinta lo que sale de aquí y `useAccionesCaja.ts` llama a la API.
 *
 * Ninguno de los dos se manda con un solo toque: Cobrar pide elegir el método y Entregado pide
 * confirmar, porque la API no tiene Deshacer para ninguno. La pantalla nunca calcula un monto:
 * muestra `porCobrarTexto`, que viene de la API, y lo que se cobra lo decide la base.
 */

/** Lo que el cajero está haciendo con un pedido. Sin entrada en el mapa: los botones normales. */
export type PasoCaja =
  { tipo: 'eligiendo_metodo' } | { tipo: 'confirmando_entrega' } | { tipo: 'guardando' };

export interface EstadoAccionesCaja {
  /** Por folio. Varios pedidos pueden estar a medio cobrar a la vez. */
  pasos: ReadonlyMap<number, PasoCaja>;
  /** Error del último intento de cada pedido; se borra al volver a tocar un botón. */
  errores: ReadonlyMap<number, string>;
}

export function estadoAccionesCajaInicial(): EstadoAccionesCaja {
  return { pasos: new Map(), errores: new Map() };
}

function sin<V>(mapa: ReadonlyMap<number, V>, folio: number): ReadonlyMap<number, V> {
  if (!mapa.has(folio)) return mapa;
  const copia = new Map(mapa);
  copia.delete(folio);
  return copia;
}

/** Caja cobra un pedido que no está pagado y está en la cola, preparándose o listo. */
export function puedeCobrar(pedido: Pick<PedidoCaja, 'estado' | 'pagado'>): boolean {
  return (
    !pedido.pagado && (ESTADOS_COBRABLES_CAJA as readonly EstadoPedido[]).includes(pedido.estado)
  );
}

/** El botón Entregado sale solo en los pedidos listos. */
export function muestraEntregar(pedido: Pick<PedidoCaja, 'estado'>): boolean {
  return pedido.estado === 'listo';
}

/** Un pedido listo se entrega hasta que está pagado: primero se cobra. */
export function puedeEntregar(pedido: Pick<PedidoCaja, 'estado' | 'pagado'>): boolean {
  return muestraEntregar(pedido) && pedido.pagado;
}

export const TEXTO_FALTA_COBRAR = 'Cobra antes de entregar.';

export const NOMBRE_METODO_COBRO: Record<MetodoCobroCaja, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
};

/**
 * El paso que de verdad aplica a como está el pedido AHORA. Si otra caja lo cobró o lo entregó
 * mientras aquí se elegía el método o se confirmaba, el paso ya no vale y se vuelven a pintar los
 * botones normales. "Guardando" siempre vale: lo quita la respuesta de la API.
 */
export function pasoVigente(
  pedido: Pick<PedidoCaja, 'folio' | 'estado' | 'pagado'>,
  estado: EstadoAccionesCaja,
): PasoCaja | null {
  const paso = estado.pasos.get(pedido.folio) ?? null;
  if (paso === null || paso.tipo === 'guardando') return paso;
  if (paso.tipo === 'eligiendo_metodo') return puedeCobrar(pedido) ? paso : null;
  return puedeEntregar(pedido) ? paso : null;
}

/** Toque en Cobrar: pide el método. No hace nada si el pedido se está guardando. */
export function abrirCobro(estado: EstadoAccionesCaja, folio: number): EstadoAccionesCaja {
  if (estado.pasos.get(folio)?.tipo === 'guardando') return estado;
  return {
    pasos: new Map(estado.pasos).set(folio, { tipo: 'eligiendo_metodo' }),
    errores: sin(estado.errores, folio),
  };
}

/** Toque en Entregado: pide confirmar. No hace nada si el pedido se está guardando. */
export function pedirEntrega(estado: EstadoAccionesCaja, folio: number): EstadoAccionesCaja {
  if (estado.pasos.get(folio)?.tipo === 'guardando') return estado;
  return {
    pasos: new Map(estado.pasos).set(folio, { tipo: 'confirmando_entrega' }),
    errores: sin(estado.errores, folio),
  };
}

/** Cancelar: vuelven los botones normales. Lo que ya se está guardando no se cancela. */
export function cancelarPaso(estado: EstadoAccionesCaja, folio: number): EstadoAccionesCaja {
  if (estado.pasos.get(folio)?.tipo === 'guardando') return estado;
  return { ...estado, pasos: sin(estado.pasos, folio) };
}

/** Se mandó a la API: el pedido queda "Guardando…" y sin error. */
export function empezarGuardado(estado: EstadoAccionesCaja, folio: number): EstadoAccionesCaja {
  return {
    pasos: new Map(estado.pasos).set(folio, { tipo: 'guardando' }),
    errores: sin(estado.errores, folio),
  };
}

/** Llegó la respuesta: vuelven los botones normales, con el error si lo hubo. */
export function terminarGuardado(
  estado: EstadoAccionesCaja,
  folio: number,
  error: string | null,
): EstadoAccionesCaja {
  return {
    pasos: sin(estado.pasos, folio),
    errores:
      error === null ? sin(estado.errores, folio) : new Map(estado.errores).set(folio, error),
  };
}

/**
 * Mensaje de un botón que falló, sin códigos técnicos. En un 409 se muestra el texto de la API
 * ("El pedido #1001 ya está pagado."), que ya viene en español y con el folio. Un 401 ya cierra la
 * sesión antes de llegar aquí.
 */
export function mensajeErrorAccionCaja(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 409) {
      const conflicto = ConflictoCajaSchema.safeParse(error.cuerpo);
      return conflicto.success
        ? conflicto.data.error
        : 'El pedido cambió mientras tanto. Revisa cómo quedó.';
    }
    if (error.status === 404) return 'No encontramos ese pedido. Actualiza la lista.';
    if (error.status === 403) return 'Tu usuario no puede cobrar ni entregar pedidos.';
  }
  return 'No se pudo guardar. Revisa la conexión e intenta de nuevo.';
}

/** Si la lista nueva no llega (sin red, pantalla cerrada), el botón no se queda en "Guardando…". */
export const PLAZO_ESPERA_LISTA_MS = 10_000;

/**
 * Espera a una lista pedida DESPUÉS de un cambio. La página avisa cuándo empieza y cuándo termina
 * cada petición de la lista; `siguiente()` se resuelve cuando termina (bien o mal) una que empezó
 * después de llamarla, o al pasar `plazoMs`. Una lista que ya venía en camino no cuenta: se pidió
 * antes del cambio y todavía trae el pedido como estaba.
 */
export function crearEsperaDeLista(plazoMs = PLAZO_ESPERA_LISTA_MS) {
  let empezadas = 0;
  let pendientes: { desde: number; resolver: () => void }[] = [];
  return {
    /** Al pedir la lista: devuelve su número. */
    alEmpezar(): number {
      empezadas += 1;
      return empezadas;
    },
    /** La petición con ese número terminó. */
    alTerminar(numero: number): void {
      const listas = pendientes.filter((p) => p.desde <= numero);
      pendientes = pendientes.filter((p) => p.desde > numero);
      for (const { resolver } of listas) resolver();
    },
    siguiente(): Promise<void> {
      const desde = empezadas + 1;
      return new Promise((resolve) => {
        const plazo = setTimeout(resolve, plazoMs);
        pendientes.push({
          desde,
          resolver: () => {
            clearTimeout(plazo);
            resolve();
          },
        });
      });
    },
  };
}

/**
 * Candado para mandar una sola petición por pedido aunque el botón se toque dos veces antes de que
 * React actualice la pantalla. Se suelta al llegar la respuesta.
 */
export function crearCandadoCaja() {
  const tomados = new Set<number>();
  return {
    tomar(folio: number): boolean {
      if (tomados.has(folio)) return false;
      tomados.add(folio);
      return true;
    },
    soltar(folio: number): void {
      tomados.delete(folio);
    },
  };
}
