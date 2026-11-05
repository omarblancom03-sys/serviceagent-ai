import { MAX_ALERTAS_PENDIENTES, type AlertaAtencion } from '@serviceagent/shared';
import { ErrorApi } from './api';
import { minutosDesde, textoTiempo } from './tiempoCocina';

/*
 * Lógica pura de las alertas "Cliente requiere atención" en /caja (US-18, D59). El componente
 * `AlertasCaja.tsx` solo pinta lo que sale de aquí.
 *
 * Botón Atendida con Deshacer (D60): al tocarlo, la alerta se oculta y durante
 * `PLAZO_DESHACER_MS` se ofrece Deshacer. Solo al terminar el plazo se manda
 * POST /caja/alertas/{id}/atender. Todo vive en memoria: si se cierra la pestaña o se cambia de
 * pantalla antes, no se manda nada y la alerta sigue pendiente (falla hacia lo seguro).
 */

/** Cuánto dura el Deshacer antes de mandar "atendida" a la API. */
export const PLAZO_DESHACER_MS = 5_000;

/** Cuánto se ve un aviso informativo ("ya estaba atendida") antes de borrarse solo. */
export const DURACION_AVISO_MS = 6_000;

// ─── Textos de la tarjeta ───────────────────────────────────────────────────

/**
 * "Esperando 12 min" con el reloj de la caja. Sin rojo ni "Atrasado": "no atendida" quedó fuera de
 * US-18 (D60), así que no hay umbral.
 */
export function textoEspera(creadaEn: string, ahora: number): string {
  const minutos = minutosDesde(creadaEn, ahora);
  return minutos < 1 ? 'Esperando menos de 1 min' : `Esperando ${textoTiempo(minutos)}`;
}

/** Nombre y folio, o "Sin nombre" / "Sin folio" si el agente no los tuvo. */
export function datosClienteAlerta(alerta: AlertaAtencion): { nombre: string; folio: string } {
  const nombre = alerta.nombre?.trim();
  return {
    nombre: nombre ? nombre : 'Sin nombre',
    folio: alerta.folioTexto ? `Folio ${alerta.folioTexto}` : 'Sin folio',
  };
}

/** `6145550101` → `614 555 0101`. Si no son 10 dígitos, tal cual. */
export function textoTelefono(telefono: string): string {
  const partes = /^(\d{3})(\d{3})(\d{4})$/.exec(telefono);
  return partes ? `${partes[1]} ${partes[2]} ${partes[3]}` : telefono;
}

/** Enlace para llamar desde la caja o un celular: `tel:6145550101`. */
export function enlaceTelefono(telefono: string): string {
  return `tel:${telefono.replace(/\D/g, '')}`;
}

/** ¿La API cortó la lista? Devuelve como máximo `MAX_ALERTAS_PENDIENTES`. */
export function hayMasAlertas(recibidas: number): boolean {
  return recibidas >= MAX_ALERTAS_PENDIENTES;
}

/** "(2)" o, si la API cortó la lista, "(100+)". `visibles` ya descuenta las que están en plazo. */
export function textoConteoAlertas(visibles: number, recibidas: number): string {
  return hayMasAlertas(recibidas) ? `(${visibles}+)` : `(${visibles})`;
}

/**
 * Error al pedir la lista. En la primera carga nunca se dice "ningún cliente": no se pudo revisar.
 * En una recarga se conserva la lista que ya había y solo se avisa.
 */
export function mensajeErrorAlertas(error: unknown, primeraCarga: boolean): string {
  if (error instanceof ErrorApi && error.status === 403)
    return 'Tu usuario no tiene acceso a caja.';
  return primeraCarga
    ? 'No se pudieron cargar las alertas. Se vuelve a intentar sola cada 30 segundos.'
    : 'No se pudo actualizar; se vuelve a intentar sola cada 30 segundos.';
}

// ─── Qué hacer con la respuesta de "atender" ────────────────────────────────

