# supabase/

Documentación de esta carpeta: [CLAUDE.md](./CLAUDE.md).

## Diagrama entidad-relación — Menú (US-02-P1)

Refleja el esquema real definido en `migrations/20260929100000_crear_esquema_menu.sql`
y `migrations/20260929130000_platillo_extra_y_fix_permisos.sql`.

```mermaid
erDiagram
    CATEGORIA_PRODUCTO ||--o{ PLATILLO : contiene
    PLATILLO ||--o{ VARIANTE_PRODUCTO : tiene
    PLATILLO ||--o{ SINONIMO_PRODUCTO : tiene
    PLATILLO ||--o{ INGREDIENTE_REMOVIBLE : permite_quitar
    PLATILLO ||--o{ PLATILLO_EXTRA : admite
    EXTRA ||--o{ PLATILLO_EXTRA : aplica_a

    CATEGORIA_PRODUCTO {
        integer id_categoria PK
        text nombre
        text descripcion
        boolean activo
    }
    PLATILLO {
        integer id_platillo PK
        integer id_categoria FK
        text nombre
        text descripcion
        text imagen
        integer tiempo_estimado_min
        boolean activo
    }
    VARIANTE_PRODUCTO {
        integer id_variante PK
        integer id_platillo FK
        text nombre
        integer precio_centavos
        text descripcion
        boolean activo
    }
    SINONIMO_PRODUCTO {
        integer id_sinonimo PK
        integer id_platillo FK
        text frase
        boolean activo
    }
    INGREDIENTE_REMOVIBLE {
        integer id_ingrediente_removible PK
        integer id_platillo FK
        text nombre
        boolean activo
    }
    EXTRA {
        integer id_extra PK
        text nombre
        integer precio_centavos
        text descripcion
        boolean activo
    }
    PLATILLO_EXTRA {
        integer id_platillo PK,FK
        integer id_extra PK,FK
    }
```

- **categoria_producto**: las secciones del menú (Entradas, Hamburguesas, Bebidas, etc.).
- **platillo**: cada producto del menú, ligado a una categoría.
- **variante_producto**: opciones de un mismo platillo con precio propio (ej. tamaños, preparaciones). Todo platillo tiene al menos una variante, aunque sea "Único", porque el precio vive aquí, no en `platillo`.
- **sinonimo_producto**: formas alternativas de nombrar un platillo, para que el agente lo reconozca.
- **ingrediente_removible**: ingredientes que el cliente puede pedir quitar de un platillo, sin cambio de precio.
- **extra**: complementos cobrables (ej. Totopos, Aguacate).
- **platillo_extra**: qué extras aplican a qué platillo (ej. "Espuelas" solo en ciertos cortes). Sin esta tabla el backend no puede validar un extra antes de cobrarlo.

Todas las tablas tienen RLS activo, sin políticas, y solo `service_role` (la API) tiene `GRANT select` — el menú no se lee directo desde el frontend ni con la llave `anon` (D12, D15).
