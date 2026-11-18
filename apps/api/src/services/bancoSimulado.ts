import type {
  AvisoTransferencia,
  TransferenciaBanco,
  TransferenciaBancoPeticion,
} from '@serviceagent/shared';
import { firmarAvisoBanco } from '../lib/firmaBanco';
import { formatearPesos } from '../lib/pesos';

/**
 * El lado del banco en la simulación (US-24, D70): el "servidor del banco" que usa la pantalla
 * `/banco` de `apps/simuladores`. Vive en este Worker para no desplegar otro, pero es otro sistema:
 * no lee ni escribe nada del restaurante y solo le habla por el webhook firmado, como lo haría un
 * banco real (D5). El secreto de la firma nunca llega al navegador.
 *
 * Una transferencia siempre "se hace": el banco no sabe si la referencia existe ni si el monto es
 * el correcto. Eso lo decide el restaurante al conciliar (US-25).
 */

export interface DependenciasTransferencia {
  /** `BANCO_WEBHOOK_SECRET`: el secreto compartido entre el banco y el restaurante. */
  secreto: string;
  ahora: Date;
  generarId: () => string;
  /**
   * Entrega el aviso ya firmado en `POST /webhooks/banco` y dice si el restaurante respondió 2xx.
   * Recibe el cuerpo como TEXTO: es exactamente lo que se firmó.
   */
  enviarAviso: (cuerpo: string, firma: string) => Promise<boolean>;
}

/** Registra la transferencia en el banco y le avisa al restaurante con el webhook firmado. */
export async function transferir(
  peticion: TransferenciaBancoPeticion,
  deps: DependenciasTransferencia,
): Promise<TransferenciaBanco> {
  const aviso: AvisoTransferencia = {
    idTransferencia: deps.generarId(),
    clabeDestino: peticion.clabeDestino,
    montoCentavos: peticion.montoCentavos,
    referencia: peticion.referencia,
    fecha: deps.ahora.toISOString(),
  };
  const cuerpo = JSON.stringify(aviso);
  const firma = await firmarAvisoBanco(cuerpo, deps.secreto, deps.ahora.getTime());

  // Si el aviso no llega, la transferencia ya salió del banco: se informa, no se revierte.
  let avisoEntregado = false;
  try {
    avisoEntregado = await deps.enviarAviso(cuerpo, firma);
  } catch (error) {
    console.error('Banco simulado: no se pudo entregar el aviso al restaurante.', error);
  }

  return { ...aviso, montoTexto: formatearPesos(aviso.montoCentavos), avisoEntregado };
}
