import {
  ClabeSchema,
  ErrorBancoSchema,
  MAX_REFERENCIA_TRANSFERENCIA,
  MONTO_MAXIMO_TRANSFERENCIA_CENTAVOS,
  ReferenciaTransferenciaSchema,
  TransferenciaBancoSchema,
  type TransferenciaBanco,
  type TransferenciaBancoPeticion,
} from '@serviceagent/shared';
import { ErrorApi } from './api';

/*
 * Lógica pura de la pantalla `/banco` (US-24, D70): leer lo que escribió el cliente, los errores
 * que se simulan a propósito y el historial de este navegador. La página solo pinta lo que sale de
 * aquí. El banco no calcula precios: el monto lo escribe el cliente, como en un banco real.
 */

// Formulario

/**
 * Lee un monto escrito en pesos y lo devuelve en centavos, sin pasar por decimales de punto
 * flotante: "188" → 18800, "$1,234.5" → 123450. `null` si no es un monto con máximo 2 decimales.
 */
export function pesosACentavos(texto: string): number | null {
  const limpio = texto.replace(/[\s$,]/g, '');
  const partes = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!partes) return null;
  return Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0'));
}

export interface CamposBanco {
  clabe: string;
  monto: string;
  referencia: string;
}

export type ErroresBanco = Partial<Record<keyof CamposBanco, string>>;

export type FormularioBanco =
  { ok: true; peticion: TransferenciaBancoPeticion } | { ok: false; errores: ErroresBanco };

/** Revisa los tres campos con las mismas reglas del contrato y dice qué corregir en cada uno. */
export function leerFormulario(campos: CamposBanco): FormularioBanco {
  const errores: ErroresBanco = {};

  const clabeDestino = campos.clabe.replace(/\s/g, '');
  if (!ClabeSchema.safeParse(clabeDestino).success) {
    errores.clabe = 'La CLABE son 18 dígitos.';
  }

  const montoCentavos = pesosACentavos(campos.monto);
  if (montoCentavos === null) {
    errores.monto = 'Escribe el monto en pesos, por ejemplo 188.00.';
  } else if (montoCentavos < 1) {
    errores.monto = 'El monto debe ser mayor a cero.';
  } else if (montoCentavos > MONTO_MAXIMO_TRANSFERENCIA_CENTAVOS) {
    errores.monto = 'El monto máximo por transferencia es $100,000.00.';
  }

  const referencia = campos.referencia.trim();
  if (!ReferenciaTransferenciaSchema.safeParse(referencia).success) {
    errores.referencia = `Solo letras, números y guiones (máximo ${MAX_REFERENCIA_TRANSFERENCIA}).`;
  }

  if (montoCentavos === null || Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, peticion: { clabeDestino, montoCentavos, referencia } };
}

// Errores a propósito (para probar los casos borde de pago, US-26)

export const ERRORES_SIMULADOS = ['monto_distinto', 'referencia_equivocada'] as const;
export type ErrorSimulado = (typeof ERRORES_SIMULADOS)[number];

export const TEXTO_ERROR_SIMULADO: Record<ErrorSimulado, string> = {
  monto_distinto: 'Monto distinto',
  referencia_equivocada: 'Referencia equivocada',
};

/**
 * Cambia a propósito lo que se manda, como si el cliente se hubiera equivocado al capturar:
 * - `monto_distinto`: un peso menos (o un peso más si el monto es de un peso o menos).
 * - `referencia_equivocada`: cambia el último carácter, así que la referencia deja de existir.
 * Lo demás se manda igual. El resultado sigue cumpliendo el contrato.
 */
export function aplicarErrorSimulado(
  peticion: TransferenciaBancoPeticion,
  error: ErrorSimulado | null,
): TransferenciaBancoPeticion {
  if (error === 'monto_distinto') {
    const { montoCentavos } = peticion;
    return {
      ...peticion,
      montoCentavos: montoCentavos > 100 ? montoCentavos - 100 : montoCentavos + 100,
    };
  }
  if (error === 'referencia_equivocada') {
    const { referencia } = peticion;
    const ultimo = referencia.endsWith('X') ? 'Y' : 'X';
    return { ...peticion, referencia: referencia.slice(0, -1) + ultimo };
  }
  return peticion;
}

