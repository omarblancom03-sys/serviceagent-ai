# CLAUDE.md — ServiceAgent AI

> Punto de entrada del proyecto para personas e IAs. Claude Code lo carga en cada sesión; el `CLAUDE.md` de cada área se carga al trabajar en esa carpeta y los `docs/` se abren según el [índice](#índice-dónde-está-qué).
> Con otra IA (ChatGPT, Gemini, Copilot…): pega este archivo y los docs del índice que apliquen a la tarea.
> Cualquier cambio a la documentación entra por Pull Request, igual que el código.

## Qué es

**ServiceAgent AI**: sistema para que un restaurante Tex-Mex reciba, cobre, prepare y entregue pedidos **sin que un empleado tome la orden**. Un agente de Retell atiende por chat (voz al final), consulta el menú con RAG, el backend cotiza y crea el pedido, la cocina lo recibe en tiempo real y la caja lo entrega. Flujo completo en [docs/negocio.md](docs/negocio.md).

**Product Goal:** un restaurante Tex-Mex puede recibir, cobrar, preparar y entregar pedidos de principio a fin sin que un empleado tome la orden, con un agente de IA seguro y económico.

Proyecto académico de Metodologías Ágiles (Scrum). El restaurante es real, pero el sistema es una **simulación**: no se presentará al restaurante y algunos datos (insumos, cantidades) son simulados. Fuera de alcance: delivery a domicilio.

## Stack

- **TypeScript** en todo (modo `strict`) · **pnpm** workspaces · **zod** para validar (esquemas compartidos en `packages/shared`).
- **API:** Hono + `@hono/zod-openapi` sobre Cloudflare Workers.
- **Datos:** Supabase (PostgreSQL) · Supabase Realtime (cocina y caja) · RAG con pgvector + embeddings multilingües ([decisiones pendientes](docs/decisiones.md#pendientes-se-resuelven-en-su-historia)).
- **Frontend:** React + Vite + Tailwind + React Router en Cloudflare Pages.
- **Agente:** Retell AI, chat primero y voz al final (Sprint 10). **Anti-abuso:** Cloudflare Turnstile + límites de uso en la API.
- **Calidad:** Vitest · ESLint + Prettier · GitHub Actions (lint, tipos, tests) y despliegue automático a Cloudflare al fusionar a `main`.

No usamos Docker. No agregues dependencias sin justificarlo en el PR.

## Estructura

```
apps/api/            Hono en Workers: src/routes (un archivo por recurso: menu, pedidos, pagos, webhooks, admin…), src/services (lógica, sin HTTP), src/lib, test/
apps/web/            React: /pedir, /cocina, /caja, /admin, /login
apps/simuladores/    Banco y WhatsApp simulados (se ven como "otro sistema")
packages/shared/     Esquemas zod, tipos y constantes compartidas
supabase/            migrations/ (SQL versionado) y seed/ (menú real y datos de demo)
agent/               prompt.md, functions/ (JSON schema) y tests/ del agente de Retell
docs/                Temas transversales (ver índice)
.github/workflows/   CI y deploy
```

Si la estructura cambia, se actualiza aquí y en el índice en el mismo PR.

## Reglas de oro

1. **El dinero lo calcula el backend.** La IA NUNCA calcula ni inventa precios, totales ni descuentos: todo monto sale de precios de la base de datos.
2. **Montos en centavos** (`integer`) en base de datos y API; se formatean a pesos solo al mostrar.
3. **Toda entrada externa** (Retell, webhooks, formularios) se valida con zod.
4. **La lógica de negocio va en `services/`**, no dentro de las rutas.
5. **Secretos solo en variables de entorno.** `.env.example` al día. **Jamás** llaves en el repo ni en commits.
6. Nada de `any` salvo justificación en comentario. Si cambia la API, se actualiza Swagger (`/docs`) en el mismo PR.

**Nombres:** dominio en español y sin acentos ni ñ en identificadores (`pedido`, `producto`, `cotizarPedido`, tabla `pedidos`), igual que el backlog de Trello. Tipos y componentes en `PascalCase` (`Pedido`, `TicketCocina`); variables y funciones en `camelCase`; tablas y columnas SQL en `snake_case`. Textos visibles al usuario en español.

## Comandos

Requisitos y primer arranque: [README.md](README.md). Secretos y despliegue: [docs/despliegue.md](docs/despliegue.md).

```bash
pnpm install          # instalar dependencias de todo el monorepo
pnpm dev              # api (:8787) + web (:5173) + simuladores (:5174) en local
pnpm build            # compilar todo (la API con wrangler --dry-run)
pnpm lint             # ESLint + verificación de formato con Prettier
pnpm typecheck        # verificación de tipos (tsc strict) en cada paquete
pnpm test             # tests (Vitest) de todo el monorepo
pnpm format           # formatear todo con Prettier
pnpm --filter @serviceagent/api test   # un script en un solo paquete
```

## Git

- `main` está protegida: **nadie hace push directo**.
- Una rama por historia o tarea: `feat/US-07-cotizar-pedido`, `fix/US-10-orden-tickets`, `chore/US-01-ci`.
- Conventional Commits con la historia: `feat(US-07): calcular total con extras en backend`.
- PR pequeños (idealmente < 400 líneas) con la plantilla: historia (`US-XX`) y enlace a Trello, criterios de aceptación que cubre y cómo probarlo.
- **Cada PR necesita 1 aprobación de otro developer** (no del autor); las revisiones se rotan entre los 4. CI en verde antes de fusionar.
- Versiones por sprint y Definition of Done: [docs/proceso.md](docs/proceso.md).

## Documentación

Reglas completas en [docs/documentacion.md](docs/documentacion.md):

1. Fuente única: cada dato vive en un archivo; los demás enlazan, no copian.
2. Se describe cómo es el sistema, nunca bitácoras. Lo en progreso vive en Trello; lo terminado, en `CHANGELOG.md`.
3. Límites: este archivo ≤120 líneas, `CLAUDE.md` de área ≤80, `docs/` ≤200.
4. Área nueva → su `CLAUDE.md` con plantilla; tema transversal → archivo en `docs/`. Ambos entran al índice. Decisiones: solo se agregan filas.
5. Toda historia se cierra con `/cerrar-historia US-XX` antes de abrir el PR.

## Instrucciones para la IA

1. Si no te lo dijeron, **pregunta en qué historia (`US-XX`) se trabaja** y pide sus criterios de aceptación.
2. Limítate al alcance de esa historia. Nada de refactors ni cambios en otras áreas sin avisar.
3. Antes de escribir código, propón un plan corto (archivos, enfoque) y espera confirmación en cambios grandes.
4. Respeta las [reglas de negocio](docs/negocio.md), en especial: **el dinero lo calcula el backend**.
5. Escribe tests (Vitest) para lo que implementes. Para cambios del agente, agrega casos en `agent/tests/`.
6. No agregues dependencias sin explicar por qué y qué alternativas consideraste.
7. No inventes APIs de Retell, Supabase, Cloudflare o Hono: consulta la documentación oficial o di que no estás seguro.
8. Nunca escribas secretos en el código ni en commits.
9. Al terminar, resume qué cambió, qué criterios cubre, cómo probarlo y qué quedó pendiente; sugiere mensaje de commit y descripción del PR.
10. Si detectas un bloqueo o una decisión de producto o arquitectura que no te corresponde, detente y repórtalo.
11. Explica en español y de forma clara: el equipo está aprendiendo, la explicación importa tanto como el código.

## Índice: dónde está qué

| Archivo                                                      | Qué contiene                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [docs/negocio.md](docs/negocio.md)                           | Flujo, dinero, estados del pedido, pagos, inventario, tiempo estimado, auth y roles |
| [docs/agente.md](docs/agente.md)                             | Custom functions de Retell, comportamiento y seguridad del agente       |
| [docs/decisiones.md](docs/decisiones.md)                     | Registro de decisiones (D1…) y decisiones pendientes                    |
| [docs/proceso.md](docs/proceso.md)                           | Equipo, Scrum, versiones por sprint, Definition of Done, glosario       |
| [docs/despliegue.md](docs/despliegue.md)                     | Variables de entorno, secretos, CI/CD y despliegue a Cloudflare         |
| [docs/documentacion.md](docs/documentacion.md)               | Cómo se documenta, plantilla de área, `/cerrar-historia`                |
| [apps/api/CLAUDE.md](apps/api/CLAUDE.md)                     | API: rutas, servicios, Swagger, tests                                   |
| [apps/web/CLAUDE.md](apps/web/CLAUDE.md)                     | Frontend de clientes y empleados                                        |
| [apps/simuladores/CLAUDE.md](apps/simuladores/CLAUDE.md)     | Banco y WhatsApp simulados                                              |
| [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md)       | Esquemas zod y tipos compartidos                                        |
| [supabase/CLAUDE.md](supabase/CLAUDE.md)                     | Migraciones y seed de la base de datos                                  |
| [agent/CLAUDE.md](agent/CLAUDE.md)                           | Prompt, custom functions y casos de prueba del agente                   |
