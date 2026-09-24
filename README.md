# ServiceAgent AI

Sistema para que un restaurante Tex-Mex reciba, cobre, prepare y entregue pedidos **sin que un empleado tome la orden**. Un agente de IA (Retell) atiende al cliente por chat (y después por voz), consulta el menú en vivo, cotiza con precios calculados por el backend y crea el pedido. La cocina lo recibe en tiempo real y la caja lo entrega.

Es un proyecto académico de Metodologías Ágiles (Scrum). Toda la arquitectura, las reglas de negocio, las convenciones y la Definition of Done están en **[CLAUDE.md](./CLAUDE.md)**. Léelo antes de contribuir.

## Estructura

| Carpeta              | Qué es                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `apps/api`           | API en Hono sobre Cloudflare Workers. Swagger en `/docs`.                             |
| `apps/web`           | Frontend (React + Vite + Tailwind): `/pedir`, `/cocina`, `/caja`, `/admin`, `/login`. |
| `apps/simuladores`   | Sistemas externos simulados: `/banco` y `/whatsapp`.                                  |
| `packages/shared`    | Esquemas zod, tipos y constantes compartidas entre API y frontends.                   |
| `supabase/`          | Migraciones SQL y datos semilla.                                                      |
| `agent/`             | Prompt, custom functions y casos de prueba del agente de Retell.                      |
| `.github/workflows/` | CI (lint, tipos, tests, build) y despliegue automático a Cloudflare.                  |

## Requisitos

- **Node.js 24** (mínimo 22.12). Hay un `.nvmrc`: `nvm use`.
- **pnpm 11.1.3**. La versión está fijada en `packageManager`. La forma más fácil de obtenerla es `corepack enable`.
- Git y, para desplegar a mano, una cuenta de Cloudflare.

## Correr en local

```bash
pnpm install          # instala todo el monorepo
cp .env.example apps/api/.dev.vars        # y llena solo las variables de la API
pnpm dev              # levanta api + web + simuladores
```

| App         | URL local                                                  |
| ----------- | ---------------------------------------------------------- |
| API         | http://localhost:8787 (salud: `/health`, Swagger: `/docs`) |
| Web         | http://localhost:5173                                      |
| Simuladores | http://localhost:5174                                      |

### Comandos

| Comando          | Qué hace                                                  |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | Levanta api + web + simuladores en paralelo               |
| `pnpm build`     | Compila todas las apps (la API con `wrangler --dry-run`)  |
| `pnpm lint`      | ESLint + verificación de formato con Prettier             |
| `pnpm typecheck` | Verificación de tipos (TypeScript strict) en cada paquete |
| `pnpm test`      | Tests con Vitest en todo el monorepo                      |
| `pnpm format`    | Formatea todo el código con Prettier                      |

Para correr algo en un solo paquete: `pnpm --filter @serviceagent/api test`.

## Variables de entorno y secretos

**Ningún secreto se sube al repo.** `.env`, `.env.*` (excepto `.env.example`) y `.dev.vars` están en `.gitignore`. La plantilla con **todas** las variables está en [`.env.example`](./.env.example).

### API (Cloudflare Worker)

- **Nunca** pongas secretos en `vars` de `apps/api/wrangler.jsonc`: ese archivo se sube al repo y `vars` es solo para valores públicos.
- **Local:** crea `apps/api/.dev.vars` con las variables de la sección API de `.env.example`. `wrangler dev` las carga solo.
  - Según la [documentación de Wrangler](https://developers.cloudflare.com/workers/configuration/secrets/), también puede leer un archivo `.env`, **pero no los dos**: si existe `.dev.vars`, ignora los `.env`. En este proyecto usamos **`.dev.vars`**.
- **Producción:** cada secreto se carga una vez con Wrangler y queda cifrado en Cloudflare:

  ```bash
  cd apps/api
  pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # pide el valor por consola
  ```

  Lista actual: `pnpm exec wrangler secret list`.

### Frontends (web y simuladores)

- Vite solo expone variables con prefijo `VITE_`, y **terminan en el navegador**. Nunca pongas secretos ahí.
- Local: `apps/web/.env.local` y `apps/simuladores/.env.local` (por ejemplo, `VITE_API_URL=http://localhost:8787`).
- En CI: `VITE_API_URL` se define como **variable** (no secreto) del repo en GitHub.

### GitHub Actions

| Nombre                  | Tipo     | Para qué                                              |
| ----------------------- | -------- | ----------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secreto  | Desplegar el Worker y los proyectos de Pages          |
| `CLOUDFLARE_ACCOUNT_ID` | Secreto  | Cuenta de Cloudflare donde se despliega               |
| `VITE_API_URL`          | Variable | URL pública de la API usada al compilar los frontends |

Si los secretos no existen, el workflow de deploy **se salta con un aviso** en lugar de fallar.

## CI/CD

- **`ci.yml`** corre en cada Pull Request a `main`: install (con cache de pnpm), lint, typecheck, test y build. El check se llama `verificar`.
- **`deploy.yml`** corre en cada push a `main`. Primero ejecuta el mismo CI (`verificar`) y **solo si pasa** despliega:
  - la API como Worker `serviceagent-api`,
  - `apps/web` en Cloudflare Pages como `serviceagent-web`,
  - `apps/simuladores` en Cloudflare Pages como `serviceagent-simuladores`.

`web` y `simuladores` son SPA: no tienen `404.html`, así que Pages devuelve `index.html` para cualquier ruta (`/cocina`, `/banco`, …).

## Cómo contribuir

1. Toma una historia (`US-XX`) del tablero de Trello.
2. Crea una rama: `feat/US-07-cotizar-pedido`.
3. Commits con Conventional Commits: `feat(US-07): calcular total con extras en backend`.
4. Abre un PR usando la plantilla. Necesita CI en verde y 1 aprobación de otro developer.

Detalles en [CLAUDE.md](./CLAUDE.md) §9 y §10.
