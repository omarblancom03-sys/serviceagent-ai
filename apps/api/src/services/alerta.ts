import {
  MAX_CARACTERES_MOTIVO,
  type DatoClienteInvalido,
  type RespuestaTransferirAEmpleado,
  type TransferirAEmpleadoArgs,
} from '@serviceagent/shared';
import {
  DETALLE_FALTA_TELEFONO,
  DETALLE_NOMBRE,
  DETALLE_TELEFONO,
  normalizarNombre,
  normalizarTelefono,
} from './pedido';

/*
 * Transferir a un empleado (US-18, D59). El agente pide ayuda para el cliente y la API deja una
 * alerta "Cliente requiere atención" para caja y admin: una sola por conversación de Retell.
 * Nunca se guarda la conversación: solo teléfono, nombre, folio y el motivo que resume el agente.
 */

export const DETALLE_MOTIVO_LARGO =
  `El motivo debe tener como máximo ${MAX_CARACTERES_MOTIVO} caracteres: ` +
  'resúmelo y vuelve a llamar a transferir_a_empleado.';

/** Lo que se guarda. El folio todavía no está validado: lo valida la función SQL. */
export interface NuevaAlerta {
  idChat: string;
  telefono: string;
  nombreCliente: string | null;
  folio: number | null;
  motivo: string;
}

export interface AlertaGuardada {
  /** `false` si esa conversación ya tenía su alerta: no se creó otra. */
  creada: boolean;
  /** El folio no existe o no es de ese teléfono: la alerta se guardó con folio vacío. */
  folioNoEncontrado: boolean;
}

/** Interfaz de datos de alertas. La implementa `lib/repoAlertas.ts` (Supabase) o un repo en memoria. */
export interface AlertasRepo {
  /**
   * Guarda la alerta si esa conversación no tiene una; la regla la cumple la base con un `unique`,
   * así que dos llamadas al mismo tiempo nunca crean dos (D14). La hora la pone la base (D42).
   */
  crearAlerta(alerta: NuevaAlerta): Promise<AlertaGuardada>;
}

/**
 * Revisa lo que mandó el agente y, si todo sirve, guarda la alerta. Sin `chat_id` (`idChat` en
 * `null`) responde `sinConversacion` antes que nada: el agente no lo puede corregir, así que no
 * tiene caso pedirle al cliente que repita sus datos. Si no, junta en una respuesta lo que hay que
 * volver a pedir (teléfono, nombre y motivo largo) sin tocar la base. Los errores del repo se
 * propagan (la ruta responde 500).
 */
export async function transferirAEmpleado(
  repo: AlertasRepo,
  args: TransferirAEmpleadoArgs,
  idChat: string | null,
): Promise<RespuestaTransferirAEmpleado> {
  if (idChat === null) {
    return { ok: false, sinConversacion: true, datosCliente: [], aclaracionMotivo: null };
  }

  const datosCliente: DatoClienteInvalido[] = [];
  const telefono = args.telefono === undefined ? null : normalizarTelefono(args.telefono);
  if (telefono === null) {
    const detalle = args.telefono === undefined ? DETALLE_FALTA_TELEFONO : DETALLE_TELEFONO;
    datosCliente.push({ campo: 'telefono', detalle });
  }
  // El nombre es opcional; si viene, cumple la misma regla que en crear_pedido (D32).
  const nombre = args.nombre === undefined ? null : normalizarNombre(args.nombre);
  if (args.nombre !== undefined && nombre === null) {
    datosCliente.push({ campo: 'nombre', detalle: DETALLE_NOMBRE });
  }
  const aclaracionMotivo = args.motivo.length > MAX_CARACTERES_MOTIVO ? DETALLE_MOTIVO_LARGO : null;

  if (telefono === null || datosCliente.length > 0 || aclaracionMotivo !== null) {
    return { ok: false, sinConversacion: false, datosCliente, aclaracionMotivo };
  }

  const guardada = await repo.crearAlerta({
    idChat,
    telefono,
    nombreCliente: nombre,
    folio: args.folio ?? null,
    motivo: args.motivo,
  });
  return { ok: true, yaSeAviso: !guardada.creada, folioNoEncontrado: guardada.folioNoEncontrado };
}
