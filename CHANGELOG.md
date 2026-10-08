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
