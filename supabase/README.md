# supabase/

Base de datos del proyecto (Supabase / PostgreSQL).

- **`migrations/`**: migraciones SQL versionadas. Cada cambio al esquema (tablas, índices, funciones, RLS) entra como un archivo nuevo con prefijo de fecha, por ejemplo `20261001120000_crear_productos.sql`. **Nunca** se edita una migración que ya llegó a `main`: se crea otra.
- **`seed/`**: carga del menú real del restaurante y datos de demostración (empleados, pedidos de ejemplo). Los datos simulados, como insumos y cantidades, se marcan como tales.

Convenciones: tablas y columnas en `snake_case`, en español y sin acentos. Montos en centavos (`integer`). Ver CLAUDE.md §5 y §8.

La configuración de Supabase y el comando `pnpm db:reset` se agregan en la historia que crea el primer esquema.
