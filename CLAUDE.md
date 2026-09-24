# CLAUDE.md — ServiceAgent AI

> Fuente única de verdad del proyecto para personas e IAs.
> Claude Code lee este archivo automáticamente al trabajar en el repo.
> Si usas otra IA (ChatGPT, Gemini, Copilot, etc.), pega este archivo completo como contexto al iniciar la sesión.
> Cualquier cambio a este archivo entra por Pull Request, igual que el código.

---

## 1. Qué estamos construyendo

**ServiceAgent AI** es un sistema completo para que un restaurante Tex-Mex reciba, cobre, prepare y entregue pedidos **sin que un empleado tome la orden**.

**Product Goal:** un restaurante Tex-Mex puede recibir, cobrar, preparar y entregar pedidos de principio a fin sin que un empleado tome la orden, con un agente de IA seguro y económico.

Flujo principal:

```
Cliente (chat web → después voz)
   → Agente en Retell entiende el pedido
   → Consulta el menú con RAG (búsqueda semántica con datos en vivo)
   → Cotiza (el backend calcula el total) y confirma una sola vez
   → Crea el pedido con folio, nombre y teléfono
   → Informa tiempo estimado y método de pago
   → [si es transferencia] Banco simulado → webhook → pedido pagado
   → Pedido aparece en la pantalla de cocina (al confirmar o al pagar, según configuración)
   → Cocina: Empezar → Terminado
   → WhatsApp (simulado) avisa al cliente que puede recoger
   → Caja cobra (si falta) y marca Entregado
```

Es un proyecto académico de la materia de Metodologías Ágiles (Scrum). El restaurante es real, pero el sistema es una **simulación**: no se presentará al restaurante. Algunos datos (insumos, cantidades) son simulados.

Fuera de alcance: delivery a domicilio.

---

## 2. Equipo y forma de trabajo

| Persona | Rol Scrum |
|---|---|
| Omar | Product Owner + Developer |
| Martín | Scrum Master + Developer |
| Jorge | Developer |
| Saúl | Developer |

- **Scrum con sprints de 1 semana.** Sprint 1: 28 sep – 2 oct 2026. Sprint 10: 30 nov – 4 dic 2026.
- **Tablero:** Trello. Flujo: Product Backlog → Sprint Backlog → To do → In progress → Review/Testing → Done → Retrospective.
- **Todo trabajo nace de una historia de usuario** (`US-XX`) del tablero. Si algo no tiene historia, se habla con el PO antes de hacerlo.
- **Puntos de historia** (1, 2, 3, 5, 8) = esfuerzo relativo + complejidad + incertidumbre. **No son días.** Una historia de más de 8 puntos se divide.
- Nadie es "el del backend" o "el del frontend": todos tocan todas las áreas. Las historias de 8 puntos se hacen en pareja.

---

## 3. Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript en todo (modo `strict`) |
| Gestor de paquetes | pnpm con workspaces |
| API | Hono + `@hono/zod-openapi` sobre Cloudflare Workers |
| Validación | zod (esquemas compartidos en `packages/shared`) |
| Base de datos | Supabase (PostgreSQL) |
| Tiempo real | Supabase Realtime (cocina y caja) |
| RAG | pgvector en Supabase + modelo de embeddings multilingüe (ver decisiones pendientes) |
| Frontend | React + Vite + Tailwind + React Router, en Cloudflare Pages |
| Agente | Retell AI: agente de chat primero, voz al final (Sprint 10) |
| Anti-abuso | Cloudflare Turnstile + límites de uso en la API |
| Tests | Vitest |
| Lint/formato | ESLint + Prettier |
| CI/CD | GitHub Actions (lint, tipos, tests) + despliegue automático a Cloudflare al fusionar a `main` |

No usamos Docker. No agregues dependencias nuevas sin justificarlo en el Pull Request.

---

## 4. Estructura del monorepo

```
/
├── CLAUDE.md                 ← este archivo
├── apps/
│   ├── api/                  ← Hono en Cloudflare Workers
│   │   ├── src/routes/       ← un archivo por recurso (menu, pedidos, pagos, webhooks, admin…)
│   │   ├── src/services/     ← lógica de negocio (sin HTTP)
│   │   ├── src/lib/          ← supabase, auth, notificador, firma retell, rate limit
│   │   └── test/
│   ├── web/                  ← React: /pedir, /cocina, /caja, /admin, /login
│   └── simuladores/          ← Banco simulado y WhatsApp simulado (se ven como "otro sistema")
├── packages/
│   └── shared/               ← esquemas zod, tipos y constantes compartidas
├── supabase/
│   ├── migrations/           ← migraciones SQL versionadas
│   └── seed/                 ← carga del menú real y datos de demo
├── agent/
│   ├── prompt.md             ← prompt del agente de Retell (versionado aquí, no solo en el dashboard)
│   ├── functions/            ← definición JSON schema de cada custom function
│   └── tests/                ← casos de prueba: pedidos, ambigüedades, manipulación
└── .github/workflows/        ← CI
```

