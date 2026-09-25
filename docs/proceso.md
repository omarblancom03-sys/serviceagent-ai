# Proceso: equipo, Scrum, versiones y Definition of Done

## Equipo

| Persona | Rol Scrum                 |
| ------- | ------------------------- |
| Omar    | Product Owner + Developer |
| Martín  | Scrum Master + Developer  |
| Jorge   | Developer                 |
| Saúl    | Developer                 |

Nadie es "el del backend" o "el del frontend": todos tocan todas las áreas. Las historias de 8 puntos se hacen en pareja.

## Scrum

- **Sprints de 1 semana.** Sprint 1: 28 sep – 2 oct 2026. Sprint 10: 30 nov – 4 dic 2026.
- **Tablero:** Trello. Flujo: Product Backlog → Sprint Backlog → To do → In progress → Review/Testing → Done → Retrospective.
- **Todo trabajo nace de una historia de usuario** (`US-XX`) del tablero. Si algo no tiene historia, se habla con el PO antes de hacerlo.
- **Puntos de historia** (1, 2, 3, 5, 8) = esfuerzo relativo + complejidad + incertidumbre. **No son días.** Una historia de más de 8 puntos se divide.

## Versiones (incrementos)

Cada sprint termina en una versión que **funciona y se puede presentar**. **Sprint N = versión vN.**

| Versión | Qué se puede demostrar                                                 |
| ------- | ---------------------------------------------------------------------- |
| v1      | El menú real vive en el sistema; admin lo ve; login por PIN            |
| v2      | Primer pedido por chat: el cliente escribe y el pedido queda guardado  |
| v3      | La cocina recibe pedidos en tiempo real y los termina con botones      |
| v4      | Agente inteligente y blindado: RAG, FAQs, pasar a empleado, anti-abuso |
| v5      | Caja cobra; existe el Banco Simulado                                   |
| v6      | Transferencias automáticas, WhatsApp simulado, horario de pedidos      |
| v7      | Avisos al cliente y tiempo estimado                                    |
| v8      | Inventario inteligente                                                 |
| v9      | Administración del menú, dashboard, tiempo estimado que aprende        |
| v10     | Voz y demo final                                                       |

Reglas:

1. La versión se cierra en la Sprint Review con un tag de Git (`git tag v3 && git push origin v3`) y una entrada en `CHANGELOG.md`.
2. Solo entran historias que cumplen la Definition of Done. Lo que no se terminó regresa al Product Backlog; **nunca se presenta nada a medias**.
3. `main` siempre debe estar presentable. Si algo no está listo, se oculta; no se deja roto.
4. Correcciones urgentes sobre una versión cerrada: `v3.1`, `v3.2`…
5. Si el semestre termina antes del Sprint 10, se presenta la última versión cerrada.

## Definition of Done

Una historia está terminada solo si:

1. Cumple **todos** sus criterios de aceptación.
2. El código entró a `main` por PR revisado y aprobado por otro developer.
3. CI en verde (lint, tipos, tests).
4. Está desplegada en el ambiente de desarrollo y funciona ahí.
5. Swagger/documentación actualizada si cambió la API.
6. Si toca al agente: prompt versionado en `agent/` y pasan los casos de `agent/tests/`.
7. El Product Owner la aceptó en la Sprint Review.

Antes de abrir el PR, la historia se cierra con `/cerrar-historia` ([documentacion.md](documentacion.md)).

## Glosario

- **Folio:** número corto del pedido que ve el cliente (ej. #1024).
- **Ticket:** tarjeta del pedido en la pantalla de cocina.
- **Agotado:** producto no disponible temporalmente (manual o por inventario).
- **Conciliación:** emparejar una transferencia recibida con su pedido (referencia + monto).
- **Custom function:** herramienta que el agente de Retell llama en nuestra API.
- **US-XX:** historia de usuario del tablero de Trello.