// Historial (solo en este navegador: es la "app del banco" del cliente)

export interface TransferenciaEnviada {
  transferencia: TransferenciaBanco;
  /** El error que se simuló al mandarla, o `null` si se mandó tal cual. */
  errorSimulado: ErrorSimulado | null;
}

export const LLAVE_HISTORIAL = 'banco-simulado:transferencias';
export const MAX_HISTORIAL = 50;

/** Lo que se usa de `localStorage`; los tests pasan uno en memoria. */
export interface Almacen {
  getItem(llave: string): string | null;
  setItem(llave: string, valor: string): void;
}

/**
 * `localStorage` del navegador. Si está bloqueado (hasta leer la propiedad puede lanzar un error),
 * devuelve un almacén que no guarda nada: la página funciona, sin historial entre visitas.
 */
export function almacenDelNavegador(): Almacen {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}

const esErrorSimulado = (valor: unknown): valor is ErrorSimulado =>
  ERRORES_SIMULADOS.some((e) => e === valor);

/**
 * Historial guardado, de la más reciente a la más antigua. Lo guardado se valida entrada por
 * entrada: lo que no cumple el contrato (o un JSON dañado) se descarta en lugar de romper la página.
 */
export function leerHistorial(almacen: Almacen): TransferenciaEnviada[] {
  let guardado: unknown;
  try {
    // También puede fallar leer el almacenamiento (por ejemplo, con las cookies bloqueadas).
    guardado = JSON.parse(almacen.getItem(LLAVE_HISTORIAL) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(guardado)) return [];

  return guardado
    .flatMap((entrada: unknown): TransferenciaEnviada[] => {
      if (typeof entrada !== 'object' || entrada === null) return [];
      const { transferencia, errorSimulado } = entrada as Record<string, unknown>;
      const leida = TransferenciaBancoSchema.safeParse(transferencia);
      if (!leida.success) return [];
      return [
        {
          transferencia: leida.data,
          errorSimulado: esErrorSimulado(errorSimulado) ? errorSimulado : null,
        },
      ];
    })
    .slice(0, MAX_HISTORIAL);
}

/**
 * Pone la transferencia al inicio del historial y lo guarda. Si el navegador no deja guardar
 * (modo privado, espacio lleno), el historial sigue en pantalla hasta recargar.
 */
export function agregarAlHistorial(
  almacen: Almacen,
  historial: TransferenciaEnviada[],
  nueva: TransferenciaEnviada,
): TransferenciaEnviada[] {
  const actualizado = [nueva, ...historial].slice(0, MAX_HISTORIAL);
  try {
    almacen.setItem(LLAVE_HISTORIAL, JSON.stringify(actualizado));
  } catch {
    // Sin almacenamiento: no se pierde la transferencia, solo no sobrevive a la recarga.
  }
  return actualizado;
}

// Textos

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Chihuahua',
});

/** Fecha y hora de la transferencia, en la hora del restaurante (America/Chihuahua). */
export function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : formatoFecha.format(fecha);
}

/** CLABE en grupos, como la muestran los bancos: 646 180 15700000000 4. */
export function formatearClabe(clabe: string): string {
  return /^\d{18}$/.test(clabe)
    ? `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 17)} ${clabe.slice(17)}`
    : clabe;
}

export const MENSAJE_SIN_CONEXION =
  'No hay conexión con el banco. Revisa tu internet e intenta de nuevo.';
export const MENSAJE_ERROR_BANCO =
  'No se pudo hacer la transferencia. Intenta de nuevo en un momento.';

/** Texto para el cliente de cualquier falla al transferir, sin códigos HTTP ni detalles técnicos. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) {
    const cuerpo = ErrorBancoSchema.safeParse(error.cuerpo);
    return cuerpo.success && cuerpo.data.error.trim() !== ''
      ? cuerpo.data.error
      : MENSAJE_ERROR_BANCO;
  }
  // `fetch` lanza TypeError cuando no hay red o el navegador bloquea la petición.
  return error instanceof TypeError ? MENSAJE_SIN_CONEXION : MENSAJE_ERROR_BANCO;
}