export type ResultadoAtender =
  { tipo: 'quitar'; aviso: string | null } | { tipo: 'regresar'; error: string };

/**
 * `null` es éxito. 409 y 404 también quitan la alerta (ya no está pendiente), con un aviso
 * informativo. El 409 dice "ya estaba atendida" y no "otro cajero se adelantó": si se cayó la red
 * justo después de guardar, quien la atendió fue esta misma caja. Lo demás (403, red, 500, 400,
 * respuesta rara) la regresa con el error en la tarjeta. Nunca se usa el texto de la API.
 */
export function resultadoAtender(error: unknown): ResultadoAtender {
  if (error === null) return { tipo: 'quitar', aviso: null };
  if (error instanceof ErrorApi) {
    if (error.status === 409) return { tipo: 'quitar', aviso: 'Esta alerta ya estaba atendida.' };
    if (error.status === 404) return { tipo: 'quitar', aviso: 'Esa alerta ya no existe.' };
    if (error.status === 403)
      return { tipo: 'regresar', error: 'Tu usuario no tiene acceso a caja.' };
  }
  return { tipo: 'regresar', error: 'No se pudo marcar la alerta. Intenta de nuevo.' };
}

// ─── Estado del botón Atendida ──────────────────────────────────────────────

export interface AlertaEnPlazo {
  alerta: AlertaAtencion;
  /** Hora (ms, reloj de la caja) en que termina el Deshacer y se manda a la API. */
  venceEn: number;
}

export interface AvisoAlerta {
  texto: string;
  venceEn: number;
}

/** Todo por id de alerta. Varias alertas pueden estar en su plazo a la vez. */
export interface EstadoAtender {
  /** Ocultas, con su aviso y Deshacer. Aún no se manda nada. */
  enPlazo: ReadonlyMap<number, AlertaEnPlazo>;
  /** Ya se mandaron a la API; se esperan la respuesta (aviso "Guardando…"). */
  enviando: ReadonlyMap<number, AlertaAtencion>;
  /**
   * Ya no están pendientes (200, 409 o 404). Se recuerdan para que una lista pedida antes de la
   * respuesta no las reviva. Son pocas por turno, así que no se limpian.
   */
  quitadas: ReadonlySet<number>;
  /** Error de la tarjeta tras regresar. */
  errores: ReadonlyMap<number, string>;
  /** Avisos informativos (409, 404), que se borran solos. */
  avisos: ReadonlyMap<number, AvisoAlerta>;
}

export function estadoAtenderInicial(): EstadoAtender {
  return {
    enPlazo: new Map(),
    enviando: new Map(),
    quitadas: new Set(),
    errores: new Map(),
    avisos: new Map(),
  };
}

function sin<K, V>(mapa: ReadonlyMap<K, V>, llave: K): ReadonlyMap<K, V> {
  if (!mapa.has(llave)) return mapa;
  const copia = new Map(mapa);
  copia.delete(llave);
  return copia;
}

/**
 * Clic en Atendida: la oculta y empieza su plazo. Si ya está en plazo, mandándose o quitada, no
 * hace nada (un doble clic no reinicia el plazo).
 */
export function marcarAtendida(
  estado: EstadoAtender,
  alerta: AlertaAtencion,
  ahora: number,
): EstadoAtender {
  const id = alerta.idAlerta;
  if (estado.enPlazo.has(id) || estado.enviando.has(id) || estado.quitadas.has(id)) return estado;
  return {
    ...estado,
    enPlazo: new Map(estado.enPlazo).set(id, { alerta, venceEn: ahora + PLAZO_DESHACER_MS }),
    errores: sin(estado.errores, id),
    avisos: sin(estado.avisos, id),
  };
}

/** Deshacer: la alerta vuelve y no se manda nada. Solo mientras sigue en su plazo. */
export function deshacerAtendida(estado: EstadoAtender, idAlerta: number): EstadoAtender {
  if (!estado.enPlazo.has(idAlerta)) return estado;
  return { ...estado, enPlazo: sin(estado.enPlazo, idAlerta) };
}

