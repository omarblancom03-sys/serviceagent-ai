import type {
  CrearPedidoArgs,
  DatoClienteInvalido,
  EstadoPedido,
  RenglonCotizacion,
  RespuestaCrearPedido,
} from '@serviceagent/shared';
import { formatearPesos } from '../lib/pesos';
import { obtenerCotizacion } from './cotizacion';
import type { MenuRepo } from './menu';

/*
 * Crear un pedido (US-08-P1). El agente manda el mismo pedido que cotizó más nombre y teléfono;
 * el backend VUELVE a cotizar con precios de la base y solo guarda si no hace falta ninguna
 * aclaración. Nunca recibe ni guarda un monto que venga de afuera.
 */

/** El mismo pedido (huella con nombre) y teléfono dentro de esta ventana devuelve el mismo folio (D34). */
export const MINUTOS_PEDIDO_DUPLICADO = 10;

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 60;
export const DETALLE_NOMBRE = `El nombre debe tener de ${NOMBRE_MIN} a ${NOMBRE_MAX} letras.`;
export const DETALLE_TELEFONO = 'El teléfono debe tener 10 dígitos.';
export const DETALLE_FALTA_NOMBRE = 'Falta el nombre del cliente.';
export const DETALLE_FALTA_TELEFONO = 'Falta el teléfono del cliente.';

/** Lo que se guarda: todo sale de la cotización que hizo el backend. */
export interface NuevoPedido {
  nombreCliente: string;
  telefono: string;
  huella: string;
  totalCentavos: number;
  renglones: RenglonCotizacion[];
}

export interface PedidoGuardado {
  folio: number;
  totalCentavos: number;
  /** 'confirmado' si es nuevo; si ya existía, el estado que tiene ahora. */
  estado: EstadoPedido;
  yaExistia: boolean;
}

/** Interfaz de datos de pedidos. La implementa `lib/repoPedidos.ts` (Supabase) o un repo en memoria. */
export interface PedidosRepo {
  /**
   * Guarda el pedido con estado `confirmado` en una sola transacción, o devuelve el que ya existe
   * si el mismo teléfono mandó la misma huella hace menos de `minutosDuplicado` minutos.
   */
  guardarPedido(
    pedido: NuevoPedido,
    minutosDuplicado: number,
    ahora: Date,
  ): Promise<PedidoGuardado>;
}

/**
 * Teléfono de México a 10 dígitos (D32). Acepta espacios, guiones, puntos y paréntesis, y la lada
 * de país +52 (o el viejo +521 de celulares). `null` si no queda en 10 dígitos.
 * "+52 (614) 123-4567" → "6141234567".
 */
export function normalizarTelefono(texto: string): string | null {
  const sinSeparadores = texto.replace(/[\s\-.()]/g, '');
  const digitos = sinSeparadores.replace(/^\+?521?(?=\d{10}$)/, '');
  return /^\d{10}$/.test(digitos) ? digitos : null;
}

/**
 * Nombre del cliente sin espacios de más. Solo letras (con acentos), espacios, apóstrofo, punto y
 * guion, de 2 a 60 caracteres: "María José", "O'Connor". `null` si no cumple.
 */
export function normalizarNombre(texto: string): string | null {
  const nombre = texto.trim().replace(/\s+/g, ' ');
  if (nombre.length < NOMBRE_MIN || nombre.length > NOMBRE_MAX) return null;
  return /^[\p{L}\p{M}' .-]+$/u.test(nombre) && /\p{L}/u.test(nombre) ? nombre : null;
}

/** Revisa nombre y teléfono; devuelve los datos limpios o lo que hay que volver a pedir. */
export function validarDatosCliente(args: Pick<CrearPedidoArgs, 'nombre' | 'telefono'>): {
  nombre: string | null;
  telefono: string | null;
  invalidos: DatoClienteInvalido[];
} {
  const invalidos: DatoClienteInvalido[] = [];
  const nombre = args.nombre === undefined ? null : normalizarNombre(args.nombre);
  if (nombre === null) {
    const detalle = args.nombre === undefined ? DETALLE_FALTA_NOMBRE : DETALLE_NOMBRE;
    invalidos.push({ campo: 'nombre', detalle });
  }
  const telefono = args.telefono === undefined ? null : normalizarTelefono(args.telefono);
  if (telefono === null) {
    const detalle = args.telefono === undefined ? DETALLE_FALTA_TELEFONO : DETALLE_TELEFONO;
    invalidos.push({ campo: 'telefono', detalle });
  }
  return { nombre, telefono, invalidos };
}

/**
 * Huella del pedido (D34): SHA-256 de lo que se pidió ya resuelto (ids, cantidades, extras,
 * ingredientes quitados y precios), sin importar el orden ni cómo lo dijo el cliente, más el nombre
 * del cliente sin mayúsculas ni acentos. "Dos T-Bone" y "2 t bone" dan la misma huella; si cambia
 * un precio o el nombre ("Juan" y luego "Ana" con el mismo teléfono), ya es otro pedido.
 */
export async function calcularHuella(
  renglones: RenglonCotizacion[],
  nombreCliente: string,
): Promise<string> {
  const cliente = nombreCliente.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const partes = renglones
    .map((r) =>
      JSON.stringify(
        r.tipo === 'platillo'
          ? [
              'platillo',
              r.idVariante,
              r.cantidad,
              r.precioUnitarioCentavos,
              [...r.sinIngredientes].sort(),
              r.extras
                .map((e) => [e.idExtra, e.cantidad, e.precioUnitarioCentavos])
                .sort((a, b) => Number(a[0]) - Number(b[0])),
            ]
          : ['extra', r.idExtra, r.cantidad, r.precioUnitarioCentavos],
      ),
    )
    .sort();
  partes.unshift(JSON.stringify(['cliente', cliente]));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(partes.join('\n')));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cotiza con precios de la base y, si no falta nada, guarda el pedido. Junta en una sola respuesta
 * las aclaraciones del pedido y las de los datos del cliente. Los errores de los repos se propagan
 * (la ruta responde 500).
 */
export async function crearPedido(
  repoMenu: MenuRepo,
  repoPedidos: PedidosRepo,
  args: CrearPedidoArgs,
  ahora: Date = new Date(),
): Promise<RespuestaCrearPedido> {
  const datos = validarDatosCliente(args);
  const cotizacion = await obtenerCotizacion(repoMenu, {
    productos: args.productos,
    extrasSueltos: args.extrasSueltos,
  });

  if (!cotizacion.ok || datos.nombre === null || datos.telefono === null) {
    return {
      ok: false,
      aclaraciones: cotizacion.ok ? [] : cotizacion.aclaraciones,
      datosCliente: datos.invalidos,
    };
  }

  const guardado = await repoPedidos.guardarPedido(
    {
      nombreCliente: datos.nombre,
      telefono: datos.telefono,
      huella: await calcularHuella(cotizacion.renglones, datos.nombre),
      totalCentavos: cotizacion.totalCentavos,
      renglones: cotizacion.renglones,
    },
    MINUTOS_PEDIDO_DUPLICADO,
    ahora,
  );

  // Con la misma huella, los renglones y precios son los mismos que se guardaron.
  return {
    ok: true,
    folio: guardado.folio,
    folioTexto: `#${guardado.folio}`,
    estado: guardado.estado,
    yaExistia: guardado.yaExistia,
    renglones: cotizacion.renglones,
    totalCentavos: guardado.totalCentavos,
    totalTexto: formatearPesos(guardado.totalCentavos),
  };
}