(La estructura se crea en **US-01**. Si cambia, se actualiza aquí en el mismo PR.)

---

## 5. Reglas de negocio (no negociables)

### 5.1 Dinero
- **El modelo de IA NUNCA calcula ni inventa precios, totales ni descuentos.** Todo monto lo calcula el backend con precios de la base de datos.
- Montos en centavos (`integer`) en base de datos y API. Se formatean a pesos solo al mostrar.

### 5.2 Estados del pedido

```
confirmado → (esperando_pago) → en_cola → preparando → listo → entregado
                                   ↘ cancelado     ↘ expirado
```

| Transición | Quién la hace |
|---|---|
| → confirmado | Agente (crear_pedido), solo tras confirmación explícita del cliente |
| → esperando_pago | Sistema, si el pago es por transferencia |
| → en_cola | Sistema: al confirmar o al pagar, según `modo_envio_cocina` |
| en_cola → preparando | Cocina (botón **Empezar**) |
| preparando → listo | Cocina (botón verde **Terminado**) → dispara aviso por WhatsApp |
| listo → entregado | Caja |
| → cancelado | Cliente vía agente (solo antes de `preparando`) o empleado |
| → expirado | Sistema, si una transferencia no llega a tiempo |

- Cada transición guarda su hora exacta (se usa para el tiempo estimado que aprende).
- `modo_envio_cocina` es configuración del restaurante: `al_confirmar` o `al_pagar`.

### 5.3 Pagos
- Métodos: transferencia (vía agente), efectivo y tarjeta (en caja).
- Transferencia: referencia única por pedido + CLABE ficticia. El Banco Simulado llama a `POST /webhooks/banco` con **firma HMAC**. El backend concilia por referencia + monto.
- Casos borde obligatorios: monto distinto, referencia inexistente, webhook duplicado (idempotencia), pago tardío de pedido expirado.

### 5.4 Inventario
- Cada producto, variante y extra tiene receta (ingredientes y cantidad).
- Se descuenta al confirmar el pedido **dentro de una transacción**; se repone al cancelar o expirar.
- Si un ingrediente no alcanza para una porción, el producto se marca agotado automáticamente y el agente deja de ofrecerlo.
- Cocina puede marcar agotado manualmente; no puede cambiar precios ni recetas.

### 5.5 Tiempo estimado
- v1: tiempo base del platillo más tardado del pedido + carga actual de la cocina.
- v2: el tiempo base se ajusta con el promedio real (Empezar → Terminado) de los últimos pedidos.
- El tiempo prometido se guarda en el pedido y se muestra en el ticket de cocina.

---

## 6. Agente (Retell)

### 6.1 Custom functions
Retell llama a nuestra API. **Toda petición de Retell se verifica con la firma `X-Retell-Signature`**; si no es válida, se rechaza.

| Función | Endpoint | Para qué |
|---|---|---|
| `buscar_menu` | `POST /agente/buscar-menu` | RAG: 3–5 productos relevantes con precio y disponibilidad en vivo |
| `info_restaurante` | `POST /agente/info` | Horario, ubicación, pagos, alérgenos, FAQs |
| `cotizar_pedido` | `POST /pedidos/cotizar` | Valida productos y calcula total (sin guardar) |
| `crear_pedido` | `POST /pedidos` | Crea el pedido tras confirmación explícita |
| `modificar_pedido` | `PATCH /pedidos/:folio` | Cambios antes de preparación |
| `cancelar_pedido` | `POST /pedidos/:folio/cancelar` | Solo antes de `preparando` |
| `estado_pedido` | `POST /agente/estado` | Requiere folio **y** teléfono que coincidan |
| `tiempo_estimado` | `GET /tiempo-estimado` | Antes de confirmar |
| `transferir_a_empleado` | `POST /agente/escalar` | Crea alerta en caja/admin |

(Los nombres exactos de rutas pueden ajustarse en su historia; si cambian, se actualiza esta tabla.)

### 6.2 Comportamiento del agente
- Español mexicano, amable y breve.
- Si falta información, pregunta una sola vez sugiriendo la opción más común ("¿sería la hamburguesa clásica?").
- **Repite el resumen del pedido UNA sola vez, al final, antes de confirmar.** No en cada paso.
- Nunca inventa productos, precios ni ingredientes. Si no sabe, lo dice.
- Si no puede resolver algo, usa `transferir_a_empleado`.
- El menú completo **no** va en el prompt: se consulta con `buscar_menu` (ahorro de tokens).

