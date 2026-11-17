import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CotizarPedidoPeticionSchema,
  CrearPedidoPeticionSchema,
  ErrorPedidoSchema,
  PedirDatosWhatsappPeticionSchema,
  RespuestaCotizarConPagoSchema,
  RespuestaCrearPedidoSchema,
  RespuestaPedirDatosWhatsappSchema,
} from '@serviceagent/shared';
import type { AppEnv, Bindings } from '../lib/env';
import { requiereFirmaRetell } from '../lib/firmaRetell';
import { mensajesDeLaConversacion } from '../services/confirmacion';
import { obtenerCotizacion } from '../services/cotizacion';
import { metodosDisponibles, pedirDatosWhatsapp } from '../services/pago';
import { crearPedido, type PedidosRepo } from '../services/pedido';
import { errorDeFormato, FIRMA_RETELL, json } from './funcionesRetell';
import type { DependenciasMenu } from './menu';

/** Cotizar y crear leen el mismo menú que `GET /menu`: usan el mismo repo. */
export type DependenciasPedidos = DependenciasMenu & {
  crearRepoPedidos: (env: Bindings) => PedidosRepo;
};

const tags = ['Pedidos'];

const respuestasDeError = (al: string) => ({
  400: { content: json(ErrorPedidoSchema), description: 'Cuerpo mal formado' },
  401: { content: json(ErrorPedidoSchema), description: 'Firma de Retell ausente o inválida' },
  500: {
    content: json(ErrorPedidoSchema),
    description: `Falta \`RETELL_API_KEY\` o falló ${al}`,
  },
});

export const cotizarPedidoRoute = createRoute({
  method: 'post',
  path: '/pedidos/cotizar',
  tags,
  summary: 'Cotiza un pedido (custom function `cotizar_pedido` del agente)',
  description:
    FIRMA_RETELL +
    'No guarda nada. Resuelve los nombres tal como los dijo el cliente y calcula el total con ' +
    'precios de la base, en centavos. Si algo no existe, es ambiguo o no se puede, responde 200 ' +
    'con `ok: false` y todas las aclaraciones juntas; nunca cotiza una parte del pedido. Una ' +
    'llamada sin platillos ni extras (`{}`) no es un error: responde 200 con `ok: false`, ' +
    '`pedidoVacio: true` y sin aclaraciones. Si no viene `variante`, resuelve la que el modelo ' +
    'mandó pegada en `producto` con "con", solo si la coincidencia es única (D67). La cotización ' +
    '`ok` trae `metodosPago`: los métodos que el agente puede ofrecer según el modo de pago del ' +
    'restaurante (efectivo y tarjeta en caja, o solo transferencia; US-23, D76).',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(CotizarPedidoPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaCotizarConPagoSchema),
      description:
        'Cotización con renglones y total, las aclaraciones que hacen falta, o `pedidoVacio`',
    },
    ...respuestasDeError('la lectura del menú o del modo de pago'),
  },
});

export const crearPedidoRoute = createRoute({
  method: 'post',
  path: '/pedidos',
  tags,
  summary: 'Crea el pedido confirmado (custom function `crear_pedido` del agente)',
  description:
    FIRMA_RETELL +
    'Solo crea el pedido si en `chat.message_with_tool_calls` el cliente respondió que sí a la ' +
    'última pregunta de confirmación del agente y no se volvió a cotizar después; si no, responde ' +
    '200 con `ok: false` y `faltaConfirmacion: true` sin tocar la base (D48). ' +
    'Recibe el mismo pedido que se cotizó más nombre, teléfono y `metodoPago`, y lo VUELVE a cotizar con ' +
    'precios de la base: nunca recibe montos. Si no falta nada, guarda el pedido con folio en una ' +
    'sola transacción con el modo de pago vigente (D55), que devuelve como `modoPago`: con pago al ' +
    'recoger va a la cola de cocina (`en_cola`, D46); con transferencia queda en `esperando_pago` y ' +
    'no llega a cocina hasta que se pague. Si algo del pedido o del cliente no sirve, ' +
    'responde 200 con `ok: false` y no guarda nada. El mismo pedido con el mismo teléfono y ' +
    'nombre en los últimos 10 minutos devuelve el folio que ya existe (`yaExistia: true`). ' +
    'Con pago al recoger, `metodoPago` debe ser efectivo o tarjeta; con transferencia es el único ' +
    'método y puede faltar. Un método que falta o no se ofrece se aclara en `datosCliente`. Con ' +
    'transferencia, la respuesta trae `datosTransferencia`: la CLABE ficticia del restaurante, la ' +
    'referencia única del pedido y el monto (el total guardado) (US-23, D76).',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(CrearPedidoPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaCrearPedidoSchema),
      description: 'Pedido guardado (o el que ya existía), o las aclaraciones que hacen falta',
    },
    ...respuestasDeError('la lectura del menú o al guardar'),
  },
});

