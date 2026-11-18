import {
  METODOS_POR_MODO,
  type DatosTransferencia,
  type DatoClienteInvalido,
  type MetodoPago,
  type ModoPago,
  type PedirDatosWhatsappArgs,
  type RespuestaPedirDatosWhatsapp,
} from '@serviceagent/shared';
import { normalizarSuave } from '../lib/normalizar';
import { formatearPesos } from '../lib/pesos';
import { normalizarTelefono } from './pedido';

/*
 * Métodos de pago y datos de transferencia (US-23, D76). Los métodos salen del modo de pago del
 * restaurante (D55); la referencia y la CLABE las pone la base al crear el pedido. Aquí no se
 * calcula ningún monto: el de la transferencia es el total que guardó la base.
 */

/** Métodos que el agente puede ofrecer con este modo. */
export function metodosDisponibles(modo: ModoPago): MetodoPago[] {
  return [...METODOS_POR_MODO[modo]];
}

/** Palabras con que el cliente (o el modelo) nombra cada método, ya normalizadas. */
const PALABRAS_METODO: Record<MetodoPago, readonly string[]> = {
  efectivo: ['efectivo', 'en efectivo', 'cash', 'billete', 'billetes'],
  tarjeta: [
    'tarjeta',
    'con tarjeta',
    'tarjeta de credito',
    'tarjeta de debito',
    'credito',
    'debito',
    'terminal',
  ],
  transferencia: ['transferencia', 'por transferencia', 'transferencia bancaria', 'spei'],
};

/** "Con tarjeta de débito" → 'tarjeta'. `null` si no es ninguno o es ambiguo. */
export function leerMetodoPago(texto: string): MetodoPago | null {
  const llave = normalizarSuave(texto);
  const encontrados = (Object.keys(PALABRAS_METODO) as MetodoPago[]).filter((metodo) =>
    PALABRAS_METODO[metodo].some((palabra) => llave === normalizarSuave(palabra)),
  );
  return encontrados.length === 1 ? (encontrados[0] ?? null) : null;
}

export const DETALLE_FALTA_METODO_EN_CAJA =
  'Falta cómo va a pagar: en caja al recoger, en efectivo o con tarjeta.';
export const DETALLE_METODO_EN_CAJA = 'Se paga en caja al recoger: en efectivo o con tarjeta.';
export const DETALLE_SOLO_TRANSFERENCIA = 'Este restaurante solo recibe pagos por transferencia.';

/**
 * Revisa el método contra el modo vigente. Con transferencia es el único método, así que puede
 * faltar; si llega otro, se aclara (el agente no debió ofrecerlo). Con pago al recoger, tiene que
 * ser efectivo o tarjeta.
 */
export function validarMetodoPago(
  texto: string | undefined,
  modo: ModoPago,
): { metodo: MetodoPago | null; invalido: DatoClienteInvalido | null } {
  const disponibles = metodosDisponibles(modo);
  const metodo = texto === undefined ? null : leerMetodoPago(texto);
  if (modo === 'transferencia') {
    return texto === undefined || metodo === 'transferencia'
      ? { metodo: 'transferencia', invalido: null }
      : { metodo: null, invalido: { campo: 'metodoPago', detalle: DETALLE_SOLO_TRANSFERENCIA } };
  }
  if (metodo !== null && disponibles.includes(metodo)) return { metodo, invalido: null };
  const detalle = texto === undefined ? DETALLE_FALTA_METODO_EN_CAJA : DETALLE_METODO_EN_CAJA;
  return { metodo: null, invalido: { campo: 'metodoPago', detalle } };
}

/** "999180157000000005" → "999 180 15700000000 5": banco, plaza, cuenta y verificador. */
export function formatearClabe(clabe: string): string {
  return `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 17)} ${clabe.slice(17)}`;
}

/** Datos que dicta el agente. `null` si el pedido no es por transferencia. */
export function armarDatosTransferencia(
  referencia: string | null,
  clabe: string | null,
  totalCentavos: number,
): DatosTransferencia | null {
  if (referencia === null || clabe === null) return null;
  return {
    clabe,
    clabeTexto: formatearClabe(clabe),
    referencia,
    montoCentavos: totalCentavos,
    montoTexto: formatearPesos(totalCentavos),
  };
}

// ─── Datos por WhatsApp ─────────────────────────────────────────────────────

export type ResultadoPedirDatosRepo = 'pedido' | 'ya_pedido' | 'no_aplica' | 'no_encontrado';

/** Interfaz de datos. La implementa `lib/repoPedidos.ts` (función SQL `pedir_datos_whatsapp`). */
export interface DatosWhatsappRepo {
  /** Marca, con candado, que el cliente pidió los datos por WhatsApp (D14). */
  pedirDatosWhatsapp(folio: number, telefono: string): Promise<ResultadoPedirDatosRepo>;
}

export const DETALLE_FALTA_FOLIO = 'Falta el número de pedido.';
export const DETALLE_FOLIO = 'El número de pedido son solo dígitos, como 1001.';
export const DETALLE_TELEFONO_WHATSAPP =
  'El teléfono debe ser el del pedido: 10 dígitos de México que no empiecen con 0 ni 1.';

/**
 * El cliente pide los datos de la transferencia por WhatsApp. El envío se conecta en US-28: hoy
 * solo queda anotado en el pedido. Los errores del repo se propagan (la ruta responde 500).
 */
export async function pedirDatosWhatsapp(
  repo: DatosWhatsappRepo,
  args: PedirDatosWhatsappArgs,
): Promise<RespuestaPedirDatosWhatsapp> {
  const datosInvalidos: RespuestaPedirDatosWhatsapp['datosInvalidos'] = [];

  const folioTexto = args.folio === undefined ? undefined : String(args.folio);
  const folio =
    folioTexto !== undefined && /^\d{1,9}$/.test(folioTexto) && Number(folioTexto) > 0
      ? Number(folioTexto)
      : null;
  if (folio === null) {
    const detalle = folioTexto === undefined ? DETALLE_FALTA_FOLIO : DETALLE_FOLIO;
    datosInvalidos.push({ campo: 'folio', detalle });
  }

  const telefono = args.telefono === undefined ? null : normalizarTelefono(args.telefono);
  if (telefono === null) {
    datosInvalidos.push({ campo: 'telefono', detalle: DETALLE_TELEFONO_WHATSAPP });
  }

  if (folio === null || telefono === null) return { resultado: 'datos_invalidos', datosInvalidos };
  return { resultado: await repo.pedirDatosWhatsapp(folio, telefono), datosInvalidos: [] };
}
