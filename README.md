# ServiceAgent AI

Sistema para que un restaurante Tex-Mex reciba, cobre, prepare y entregue pedidos **sin que un empleado tome la orden**. Un agente de IA (Retell) atiende al cliente por chat (y después por voz), consulta el menú en vivo, cotiza con precios calculados por el backend y crea el pedido. La cocina lo recibe en tiempo real y la caja lo entrega.

Es un proyecto académico de Metodologías Ágiles (Scrum).

## Documentación

- **[CLAUDE.md](./CLAUDE.md)**: punto de entrada. Stack, estructura, reglas de oro, comandos, Git y el índice de todo lo demás. Léelo antes de contribuir.
- **[docs/](./docs/)**: temas transversales:
  - [negocio.md](./docs/negocio.md): reglas de negocio.
  - [agente.md](./docs/agente.md): agente de Retell.
  - [decisiones.md](./docs/decisiones.md): registro de decisiones.
  - [proceso.md](./docs/proceso.md): Scrum, versiones y Definition of Done.
  - [despliegue.md](./docs/despliegue.md): secretos, CI/CD y despliegue.
  - [documentacion.md](./docs/documentacion.md): cómo se documenta.
- Cada área (`apps/*`, `packages/shared`, `supabase`, `agent`) tiene su propio `CLAUDE.md`.

## Requisitos

- **Node.js 24** (mínimo 22.12). Hay un `.nvmrc`: `nvm use`.
- **pnpm 11.1.3**. La versión está fijada en `packageManager`. La forma más fácil de obtenerla es `corepack enable`.
- Git y, para desplegar a mano, una cuenta de Cloudflare.

## Cómo arrancar

```bash
pnpm install                              # instala todo el monorepo
cp .env.example apps/api/.dev.vars        # y deja solo las variables de la API
pnpm dev                                  # levanta api + web + simuladores
```

| App         | URL local                                                  |
| ----------- | ---------------------------------------------------------- |
| API         | http://localhost:8787 (salud: `/health`, Swagger: `/docs`) |
| Web         | http://localhost:5173                                      |
| Simuladores | http://localhost:5174                                      |

- Todos los comandos (`lint`, `typecheck`, `test`, `build`…): [CLAUDE.md → Comandos](./CLAUDE.md#comandos).
- Variables de entorno: plantilla en [`.env.example`](./.env.example); cómo manejar secretos en [docs/despliegue.md](./docs/despliegue.md).

## Cómo contribuir

Toma una historia (`US-XX`) de Trello, trabaja en su rama y abre un PR con la plantilla. Reglas en [CLAUDE.md → Git](./CLAUDE.md#git).
