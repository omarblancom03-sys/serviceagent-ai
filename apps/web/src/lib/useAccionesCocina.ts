import {
  RespuestaCambioEstadoCocinaSchema,
  RespuestaDeshacerCocinaSchema,
  type TicketCocina,
} from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  mensajeErrorAccion,
  proximoVencimiento,
  quitarVencidos,
  registrarCambio,
  rutaAccion,
  ticketsParaMostrar,
  venceEnDe,
  type AccionCocina,
  type CambioLocal,
  type CambiosLocales,
  type TicketVista,
} from './accionesCocina';
import type { pedirApi } from './api';

/** Cada cuánto se actualiza la cuenta regresiva de Deshacer (solo mientras hay cambios locales). */
const INTERVALO_CUENTA_MS = 1_000;

export interface AccionesCocina {
  /** Al pedir la lista a la API: devuelve su número (`contadorListas`). */
  nuevaLista(): number;
  /** La lista con ese número ya llegó y está en pantalla. */
  listaRecibida(numero: number): void;
  /** La lista de la API con los cambios de esta tablet encima. */
  vistas(tickets: readonly TicketCocina[]): TicketVista[];
  /** Hora (ms) para la cuenta regresiva. */
  ahora: number;
  guardando: ReadonlySet<number>;
  errores: ReadonlyMap<number, string>;
  tocar(vista: TicketVista, accion: AccionCocina): Promise<void>;
}

/**
 * Botones de cocina (US-11-P2, D56): llama a la API y guarda en memoria lo que cambió esta tablet
 * para mostrar Deshacer 10 s. Nada se guarda en el navegador: al recargar, se pierde. `recargar`
 * pide la lista otra vez tras cada acción, aunque no haya señal de Realtime; debe ser estable.
 */
export function useAccionesCocina(
  pedirConSesion: typeof pedirApi,
  recargar: () => void,
): AccionesCocina {
  const [cambios, setCambios] = useState<CambiosLocales>(() => new Map());
  const [ultimaLista, setUltimaLista] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const [guardando, setGuardando] = useState<ReadonlySet<number>>(() => new Set());
  const [errores, setErrores] = useState<ReadonlyMap<number, string>>(() => new Map());

  const contadorListas = useRef(0);
  const ultimaListaRecibida = useRef(0);
  // El estado tarda un render en verse: esto frena el doble toque desde el primer toque.
  const enVuelo = useRef(new Set<number>());

  const nuevaLista = useCallback(() => ++contadorListas.current, []);

  const listaRecibida = useCallback((numero: number) => {
    ultimaListaRecibida.current = Math.max(ultimaListaRecibida.current, numero);
    const ultima = ultimaListaRecibida.current;
    setUltimaLista(ultima);
    setCambios((previos) => quitarVencidos(previos, Date.now(), ultima));
  }, []);

  useEffect(() => {
    // Un solo temporizador: despierta en el siguiente segundo de la cuenta o al vencer un cambio.
    if (cambios.size === 0) return;
    const proximo = proximoVencimiento(cambios, ahora);
    const espera =
      proximo === null ? INTERVALO_CUENTA_MS : Math.min(INTERVALO_CUENTA_MS, proximo - ahora);
    const id = setTimeout(() => {
      const t = Date.now();
      setAhora(t);
      setCambios((previos) => quitarVencidos(previos, t, ultimaListaRecibida.current));
    }, espera);
    return () => clearTimeout(id);
  }, [cambios, ahora]);

  const aplicar = useCallback((cambio: CambioLocal) => {
    setAhora(Date.now());
    setCambios((previos) => registrarCambio(previos, cambio));
  }, []);

  const tocar = useCallback(
    async (vista: TicketVista, accion: AccionCocina) => {
      const { ticket } = vista;
      const { folio } = ticket;
      if (enVuelo.current.has(folio)) return;
      if (accion === 'deshacer' && vista.estado === 'en_cola') return;
      enVuelo.current.add(folio);
      setGuardando((previos) => new Set(previos).add(folio));
      setErrores((previos) => sinFolio(previos, folio));

      try {
        if (vista.estado !== 'en_cola' && accion === 'deshacer') {
          setCambios((previos) => {
            const actual = previos.get(folio);
            return actual ? registrarCambio(previos, { ...actual, lista: Infinity }) : previos;
          });
          const respuesta = await pedirConSesion(
            rutaAccion(folio, 'deshacer'),
            RespuestaDeshacerCocinaSchema,
            { metodo: 'POST', cuerpo: { estado: vista.estado } },
          );
          // Regresó: se muestra en su estado hasta que llegue una lista pedida después.
          aplicar({
            folio,
            ticket,
            estado: respuesta.estado,
            venceEn: Date.now(),
            deshacer: false,
            lista: contadorListas.current,
          });
        } else {
          const respuesta = await pedirConSesion(
            rutaAccion(folio, accion),
            RespuestaCambioEstadoCocinaSchema,
            { metodo: 'POST' },
          );
          aplicar({
            folio,
            ticket,
            estado: respuesta.estado,
            venceEn: venceEnDe(respuesta, Date.now()),
            deshacer: true,
            lista: contadorListas.current,
          });
        }
      } catch (causa) {
        setErrores((previos) => new Map(previos).set(folio, mensajeErrorAccion(causa)));
        if (accion === 'deshacer') {
          // Sin otro intento: el ticket se queda hasta su plazo con el mensaje y luego manda la lista.
          setCambios((previos) => {
            const actual = previos.get(folio);
            if (!actual) return previos;
            return registrarCambio(previos, {
              ...actual,
              deshacer: false,
              lista: contadorListas.current,
            });
          });
        }
      } finally {
        enVuelo.current.delete(folio);
        setGuardando((previos) => {
          const quedan = new Set(previos);
          quedan.delete(folio);
          return quedan;
        });
        recargar();
      }
    },
    [pedirConSesion, recargar, aplicar],
  );

  const vistas = useCallback(
    (tickets: readonly TicketCocina[]) => ticketsParaMostrar(tickets, cambios, ahora, ultimaLista),
    [cambios, ahora, ultimaLista],
  );

  return { nuevaLista, listaRecibida, vistas, ahora, guardando, errores, tocar };
}

function sinFolio(errores: ReadonlyMap<number, string>, folio: number) {
  if (!errores.has(folio)) return errores;
  const copia = new Map(errores);
  copia.delete(folio);
  return copia;
}
