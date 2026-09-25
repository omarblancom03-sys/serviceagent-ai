# Registro de decisiones

Decisiones de arquitectura y de producto que ya aplican al repo.

- Solo se **agregan** filas. Una decisión reemplazada no se borra: se marca "Reemplazada por Dxx" y se agrega la nueva.
- Una decisión pendiente, al resolverse en su historia, sale de "Pendientes" y entra como fila nueva.

| #   | Decisión                                                                                                                                  | Por qué                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D1  | TypeScript en todo el proyecto                                                                                                            | Cualquiera de los 4 puede tomar cualquier tarea                                                                       |
| D2  | Supabase en lugar de todo-Cloudflare (D1)                                                                                                 | Tiempo real para cocina/caja, transacciones para inventario, pgvector para RAG, sin la complejidad de Durable Objects |
| D3  | RAG propio con pgvector en vez de solo la base de conocimiento de Retell                                                                  | Precios y disponibilidad cambian; el RAG propio devuelve datos en vivo y reduce tokens                                |
| D4  | Chat primero, voz al final                                                                                                                | Probar y estabilizar la lógica con menor costo antes de pasar a llamadas                                              |
| D5  | WhatsApp y banco simulados, detrás de interfaces                                                                                          | Cero costo y demo confiable; se pueden cambiar por servicios reales sin tocar el resto                                |
| D6  | Login por PIN con roles                                                                                                                   | Simula huella; simple de implementar y de demostrar                                                                   |
| D7  | Montos en centavos (integer)                                                                                                              | Evitar errores de redondeo con decimales                                                                              |
| D8  | Tests de API con Vitest normal y `app.request()` de Hono; `@cloudflare/vitest-pool-workers` solo si una historia necesita bindings reales | Más simple y rápido; se migra cuando haga falta                                                                       |
| D9  | `packages/shared` se consume como código TypeScript fuente, sin paso de build                                                             | Vite y Wrangler lo compilan solos; menos configuración                                                                |
| D10 | El deploy a Cloudflare depende de que pase CI                                                                                             | Evita publicar código roto aunque la protección de `main` no esté disponible                                          |
| D11 | Documentación modular: `CLAUDE.md` raíz corto + `CLAUDE.md` por área + `docs/` por tema; se mantiene con `/cerrar-historia` en cada PR    | Cada sesión carga solo lo necesario (menos tokens) y la documentación no se desactualiza                              |

## Pendientes (se resuelven en su historia)

- **Modelo de embeddings** (US-16): opción multilingüe de Cloudflare Workers AI vs. modelo de embeddings de un proveedor externo. Criterio: calidad en español, costo y latencia.
- **Realtime con auth propia** (US-04 / US-10): cómo aplicar permisos (RLS de Supabase con los claims del JWT propio vs. canales de broadcast emitidos desde la API).
- **Proveedor real de WhatsApp** (US-50, opcional): API de Meta en modo prueba vs. sandbox de Twilio.
