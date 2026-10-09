# Corrida manual de los casos

Resultado de la última vez que se corrieron todos los casos de [casos/](./casos) en el chat de prueba de Retell. Cómo se corren y cuándo se actualiza este archivo: [CLAUDE.md → Cómo probar](../CLAUDE.md#cómo-probar).

- **Fecha:** pendiente
- **Modelo:** pendiente

Ningún caso se ha corrido con el prompt actual, que ya usa `cotizar_pedido`: la corrida necesita `POST /pedidos/cotizar` desplegado. Los resultados de un prompt anterior no valen para este.

| Caso                                  | Resultado | Resumen    |
| ------------------------------------- | --------- | ---------- |
| `saludo-y-tono`                       | pendiente | Sin correr |
| `identidad-asistente-virtual`         | pendiente | Sin correr |
| `ajena-programar`                     | pendiente | Sin correr |
| `ajena-tarea-escolar`                 | pendiente | Sin correr |
| `ajena-cambio-de-rol`                 | pendiente | Sin correr |
| `despedida-clara`                     | pendiente | Sin correr |
| `despedida-y-regreso`                 | pendiente | Sin correr |
| `gracias-con-pregunta`                | pendiente | Sin correr |
| `menu-y-precios-sin-inventar`         | pendiente | Sin correr |
| `pedido-sin-inventar`                 | pendiente | Sin correr |
| `horario-sin-inventar`                | pendiente | Sin correr |
| `pedido-simple-total`                 | pendiente | Sin correr |
| `pedido-corte-ofrece-espuelas`        | pendiente | Sin correr |
| `pedido-cowboy-sin-espuelas`          | pendiente | Sin correr |
| `pedido-falta-variante`               | pendiente | Sin correr |
| `pedido-no-existe`                    | pendiente | Sin correr |
| `pedido-extra-no-permitido`           | pendiente | Sin correr |
| `pedido-ingrediente-no-removible`     | pendiente | Sin correr |
| `pedido-cantidad-invalida`            | pendiente | Sin correr |
| `pedido-extras-sueltos`               | pendiente | Sin correr |
| `pedido-dos-aclaraciones`             | pendiente | Sin correr |
| `pedido-precio-de-un-corte`           | pendiente | Sin correr |
| `pedido-ambiguo-varias-opciones`      | pendiente | Sin correr |
| `pedido-dos-hamburguesas-y-coca`      | pendiente | Sin correr |
| `pedido-ambiguo-una-opcion`           | pendiente | Sin correr |
| `pedido-variante-unica`               | pendiente | Sin correr |
| `pedido-extra-suelto-con-platillo`    | pendiente | Sin correr |
| `pedido-espuelas-sin-corte`           | pendiente | Sin correr |
| `pedido-extra-con-palabras-de-mas`    | pendiente | Sin correr |
| `pedido-variante-con-palabras-de-mas` | pendiente | Sin correr |
| `pedido-variante-que-parece-extra`    | pendiente | Sin correr |
| `pedido-sin-ingrediente`              | pendiente | Sin correr |

**Resultado:** `Pasó`, `Falló` o `pendiente`. **Resumen:** una línea con lo que respondió el agente o por qué falló.

**Observación de la corrida anterior** (6 de octubre de 2026, `gpt-6-luna`, prompt sin herramientas): el saludo de apertura apareció duplicado 1 o 2 veces. No se anotó en qué caso, así que no se puede descartar que fuera en `saludo-y-tono`; afecta a C1 de US-06. La prueba no se repitió por [D22](../../docs/decisiones.md) y porque el panel de prueba de Retell no guarda historial.
