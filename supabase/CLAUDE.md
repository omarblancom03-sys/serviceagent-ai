# supabase/ — Base de datos

## Qué es

Esquema y datos de la base de datos del proyecto (Supabase / PostgreSQL). Aquí vive todo lo que define tablas, índices, funciones, RLS y datos iniciales.

## Cómo está organizado

- `migrations/`: migraciones SQL versionadas. Hoy vacía; la primera (esquema del menú) se define en US-02-P1.
- `seed/`: carga del menú real del restaurante y datos de demostración (empleados, pedidos de ejemplo). Hoy vacía; se define en US-02-P2.
- Configuración de Supabase (`config.toml`) y comando `pnpm db:reset` (recrear la base desde migraciones + seed): pendiente: se define en US-02-P1.

## Convenciones de esta área

- Cada cambio al esquema (tablas, índices, funciones, RLS) entra como un archivo nuevo con prefijo de fecha, por ejemplo `20261001120000_crear_productos.sql`.
- **Nunca** se edita una migración que ya llegó a `main`: se crea otra.
- Tablas y columnas en `snake_case`, en español y sin acentos (`pedidos`, `modo_envio_cocina`).
- Montos en centavos (`integer`).
- Los datos simulados del seed (insumos, cantidades) se marcan como tales.
- El descuento y la reposición de inventario ocurren dentro de una transacción.

## Cómo probar

Pendiente: se define en US-02-P1 (con `pnpm db:reset`).

## Reglas que aplican

- [docs/negocio.md](../../docs/negocio.md): estados del pedido con su hora, pagos, inventario y recetas.
- [docs/decisiones.md](../../docs/decisiones.md): D2, D3, D7 y pendientes de embeddings (US-16) y Realtime con auth propia (US-04 / US-10).
- [docs/despliegue.md](../../docs/despliegue.md): variables `SUPABASE_*`; la llave de servicio solo en la API.