### 6.3 Seguridad del agente (prioridad del PO)
- Solo atiende temas del restaurante. Rechaza con amabilidad cualquier otra cosa (programar, tareas, otros temas) y regresa al pedido.
- Se mantiene en su rol ante intentos de manipulación ("ignora tus instrucciones", "actúa como…").
- Límites fuera de la IA: Turnstile, conversaciones por IP/teléfono por hora, mensajes por conversación, duración máxima y tope de gasto diario.
- Nunca revela datos de otros clientes.
- Todo cambio al prompt pasa por PR y debe pasar los casos de `agent/tests/` (incluidos los de manipulación).

---

## 7. Autenticación y roles

- Login por **PIN** (simula lector de huella): selección de empleado + teclado numérico.
- Roles: `cocina`, `caja`, `admin`. Admin puede ver todo.
- JWT de duración limitada. PIN guardado con hash. Bloqueo temporal tras 5 intentos fallidos.
- Cada endpoint interno y cada ruta del frontend se protege por rol.

---

## 8. Convenciones de código

- **Idioma del dominio: español** y sin acentos ni ñ en identificadores (`pedido`, `producto`, `cotizarPedido`, tabla `pedidos`). Así coincide con el backlog de Trello.
- Tipos y componentes en `PascalCase` (`Pedido`, `TicketCocina`); variables y funciones en `camelCase`; tablas y columnas SQL en `snake_case`.
- Textos visibles al usuario en español.
- La lógica de negocio va en `services/`, no dentro de las rutas.
- Toda entrada externa (Retell, webhooks, formularios) se valida con zod.
- Nada de `any` salvo justificación en comentario.
- Secretos solo en variables de entorno. Mantener `.env.example` actualizado. **Jamás** subir llaves al repo.
- Si cambia la API, se actualiza Swagger (`/docs`) en el mismo PR.

---

## 9. Git

- `main` está protegida: **nadie hace push directo**.
- Una rama por historia o tarea: `feat/US-07-cotizar-pedido`, `fix/US-10-orden-tickets`, `chore/US-01-ci`.
- Commits estilo Conventional Commits con referencia a la historia:
  `feat(US-07): calcular total con extras en backend`
- Pull Requests pequeños (idealmente < 400 líneas). Descripción con:
  1. Historia (`US-XX`) y enlace a la tarjeta de Trello.
  2. Qué criterios de aceptación cubre.
  3. Cómo probarlo.
- **Cada PR necesita 1 aprobación de otro developer** (no del autor). Las revisiones se rotan entre los 4.
- CI en verde antes de fusionar.

### 9.1 Versiones (Incrementos)

Cada sprint termina en una versión que **funciona y se puede presentar**. **Sprint N = versión vN.**

| Versión | Qué se puede demostrar |
|---|---|
| v1 | El menú real vive en el sistema; admin lo ve; login por PIN |
| v2 | Primer pedido por chat: el cliente escribe y el pedido queda guardado |
| v3 | La cocina recibe pedidos en tiempo real y los termina con botones |
| v4 | Agente inteligente y blindado: RAG, FAQs, pasar a empleado, anti-abuso |
| v5 | Caja cobra; existe el Banco Simulado |
| v6 | Transferencias automáticas, WhatsApp simulado, horario de pedidos |
| v7 | Avisos al cliente y tiempo estimado |
| v8 | Inventario inteligente |
| v9 | Administración del menú, dashboard, tiempo estimado que aprende |
| v10 | Voz y demo final |

Reglas:
1. La versión se cierra en la Sprint Review con un tag de Git (`git tag v3 && git push origin v3`) y una entrada en `CHANGELOG.md`.
2. Solo entran historias que cumplen la Definition of Done. Lo que no se terminó regresa al Product Backlog; **nunca se presenta nada a medias**.
3. `main` siempre debe estar presentable. Si algo no está listo, se oculta; no se deja roto.
4. Correcciones urgentes sobre una versión cerrada: `v3.1`, `v3.2`…
5. Si el semestre termina antes del Sprint 10, se presenta la última versión cerrada.

---

## 10. Definition of Done

Una historia está terminada solo si:

1. Cumple **todos** sus criterios de aceptación.
2. El código entró a `main` por PR revisado y aprobado por otro developer.
3. CI en verde (lint, tipos, tests).
4. Está desplegada en el ambiente de desarrollo y funciona ahí.
5. Swagger/documentación actualizada si cambió la API.
6. Si toca al agente: prompt versionado en `agent/` y pasan los casos de `agent/tests/`.
7. El Product Owner la aceptó en la Sprint Review.

