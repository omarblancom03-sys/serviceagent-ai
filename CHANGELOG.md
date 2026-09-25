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
