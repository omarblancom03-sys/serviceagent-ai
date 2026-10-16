import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ChatRepo } from '../services/chat';

/*
 * Lo que devuelve cada función SQL de supabase/migrations/*_crear_conversaciones_chat.sql.
 * Los errores llevan solo el código de Postgres: nunca parámetros (chat_id) ni detalles.
 */

const FilasAbrirSchema = z.array(
  z.discriminatedUnion('resultado', [
    z.object({ resultado: z.literal('abierta'), conversacion_id: z.uuid() }),
    z.object({ resultado: z.literal('tope_alcanzado'), conversacion_id: z.null() }),
  ]),
);

const FilasRegistrarSchema = z.array(
  z.discriminatedUnion('resultado', [
    z.object({
      resultado: z.literal('registrado'),
      mensajes_usados: z.number().int().nonnegative(),
      chat_id_retell: z.string().min(1),
    }),
    z.object({
      resultado: z.enum(['no_encontrada', 'terminada', 'limite_alcanzado']),
      mensajes_usados: z.number().int().nullable(),
      chat_id_retell: z.null(),
    }),
  ]),
);

const BooleanoSchema = z.boolean();
const ConteoSchema = z.number().int().nonnegative().nullable();

/** Implementación de `ChatRepo` sobre Supabase: cada operación es una función SQL atómica (D14). */
export function crearRepoChat(cliente: SupabaseClient): ChatRepo {
  async function llamar<T>(funcion: string, params: object, esquema: z.ZodType<T>): Promise<T> {
    const { data, error } = await cliente.rpc(funcion, params);
    if (error) throw new Error(`Falló ${funcion} (código ${error.code ?? 'desconocido'})`);
    const leido = esquema.safeParse(data);
    if (!leido.success) throw new Error(`Respuesta inesperada de ${funcion}`);
    return leido.data;
  }

  return {
    async abrir(topeDiario, ahora) {
      const [fila] = await llamar(
        'abrir_conversacion_chat',
        { p_tope_diario: topeDiario, p_ahora: ahora.toISOString() },
        FilasAbrirSchema,
      );
      if (!fila) throw new Error('abrir_conversacion_chat no devolvió ninguna fila');
      return fila.resultado === 'abierta'
        ? { resultado: 'abierta', id: fila.conversacion_id }
        : { resultado: 'tope_alcanzado' };
    },

    asociarChatRetell(id, chatIdRetell) {
      return llamar(
        'asociar_chat_retell',
        { p_conversacion_id: id, p_chat_id: chatIdRetell },
        BooleanoSchema,
      );
    },

    async registrarMensaje(id, limite, ahora) {
      const [fila] = await llamar(
        'registrar_mensaje_chat',
        { p_conversacion_id: id, p_limite_mensajes: limite, p_ahora: ahora.toISOString() },
        FilasRegistrarSchema,
      );
      if (!fila) throw new Error('registrar_mensaje_chat no devolvió ninguna fila');
      return fila.resultado === 'registrado'
        ? {
            resultado: 'registrado',
            mensajesUsados: fila.mensajes_usados,
            chatIdRetell: fila.chat_id_retell,
          }
        : { resultado: fila.resultado };
    },

    devolverMensaje(id) {
      return llamar('devolver_mensaje_chat', { p_conversacion_id: id }, ConteoSchema);
    },

    terminar(id, ahora) {
      return llamar(
        'terminar_conversacion_chat',
        { p_conversacion_id: id, p_ahora: ahora.toISOString() },
        BooleanoSchema,
      );
    },
  };
}