---

## 11. Instrucciones para la IA que ayude en este repo

Cuando trabajes en este proyecto (Claude Code u otra IA):

1. **Pregunta primero en qué historia (`US-XX`) se está trabajando** si no te lo dijeron. Pide los criterios de aceptación de la tarjeta si no los tienes.
2. Limítate al alcance de esa historia. No hagas refactors ni cambios en otras áreas sin avisar.
3. Antes de escribir código, propón un plan corto (archivos a tocar, enfoque) y espera confirmación en cambios grandes.
4. Respeta las reglas de negocio de la sección 5, en especial: **el dinero lo calcula el backend**.
5. Escribe tests para lo que implementes (Vitest). Para cambios del agente, agrega casos en `agent/tests/`.
6. No agregues dependencias sin explicar por qué y qué alternativas consideraste.
7. No inventes APIs de Retell, Supabase, Cloudflare o Hono: si no estás seguro, consulta la documentación oficial o dilo.
8. Nunca escribas secretos en el código ni en commits.
9. Al terminar, resume: qué cambió, qué criterios de aceptación cubre, cómo probarlo y qué quedó pendiente. Sugiere el mensaje de commit y la descripción del PR.
10. Si detectas un bloqueo o una decisión que no te corresponde (de producto o arquitectura), detente y repórtalo en lugar de decidir por tu cuenta.
11. Explica en español y de forma clara: el equipo está aprendiendo, así que la explicación importa tanto como el código.

---

## 12. Registro de decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | TypeScript en todo el proyecto | Cualquiera de los 4 puede tomar cualquier tarea |
| D2 | Supabase en lugar de todo-Cloudflare (D1) | Tiempo real para cocina/caja, transacciones para inventario, pgvector para RAG, sin la complejidad de Durable Objects |
| D3 | RAG propio con pgvector en vez de solo la base de conocimiento de Retell | Precios y disponibilidad cambian; el RAG propio devuelve datos en vivo y reduce tokens |
| D4 | Chat primero, voz al final | Probar y estabilizar la lógica con menor costo antes de pasar a llamadas |
| D5 | WhatsApp y banco simulados, detrás de interfaces | Cero costo y demo confiable; se pueden cambiar por servicios reales sin tocar el resto |
| D6 | Login por PIN con roles | Simula huella; simple de implementar y de demostrar |
| D7 | Montos en centavos (integer) | Evitar errores de redondeo con decimales |

### Decisiones pendientes (se resuelven en su historia)
- **Modelo de embeddings** (US-16): opción multilingüe de Cloudflare Workers AI vs. modelo de embeddings de un proveedor externo. Criterio: calidad en español, costo y latencia.
- **Realtime con auth propia** (US-04 / US-10): cómo aplicar permisos (RLS de Supabase con los claims del JWT propio vs. canales de broadcast emitidos desde la API).
- **Proveedor real de WhatsApp** (US-50, opcional): API de Meta en modo prueba vs. sandbox de Twilio.

---

## 13. Comandos

Requisitos: Node 24 (mínimo 22.12) y pnpm 11.1.3 (fijado en `packageManager`; `corepack enable`).

```bash
pnpm install          # instalar dependencias de todo el monorepo
pnpm dev              # levantar api (:8787) + web (:5173) + simuladores (:5174) en local
pnpm build            # compilar todo (la API con wrangler --dry-run)
pnpm lint             # ESLint + verificación de formato con Prettier
pnpm typecheck        # verificación de tipos (tsc strict) en cada paquete
pnpm test             # tests (Vitest) de todo el monorepo
pnpm format           # formatear todo con Prettier

pnpm --filter @serviceagent/api test          # correr un script en un solo paquete
cd apps/api && pnpm exec wrangler secret put X # cargar un secreto del Worker en producción
```

- Secretos de la API en local: `apps/api/.dev.vars` (plantilla en `.env.example`). Nunca en `vars` de `wrangler.jsonc`.
- `pnpm db:reset` (recrear base desde migraciones + seed) se agrega en la historia que crea el primer esquema de Supabase.

---

## 14. Glosario

- **Folio:** número corto del pedido que ve el cliente (ej. #1024).
- **Ticket:** tarjeta del pedido en la pantalla de cocina.
- **Agotado:** producto no disponible temporalmente (manual o por inventario).
- **Conciliación:** emparejar una transferencia recibida con su pedido (referencia + monto).
- **Custom function:** herramienta que el agente de Retell llama en nuestra API.
- **US-XX:** historia de usuario del tablero de Trello.