export const pedirDatosWhatsappRoute = createRoute({
  method: 'post',
  path: '/pedidos/datos-whatsapp',
  tags,
  summary:
    'El cliente pide los datos de pago por WhatsApp (custom function `pedir_datos_whatsapp`)',
  description:
    FIRMA_RETELL +
    'Anota en el pedido que el cliente quiere los datos de la transferencia por WhatsApp. El ' +
    'envío se conecta en US-28: hoy no se manda nada. Se identifica con folio y teléfono. ' +
    'Responde 200 con `resultado`: `pedido`, `ya_pedido` (no se repite), `no_aplica` (no es por ' +
    'transferencia o ya no espera el pago), `no_encontrado` (no dice si falló el folio o el ' +
    'teléfono) o `datos_invalidos` con lo que hay que volver a pedir (US-23, D76).',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(PedirDatosWhatsappPeticionSchema), required: true } },
  responses: {
    200: { content: json(RespuestaPedirDatosWhatsappSchema), description: 'Resultado' },
    ...respuestasDeError('al anotar el pedido'),
  },
});

export function registrarPedidos(app: OpenAPIHono<AppEnv>, deps: DependenciasPedidos) {
  app.openapi(
    cotizarPedidoRoute,
    async (c) => {
      const { args } = c.req.valid('json');
      try {
        const cotizacion = await obtenerCotizacion(deps.crearRepoMenu(c.env), args);
        if (!cotizacion.ok) return c.json(cotizacion, 200);
        // El modo se lee solo si hay cotización: es lo único que el agente necesita para preguntar
        // cómo va a pagar (D76).
        const modo = await deps.crearRepoPedidos(c.env).leerModoPago();
        return c.json({ ...cotizacion, metodosPago: metodosDisponibles(modo) }, 200);
      } catch (error) {
        console.error('POST /pedidos/cotizar', error);
        return c.json(
          { error: 'No se pudo cotizar el pedido. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('cotizar_pedido', resultado.error.issues), 400);
      }
    },
  );

  app.openapi(
    crearPedidoRoute,
    async (c) => {
      // Un agente de chat manda la conversación en `chat`. Voz: pendiente, Sprint 10 (D48).
      const { args, chat } = c.req.valid('json');
      const mensajes = mensajesDeLaConversacion(chat);
      if (mensajes.length === 0) {
        // Sin conversación no se puede revisar la confirmación (D48). Solo las llaves, nunca el contenido.
        const llaves = chat !== null && typeof chat === 'object' ? Object.keys(chat) : [];
        console.warn('POST /pedidos sin mensajes en la conversación', { llaves });
      }
      try {
        const respuesta = await crearPedido(
          deps.crearRepoMenu(c.env),
          deps.crearRepoPedidos(c.env),
          args,
          mensajes,
        );
        return c.json(respuesta, 200);
      } catch (error) {
        console.error('POST /pedidos', error);
        return c.json(
          { error: 'No se pudo registrar el pedido. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('crear_pedido', resultado.error.issues), 400);
      }
    },
  );

  app.openapi(
    pedirDatosWhatsappRoute,
    async (c) => {
      const { args } = c.req.valid('json');
      try {
        return c.json(await pedirDatosWhatsapp(deps.crearRepoPedidos(c.env), args), 200);
      } catch (error) {
        console.error('POST /pedidos/datos-whatsapp', error);
        return c.json(
          { error: 'No se pudo anotar el envío por WhatsApp. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('pedir_datos_whatsapp', resultado.error.issues), 400);
      }
    },
  );
}