/** Las que ya terminaron su plazo y hay que mandar a la API. */
export function vencidas(estado: EstadoAtender, ahora: number): number[] {
  return [...estado.enPlazo].filter(([, { venceEn }]) => venceEn <= ahora).map(([id]) => id);
}

/**
 * Pasa esas alertas de "en plazo" a "enviando" (el Deshacer ya no aplica). `movidas` son las que
 * de verdad seguían en su plazo y se movieron: solo esas se mandan a la API. Una que se deshizo
 * después de calcular `ids` no aparece en `movidas`.
 */
export function empezarEnvio(
  estado: EstadoAtender,
  ids: readonly number[],
): { estado: EstadoAtender; movidas: number[] } {
  const movidas = ids.filter((id) => estado.enPlazo.has(id));
  if (movidas.length === 0) return { estado, movidas };
  const enPlazo = new Map(estado.enPlazo);
  const enviando = new Map(estado.enviando);
  for (const id of movidas) {
    const enSuPlazo = enPlazo.get(id);
    if (enSuPlazo) enviando.set(id, enSuPlazo.alerta);
    enPlazo.delete(id);
  }
  return { estado: { ...estado, enPlazo, enviando }, movidas };
}

/** Llegó la respuesta: la alerta se quita (con aviso si toca) o regresa con su error. */
export function terminarEnvio(
  estado: EstadoAtender,
  idAlerta: number,
  resultado: ResultadoAtender,
  ahora: number,
): EstadoAtender {
  const enviando = sin(estado.enviando, idAlerta);
  if (resultado.tipo === 'regresar') {
    return { ...estado, enviando, errores: new Map(estado.errores).set(idAlerta, resultado.error) };
  }
  return {
    ...estado,
    enviando,
    quitadas: new Set(estado.quitadas).add(idAlerta),
    avisos:
      resultado.aviso === null
        ? estado.avisos
        : new Map(estado.avisos).set(idAlerta, {
            texto: resultado.aviso,
            venceEn: ahora + DURACION_AVISO_MS,
          }),
  };
}

/** Borra los avisos informativos que ya cumplieron su tiempo. Si no hay, devuelve el mismo estado. */
export function quitarAvisosVencidos(estado: EstadoAtender, ahora: number): EstadoAtender {
  const quedan = [...estado.avisos].filter(([, aviso]) => aviso.venceEn > ahora);
  if (quedan.length === estado.avisos.size) return estado;
  return { ...estado, avisos: new Map(quedan) };
}

/** Cuándo hay que volver a revisar: el plazo o aviso que termina primero; `null` si no hay. */
export function proximoVencimiento(estado: EstadoAtender): number | null {
  const horas = [
    ...[...estado.enPlazo.values()].map((p) => p.venceEn),
    ...[...estado.avisos.values()].map((a) => a.venceEn),
  ];
  return horas.length === 0 ? null : Math.min(...horas);
}

/**
 * Lo que se pinta de la lista de la API: sin las que están en plazo, mandándose o ya quitadas.
 * Así una recarga no revive una alerta en plazo ni una ya atendida.
 */
export function alertasVisibles(
  alertas: readonly AlertaAtencion[],
  estado: EstadoAtender,
): AlertaAtencion[] {
  return alertas.filter(
    (a) =>
      !estado.enPlazo.has(a.idAlerta) &&
      !estado.enviando.has(a.idAlerta) &&
      !estado.quitadas.has(a.idAlerta),
  );
}

/**
 * Candado para mandar cada alerta una sola vez aunque el temporizador se dispare dos veces antes
 * de que React actualice la pantalla. Se suelta al llegar la respuesta.
 */
export function crearCandadoAtender() {
  const tomados = new Set<number>();
  return {
    tomar(idAlerta: number): boolean {
      if (tomados.has(idAlerta)) return false;
      tomados.add(idAlerta);
      return true;
    },
    soltar(idAlerta: number): void {
      tomados.delete(idAlerta);
    },
  };
}
