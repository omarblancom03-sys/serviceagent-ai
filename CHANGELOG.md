# Changelog

Todos los cambios relevantes de cada versión (incremento de sprint) se registran aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). **Sprint N = versión vN** (ver [docs/proceso.md](./docs/proceso.md#versiones-incrementos)).

## [Sin publicar]

### Agregado

- US-01: monorepo con pnpm workspaces (`apps/api`, `apps/web`, `apps/simuladores`, `packages/shared`) en TypeScript strict.
- US-01: API en Hono + `@hono/zod-openapi` sobre Cloudflare Workers con `GET /health` y Swagger en `/docs`.
- US-01: páginas placeholder en web (`/pedir`, `/cocina`, `/caja`, `/admin`, `/login`) y simuladores (`/banco`, `/whatsapp`).
- US-01: ESLint (flat config) + Prettier, Vitest, CI en GitHub Actions y despliegue automático a Cloudflare Workers y Pages.
- US-01: documentación modular (`CLAUDE.md` raíz + `CLAUDE.md` por área + `docs/`), permisos compartidos de Claude Code que bloquean leer secretos y skill `/cerrar-historia`.
- US-04 (API): login por PIN con JWT propio (`/auth/empleados`, `/auth/login`, `/auth/sesion`), roles con `requiereRol`, bloqueo de 15 min tras 5 intentos con contador atómico en SQL, tabla `empleados` y seed de desarrollo.
- Ambiente desplegado en Cloudflare (API en Workers, web y simuladores en Pages) con secretos del Worker y `VITE_API_URL`; cada merge a `main` despliega.
- US-04 (web): pantalla `/login` con tarjeta de empleado y teclado de PIN, guardas por rol en `/cocina`, `/caja` y `/admin` (admin entra a todo), sesión en `localStorage` que se cierra al vencer o ante un 401, y botón Cerrar sesión.
- US-02-P1: tabla `platillo_extra` (qué extras aplican a qué platillo), comando `pnpm db:reset:personal` (contra un proyecto personal de Supabase, sin Docker) y diagrama entidad-relación del menú en `supabase/README.md`.
- US-02-P2: menú real completo de El Granero en el seed (16 categorías, 95 platillos, 118 variantes, sinónimos y 5 extras), idempotente con `on conflict`.
- US-02-P2: tiempo estimado de preparación por categoría en el seed (`03_tiempos_preparacion_menu.sql`), restricciones únicas para que el seed del menú sea idempotente, y test estático de los archivos del seed.
- US-03-P1: contrato del menú público con esquemas zod en `packages/shared` (`activo` separado de `disponible`, extras ligados y sueltos) y `GET /menu` y `GET /menu/productos/{id}` documentados en Swagger.
- US-03-P2: `GET /menu` y `GET /menu/productos/{id}` funcionando sobre Supabase (solo lo activo, extras ligados y sueltos según D19, ingredientes removibles, 400/404/500 con mensaje en español), con tests sobre un repo en memoria.
- US-06: agente de chat de El Granero en Retell con prompt versionado en `agent/` (personalidad, alcance limitado a temas del restaurante y despedida), configuración del dashboard en `agent/retell.json`, 11 casos de conversación con su corrida manual y test de formato; `agent/` pasa a ser paquete del workspace.
- US-05: pantalla `/admin` (solo rol `admin`) con el menú de `GET /menu` por categorías: variantes con precio, extras permitidos y sueltos, etiqueta "Agotado", búsqueda por nombre sin acentos ni mayúsculas, filtro por categoría y resumen de totales cargados.
- US-09-P1 (base de datos): tabla `conversaciones_chat` (conversaciones del chat web abiertas por la API, sin contenido de mensajes) con funciones atómicas para abrir con tope diario por día de America/Chihuahua, asociar el chat de Retell, contar y devolver mensajes del cliente con límite por parámetro y terminar.
- US-07-P1: `POST /pedidos/cotizar` (custom function `cotizar_pedido`, protegida con la firma de Retell): resuelve platillos, variantes, extras e ingredientes por nombre o sinónimo y calcula el total en centavos con precios de la base, o devuelve todas las aclaraciones juntas (`no_existe`, `ambiguo`, `falta_variante`, `extra_no_permitido`, `ingrediente_no_removible`, `cantidad_invalida`); seed de ingredientes que se pueden quitar.
- US-09-P1 (API): chat web como proxy a Retell, `POST /chat/conversaciones` y `POST /chat/conversaciones/{id}/mensajes`: la llave de Retell queda en el servidor, solo llega al navegador el texto de los mensajes del agente, se cuentan los mensajes del cliente (el 31 da 429), tope diario de conversaciones nuevas (`CHAT_TOPE_DIARIO`, 3 por defecto) y errores controlados en español si Retell falla (D38, D39); variable nueva `RETELL_AGENT_ID`.
- US-09-P2: ruta pública `/menu` para el cliente, sin login: el menú de `/admin` sin conteos, hora, tiempos de preparación ni errores técnicos, con búsqueda también por nombre de categoría, pensado para celular y con enlace "Menú" en la barra.
- US-09-P2 (chat): pantalla `/pedir` con el chat del asistente sobre la API del chat web: la conversación se crea al primer mensaje y no se guarda en el navegador (D40), saludo y botones rápidos locales, contador de mensajes, enlaces http/https seguros, foco de vuelta a la caja tras cada respuesta y aviso claro para cada error (Reintentar, Iniciar otra, límite de mensajes y tope diario).
- US-08-P1: `POST /pedidos` (custom function `crear_pedido`, con la firma de Retell): vuelve a cotizar con precios de la base, valida nombre y teléfono de México y guarda el pedido con folio creciente desde 1001 y estado `confirmado` en una sola transacción; el mismo pedido con el mismo teléfono y nombre mandado dos veces en 10 minutos devuelve el mismo folio; el teléfono se acepta como número o como texto. Tablas `pedidos`, `historial_estado_pedido`, `renglones_pedido` y `extras_renglon_pedido`.
- US-07-P2-T1: cotizar ignora "para llevar" en producto y variante, encuentra "orden de El Granero" sin perder el artículo del nombre y devuelve `extrasDisponibles` por platillo para que el agente solo ofrezca esos (D44); criterio de aceptación de la corrida en Retell (D43).
- US-09-P2 (agente): el agente responde con el enlace del menú público `/menu` cuando piden el menú, qué hay o precios en general, y si el cliente escribe primero (chat web) responde directo sin saludar ni presentarse (D45); 5 casos nuevos de conversación.
- US-07-P2: el agente cotiza con `cotizar_pedido`: manda lo que dijo el cliente, pregunta una aclaración a la vez sin elegir por él, dice los precios y el total que devuelve el backend, ofrece Espuelas solo si vienen en `extrasDisponibles` (D25, D44) y no registra pedidos; saludo fijo en Retell, 24 casos de pedido, test que compara `functions/cotizar_pedido.json` con el contrato y corrida final con 35 de 40 (3 menores pendientes: 2 por D43 y 1 como excepción del PO, D43).
- US-10 (API y base de datos): `GET /cocina/pedidos` (rol cocina y admin) con los tickets en cola o preparándose, del más antiguo al más nuevo y sin precios ni teléfono; `crear_pedido` deja el pedido en cola al confirmarlo (D46) y la base manda una señal de Realtime sin datos cada vez que un pedido se crea o cambia de estado (D47).

### Corregido

- US-07-P1: los 500 intermitentes de `POST /pedidos/cotizar` y `GET /menu` ("JWT issued at future" de Supabase) se reintentan en el cliente de Supabase, solo ante ese error y hasta ~3 s, para toda la API (D41).
