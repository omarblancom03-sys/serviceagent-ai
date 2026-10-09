# supabase/ — Base de datos

## Qué es

Esquema y datos de la base de datos del proyecto (Supabase / PostgreSQL). Aquí vive todo lo que define tablas, índices, funciones, RLS y datos iniciales. En desarrollo todos usamos el proyecto compartido **`serviceagent-dev`** en la nube de Supabase, sin Docker ([D16](../docs/decisiones.md)).

## Cómo está organizado

- `migrations/`: migraciones SQL versionadas. Hoy: `*_crear_empleados.sql` (US-04): tabla `empleados` y función `registrar_intento_fallido` (contador atómico de PIN incorrectos, D14). `*_crear_esquema_menu.sql` (US-02): tablas del menú. `*_cerrar_lectura_publica_menu.sql`: quita la lectura pública del menú (D15). `*_crear_platillo_extra.sql` (US-02-P1): tabla `platillo_extra` (qué extras aplican a qué platillo). `*_restricciones_unicas_menu.sql` (US-02-P2): restricciones únicas para que el seed del menú sea idempotente.
- `seed/`: datos de desarrollo y demostración, se corren en el orden declarado en `config.toml`. Hoy: `01_menu_el_granero.sql` (menú real: 16 categorías, 95 platillos, variantes, sinónimos y extras, US-02-P2, idempotente con `on conflict`; su sección 6 borra con un `delete` idempotente los sinónimos retirados, D27), `02_platillo_extra.sql` (relación de "Espuelas" con los cortes que la permiten, US-02-P1), `03_tiempos_preparacion_menu.sql` (llena `platillo.tiempo_estimado_min` con un tiempo fijo por categoría, D18; datos simulados) y `empleados.sql` (un empleado por rol).
- `config.toml`: configuración del CLI. Declara el orden de los seeds (`[db.seed] sql_paths`) y se usa junto con el script `pnpm db:reset:personal` de la raíz.
- [`README.md`](./README.md): diagrama entidad-relación del menú (Mermaid), con las tablas reales y su explicación.

### Empleados de prueba (SOLO DESARROLLO)

| Empleado         | Rol      | PIN    |
| ---------------- | -------- | ------ |
| Cocina de prueba | `cocina` | `1111` |
| Caja de prueba   | `caja`   | `2222` |
| Admin de prueba  | `admin`  | `3333` |

Estos PIN son públicos: **nunca** se usa este seed en un ambiente real. Los hashes se generan con el `PIN_PEPPER` de desarrollo ([docs/despliegue.md](../docs/despliegue.md#pin_pepper-hash-de-los-pin)); para crear otro: `pnpm --filter @serviceagent/api hash-pin <PIN>` (lee el pepper de `apps/api/.dev.vars`).

## Convenciones de esta área

- Cada cambio al esquema entra como un archivo nuevo con prefijo de fecha (`20261001120000_crear_productos.sql`). Se puede crear con `supabase migration new <nombre>`.
- **Nunca** se edita una migración que ya llegó a `main`: se crea otra.
- Tablas y columnas en `snake_case`, en español y sin acentos (`pedidos`, `modo_envio_cocina`). Montos en centavos (`integer`).
- **Permisos explícitos en toda tabla nueva.** El proyecto tiene desactivado "Automatically expose new tables", así que una tabla sin GRANT no se puede usar (error `42501`). Cada migración que crea una tabla incluye, en este orden:
  1. `revoke all on table public.<tabla> from anon, authenticated, service_role;`
  2. `grant` solo lo que la API necesita a `service_role` (el rol de la llave secreta), por columna si aplica. Ejemplo: `grant select on table public.empleados to service_role;`
  3. Ningún permiso ni policy para `anon` ni `authenticated`, **ni siquiera en tablas de lectura pública como el menú**: los frontends nunca leen tablas directo, piden a la API (D12, D15).
- **Funciones:** `set search_path = ''` y nombres con esquema (`public.tabla`). Postgres deja ejecutar funciones a `PUBLIC` por defecto, así que cada una lleva `revoke execute ... from public, anon, authenticated;` y `grant execute ... to service_role;`.
- **RLS activo en toda tabla nueva** (el proyecto también lo activa solo). Sin políticas: `service_role` tiene `BYPASSRLS` y los permisos por rol viven en la API.
- El seed se puede correr varias veces (`on conflict ... do nothing` o `do update`). Los datos simulados se marcan como tales.
- El descuento y la reposición de inventario ocurren dentro de una transacción.
- `platillo.nombre` es único: 16 nombres del menú fuente se ajustaron al cargarlos (3 por colisión entre categorías, 6 papas asadas con prefijo "Papa", y por decisión del PO 6 hamburguesas con prefijo "Hamburguesa" más "Filete de pescado infantil", para que no se lean ambiguos en cocina; el nombre original queda como sinónimo, salvo "Pollo", "Granero", "Delicias" y "Filete de pescado", retirados por genéricos, D27). La lista está al inicio de `seed/01_menu_el_granero.sql`.

## Cómo probar

Comandos del CLI que **no necesitan Docker** (se corren desde la raíz del repo con `pnpm dlx supabase`, sin instalar nada):

```bash
pnpm dlx supabase login                                  # una vez: abre el navegador
pnpm dlx supabase link --project-ref <ref-del-proyecto>  # una vez: pide la contraseña de la base
pnpm dlx supabase projects list                          # verificar a qué proyecto está enlazado (LINKED)
pnpm dlx supabase db push --dry-run --include-seed       # ver qué se aplicaría
pnpm dlx supabase db push --include-seed                 # aplicar (solo con el dry-run aprobado por Omar, si es serviceagent-dev)
pnpm db:reset:personal                                    # recrea todo desde cero — solo contra tu proyecto personal
```

- `db push` aplica solo las migraciones que faltan y lleva el registro en la base. `--include-seed` además corre los archivos de `seed/` declarados en `config.toml`.
- **Antes de cualquier `db reset` o `db push`, verifica a qué proyecto está enlazado el CLI** (`projects list`).
- **`serviceagent-dev` nunca se resetea** (D16): prohibido `db reset --linked` enlazado a él. Solo Omar, o quien él autorice, hace `db push` a `serviceagent-dev`, y solo después de que apruebe la salida del `--dry-run`.
- Para probar que la base se recrea desde cero (criterio de US-02-P1), usa el script `pnpm db:reset:personal` (equivale a `supabase db reset --linked`), enlazado a tu **proyecto personal** de Supabase. No lo uses enlazado al compartido.
- Necesitan Docker, y **no** los usamos: `supabase start`, `db pull`, `db diff`.
- Verificar: en el dashboard (Table Editor) debe verse `empleados` con 3 filas, el menú con sus categorías y platillos, `platillo_extra` con 5 filas (espuelas), ningún `platillo` con `tiempo_estimado_min` en `NULL`, y `POST /auth/login` con los PIN de arriba debe responder 200.
- `apps/api/test/menu.seed.test.ts` valida los archivos del seed como texto (sin conectarse a Supabase): conteos, nombres únicos, pares (platillo, variante) sin repetir, mismas categorías en `01` y `03`, y que los tiempos sean múltiplos de 5.

## Reglas que aplican

- [docs/negocio.md](../docs/negocio.md): autenticación, estados del pedido con su hora, pagos, inventario y recetas.
- [docs/decisiones.md](../docs/decisiones.md): D2, D3, D7, D12, D13, D14, D15, D16, D18 y pendiente de embeddings (US-16).
- [docs/despliegue.md](../docs/despliegue.md): variables `SUPABASE_*`; la llave de servicio solo en la API.