import {
  RespuestaCambioEstadoCocinaSchema,
  RespuestaDeshacerCocinaSchema,
  RespuestaRegresarCocinaSchema,
  type RespuestaPedidosCocina,
  type TicketTerminadoCocina,
} from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cambioRegresado,
  mensajeErrorAccion,
  proximoVencimiento,
  quitarVencidos,
  registrarCambio,
  rutaAccion,
  venceEnDe,
  vistaCocina,
  type AccionCocina,
  type CambioLocal,
  type CambiosLocales,
  type ErrorTicket,
  type TicketVista,
  type VistaCocina,
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
  vista(lista: RespuestaPedidosCocina): VistaCocina;
  /** Hora (ms) para la cuenta regresiva. */
  ahora: number;
  guardando: ReadonlySet<number>;
  errores: ReadonlyMap<number, ErrorTicket>;
  /** Empezar, Terminado o Deshacer (de Empezar) en un ticket de la cuadrícula. */
  tocar(vista: TicketVista, accion: Exclude<AccionCocina, 'regresar'>): Promise<void>;
  /** Regresar un terminado a preparación (US-52, D63), sin confirmación ni Deshacer. */
  regresar(terminado: TicketTerminadoCocina): Promise<void>;
  /** Botón Cerrar del aviso de un error cuyo ticket ya no está. */
  descartarError(folio: number): void;
}

/**
 * Botones de cocina (US-11-P2, D56; US-52-P2, D63): llama a la API y guarda en memoria lo que cambió
 * esta tablet: el Deshacer 10 s de Empezar y, tras Terminado o Regresar, el ticket en su nuevo lugar
 * hasta que llega una lista pedida después. Nada se guarda en el navegador: al recargar, se pierde.
 * `recargar` pide la lista otra vez tras cada acción, aunque no haya señal de Realtime; debe ser
 * estable.
 */
export function useAccionesCocina(
  pedirConSesion: typeof pedirApi,
  recargar: () => void,
): AccionesCocina {
  const [cambios, setCambios] = useState<CambiosLocales>(() => new Map());
  const [ultimaLista, setUltimaLista] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const [guardando, setGuardando] = useState<ReadonlySet<number>>(() => new Set());
  const [errores, setErrores] = useState<ReadonlyMap<number, ErrorTicket>>(() => new Map());

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

  /**
   * Corre una acción de un folio: frena el doble toque, muestra "Guardando…", guarda el error con
   * el folio y al final pide la lista. `alFallar` corre después de guardar el error.
   */
  const conFolio = useCallback(
    async (
      folio: number,
      folioTexto: string,
      accion: AccionCocina,
      hacer: () => Promise<void>,
      alFallar?: () => void,
    ) => {
      if (enVuelo.current.has(folio)) return;
      enVuelo.current.add(folio);
      setGuardando((previos) => new Set(previos).add(folio));
      setErrores((previos) => sinFolio(previos, folio));
      try {
        await hacer();
      } catch (causa) {
        const texto = mensajeErrorAccion(causa, accion);
        setErrores((previos) => new Map(previos).set(folio, { folioTexto, texto }));
        alFallar?.();
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
    [recargar],
  );

  const tocar = useCallback(
    async (vista: TicketVista, accion: Exclude<AccionCocina, 'regresar'>) => {
      const { ticket } = vista;
      const { folio } = ticket;
      // Deshacer solo existe tras Empezar (D63: Terminado ya no tiene Deshacer).
      if (accion === 'deshacer' && vista.estado !== 'preparando') return;

      if (accion === 'deshacer') {
        await conFolio(
          folio,
          ticket.folioTexto,
          accion,
          async () => {
            setCambios((previos) => {
              const actual = previos.get(folio);
              return actual ? registrarCambio(previos, { ...actual, lista: Infinity }) : previos;
            });
            const respuesta = await pedirConSesion(
              rutaAccion(folio, 'deshacer'),
              RespuestaDeshacerCocinaSchema,
              { metodo: 'POST', cuerpo: { estado: 'preparando' } },
            );
            // Regresó a la cola: se muestra así hasta que llegue una lista pedida después.
            aplicar({
              folio,
              ticket,
              estado: respuesta.estado,
              terminadoEn: null,
              venceEn: Date.now(),
              deshacer: false,
              lista: contadorListas.current,
            });
          },
          // Sin otro intento: el ticket se queda hasta su plazo con el mensaje y luego manda la lista.
          () =>
            setCambios((previos) => {
              const actual = previos.get(folio);
              if (!actual) return previos;
              return registrarCambio(previos, {
                ...actual,
                deshacer: false,
                lista: contadorListas.current,
              });
            }),
        );
        return;
      }

      await conFolio(folio, ticket.folioTexto, accion, async () => {
        const respuesta = await pedirConSesion(
          rutaAccion(folio, accion),
          RespuestaCambioEstadoCocinaSchema,
          { metodo: 'POST' },
        );
        const recibidoEn = Date.now();
        // Terminado: baja de inmediato a los terminados, sin Deshacer (D63). Empezar: Deshacer 10 s.
        const terminado = respuesta.estado === 'listo';
        aplicar({
          folio,
          ticket,
          estado: respuesta.estado,
          terminadoEn: terminado ? respuesta.cambiadoEn : null,
          venceEn: terminado ? recibidoEn : venceEnDe(respuesta, recibidoEn),
          deshacer: !terminado,
          lista: contadorListas.current,
        });
      });
    },
    [pedirConSesion, aplicar, conFolio],
  );

  const regresar = useCallback(
    (terminado: TicketTerminadoCocina) =>
      conFolio(terminado.folio, terminado.folioTexto, 'regresar', async () => {
        await pedirConSesion(
          rutaAccion(terminado.folio, 'regresar'),
          RespuestaRegresarCocinaSchema,
          { metodo: 'POST' },
        );
        // Vuelve a la cuadrícula en preparando hasta que llegue una lista pedida después.
        const cambio = cambioRegresado(terminado, Date.now(), contadorListas.current);
        aplicar(cambio);
      }),
    [pedirConSesion, aplicar, conFolio],
  );

  const descartarError = useCallback(
    (folio: number) => setErrores((previos) => sinFolio(previos, folio)),
    [],
  );

  const vista = useCallback(
    (lista: RespuestaPedidosCocina) => vistaCocina(lista, cambios, ahora, ultimaLista),
    [cambios, ahora, ultimaLista],
  );

  return {
    nuevaLista,
    listaRecibida,
    vista,
    ahora,
    guardando,
    errores,
    tocar,
    regresar,
    descartarError,
  };
}

function sinFolio<T>(errores: ReadonlyMap<number, T>, folio: number) {
  if (!errores.has(folio)) return errores;
  const copia = new Map(errores);
  copia.delete(folio);
  return copia;
}
