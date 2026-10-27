# Despliegue, CI y secretos

## Variables de entorno y secretos

**Ningún secreto se sube al repo.** `.env`, `.env.*` (excepto `.env.example`) y `.dev.vars` están en `.gitignore`. La plantilla con **todas** las variables está en [`.env.example`](../.env.example); se mantiene al día en el mismo PR que agrega una variable.

### API (Cloudflare Worker)

- **Nunca** pongas secretos en `vars` de `apps/api/wrangler.jsonc`: ese archivo se sube al repo y `vars` es solo para valores públicos.
- **Local:** crea `apps/api/.dev.vars` con las variables de la sección API de `.env.example` (`cp .env.example apps/api/.dev.vars` y borra lo que no es de la API). `wrangler dev` las carga solo.
  - Según la [documentación de Wrangler](https://developers.cloudflare.com/workers/configuration/secrets/), también puede leer un archivo `.env`, **pero no los dos**: si existe `.dev.vars`, ignora los `.env`. En este proyecto usamos **`.dev.vars`**.
- **Producción:** cada secreto se carga una vez con Wrangler y queda cifrado en Cloudflare:

  ```bash
  cd apps/api
  pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # pide el valor por consola
  pnpm exec wrangler secret list                            # lista los secretos cargados
  ```

### `JWT_SECRET` (sesiones de empleados)

Firma los JWT del login por PIN (docs/negocio.md → Autenticación). Si falta o tiene menos de 32 caracteres, `POST /auth/login` responde 500 y no toca los intentos del empleado.

- **Local:** genera uno y ponlo en `apps/api/.dev.vars` (`JWT_SECRET=<valor>`):

  ```bash
  openssl rand -base64 32
  ```

- **Producción:** uno distinto al de local, cargado con `cd apps/api && pnpm exec wrangler secret put JWT_SECRET`.
- Nunca en código, en `wrangler.jsonc` ni en commits. Cambiarlo cierra todas las sesiones abiertas.

### `PIN_PEPPER` (hash de los PIN)

Secreto que se mezcla con cada PIN (HMAC) antes del hash (D13). No vive en la base: si alguien roba la tabla `empleados`, sin el pepper no puede probar los 10 000 PIN posibles. Si falta o tiene menos de 32 caracteres, `POST /auth/login` responde 500 sin tocar los intentos.

- **Desarrollo:** un solo valor para todo el equipo, porque todos usan el mismo proyecto de Supabase y el seed se genera con él. Quien lo crea (`openssl rand -base64 32`) lo comparte por un canal privado; cada quien lo pone en `apps/api/.dev.vars`.
- **Ambiente desplegado:** mientras use la base `serviceagent-dev` (ver [Ambiente desplegado](#ambiente-desplegado)), lleva **el mismo** pepper de desarrollo; si no, los PIN del seed no coinciden.
- **Producción (base propia):** uno distinto, con `cd apps/api && pnpm exec wrangler secret put PIN_PEPPER`. Los empleados de producción se crean con hashes generados con ese pepper, nunca con el seed de desarrollo.
- **Cambiarlo invalida todos los PIN guardados.** Hay que regenerar los hashes (`pnpm --filter @serviceagent/api hash-pin <PIN>`).

### `RETELL_API_KEY` (firma de Retell)

Verifica `X-Retell-Signature` en las peticiones que manda Retell a la API (custom functions). Debe ser la API key de Retell que tiene el **badge de webhook**: con otra llave, ninguna firma coincide y la API responde 401. Si falta o está en blanco, esas rutas responden 500. La revisa el middleware `requiereFirmaRetell`; hoy lo usan `POST /pedidos/cotizar` (`cotizar_pedido`) y `POST /pedidos` (`crear_pedido`).

El chat web usa la misma llave para llamar a la API de Retell (`Authorization: Bearer`). Si falta, `POST /chat/...` responde 503 `servicio_no_disponible` sin abrir conversaciones ni contar mensajes.

- **Local:** en `apps/api/.dev.vars` (`RETELL_API_KEY=<valor>`), copiada del dashboard de Retell → API Keys.
- **Ambiente desplegado:** la carga el PO con `cd apps/api && pnpm exec wrangler secret put RETELL_API_KEY`.

### `RETELL_AGENT_ID` (agente del chat web)

Id del agente de chat de Retell con el que `POST /chat/conversaciones` abre cada chat. Obligatoria para el chat: si falta o está en blanco, responde 503 sin abrir la conversación ni gastar el tope diario. No es secreta, pero se carga igual que los secretos para no publicar identificadores de la cuenta ([agent/retell.md](../agent/retell.md#cómo-leer-retelljson)).

- **Local:** en `apps/api/.dev.vars` (`RETELL_AGENT_ID=<valor>`). Para probar sin gastar el saldo del equipo, usa el agente de tu propia cuenta de Retell ([D22](decisiones.md)).
- **Ambiente desplegado:** la carga el PO con `cd apps/api && pnpm exec wrangler secret put RETELL_AGENT_ID`.

### `CHAT_TOPE_DIARIO` (opcional)

Conversaciones nuevas del chat al día en todo el sistema, contadas por día de America/Chihuahua ([D38](decisiones.md)). Entero de 1 a 100; si falta, está vacía, no es un entero o está fuera de rango, se usa **3**: el chat nunca queda sin tope.

- **Ambiente desplegado:** para cambiarla sin tocar código, el PO la carga con `cd apps/api && pnpm exec wrangler secret put CHAT_TOPE_DIARIO`. No es secreta, pero en `vars` de `wrangler.jsonc` cambiarla exigiría un PR, y una variable puesta a mano en el dashboard se borra en el siguiente despliegue.

### Workers AI (binding `AI`)

La búsqueda semántica del menú calcula embeddings con Workers AI ([D50](decisiones.md)). No es un secreto ni una variable: es el binding `ai` de `apps/api/wrangler.jsonc` y se despliega con el Worker.

- **Local:** `wrangler dev` siempre llama a Workers AI remoto (puede cobrar uso) con la sesión de `wrangler login`. Sin sesión, `buscar_menu` responde 500.
- **Costo:** $0.0118 por millón de tokens. Indexar el menú completo son unos 10,000 tokens; cada búsqueda, unas decenas.
- Los tests no usan Workers AI: reemplazan el embedder por uno en memoria.

### Frontends (web y simuladores)

- Vite solo expone variables con prefijo `VITE_`, y **terminan en el navegador**. Nunca pongas secretos ahí.
- Local: `apps/web/.env.local` y `apps/simuladores/.env.local` (por ejemplo, `VITE_API_URL=http://localhost:8787`).
- En CI: `VITE_API_URL`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` se definen como **variables** (no secretos) del repo en GitHub y se usan al compilar en `deploy.yml`.
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` solo sirven para que `/cocina` y `/caja` escuchen la señal de Realtime (D47). En `VITE_SUPABASE_ANON_KEY` va una llave **pública**: la anon (formato anterior) o la publishable (`sb_publishable_…`, la que muestra hoy el dashboard de Supabase); las dos funcionan igual. **Nunca** la secret (`sb_secret_…`) ni la `service_role`. Es pública por diseño y no lee ninguna tabla (D15). Si faltan, o si la URL no tiene forma de URL (`createClient` truena y `crearClienteRealtime` devuelve `null`), la pantalla vive del refresco de 30 s. Con una URL bien formada pero equivocada o una llave mala no truena: el canal no conecta y la pantalla muestra "Sin conexión en vivo: se actualiza cada 30 s". En los dos casos funciona.

### GitHub Actions

| Nombre                   | Tipo     | Para qué                                               |
| ------------------------ | -------- | ------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`   | Secreto  | Desplegar el Worker y los proyectos de Pages           |
| `CLOUDFLARE_ACCOUNT_ID`  | Secreto  | Cuenta de Cloudflare donde se despliega                |
| `VITE_API_URL`           | Variable | URL pública de la API usada al compilar los frontends  |
| `VITE_SUPABASE_URL`      | Variable | URL de Supabase para la señal de Realtime de `/cocina` |
| `VITE_SUPABASE_ANON_KEY` | Variable | Llave pública (anon o publishable) para esa señal      |

Se configuran en Settings → Secrets and variables → Actions. Si los secretos no existen, el workflow de deploy **se salta con un aviso** en lugar de fallar. `CLOUDFLARE_ACCOUNT_ID` son 32 caracteres hexadecimales (Workers & Pages → columna derecha); si el valor no es ese, wrangler falla con `code: 7003`.

## Ambiente desplegado

| Servicio            | URL                                                |
| ------------------- | -------------------------------------------------- |
| API (Worker)        | https://serviceagent-api.omarblancom03.workers.dev |
| Web (Pages)         | https://serviceagent-web.pages.dev                 |
| Simuladores (Pages) | https://serviceagent-simuladores.pages.dev         |

- Usa la **misma base de Supabase `serviceagent-dev`** que el desarrollo local: lo que se cree en local se ve en el desplegado y al revés.
- El Worker tiene cargados `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (distinto al de local), `PIN_PEPPER` (el de desarrollo), `RETELL_API_KEY` y `CORS_ORIGINS`.
- `CORS_ORIGINS` es la lista, separada por comas, de orígenes exactos: `https://serviceagent-web.pages.dev`, sin `/` final. Las URLs de vista previa con prefijo (`<hash>.serviceagent-web.pages.dev`) no están incluidas, así que ahí el navegador bloquea las llamadas a la API.
- Solo el PO (Omar) tiene acceso a Cloudflare y carga los secretos del Worker. **Si una historia agrega una variable a la API:** va a `.env.example` en el mismo PR, se avisa al PO para que la cargue con `wrangler secret put` y el PR no se fusiona hasta que el PO confirme que la cargó ([D24](decisiones.md)). Un secreto se aplica al guardarlo, sin redesplegar.
- Revisar qué secretos tiene el Worker (solo nombres): `cd apps/api && pnpm exec wrangler secret list`.

## CI/CD

- **`.github/workflows/ci.yml`** corre en cada Pull Request a `main`: install (con cache de pnpm), lint, typecheck, test y build. El check se llama `verificar` y es el requerido para fusionar.
- **`.github/workflows/deploy.yml`** corre en cada push a `main`. Primero ejecuta el mismo CI (`verificar`) y **solo si pasa** despliega (decisión D10):
  - la API como Worker `serviceagent-api`,
  - `apps/web` en Cloudflare Pages como `serviceagent-web`,
  - `apps/simuladores` en Cloudflare Pages como `serviceagent-simuladores` (el proyecto de Pages se crea si no existe).
- Nunca corren dos despliegues a la vez; un push nuevo espera su turno.

`web` y `simuladores` son SPA: no tienen `404.html`, así que Pages devuelve `index.html` para cualquier ruta (`/cocina`, `/banco`, …).

Para desplegar a mano desde tu máquina hace falta una cuenta de Cloudflare y las variables `CLOUDFLARE_*` de `.env.example`.
