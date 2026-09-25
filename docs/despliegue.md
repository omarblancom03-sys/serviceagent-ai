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
- **Producción:** uno distinto, con `cd apps/api && pnpm exec wrangler secret put PIN_PEPPER`. Los empleados de producción se crean con hashes generados con ese pepper, nunca con el seed de desarrollo.
- **Cambiarlo invalida todos los PIN guardados.** Hay que regenerar los hashes (`pnpm --filter @serviceagent/api hash-pin <PIN>`).

### Frontends (web y simuladores)

- Vite solo expone variables con prefijo `VITE_`, y **terminan en el navegador**. Nunca pongas secretos ahí.
- Local: `apps/web/.env.local` y `apps/simuladores/.env.local` (por ejemplo, `VITE_API_URL=http://localhost:8787`).
- En CI: `VITE_API_URL` se define como **variable** (no secreto) del repo en GitHub.

### GitHub Actions

| Nombre                  | Tipo     | Para qué                                              |
| ----------------------- | -------- | ----------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secreto  | Desplegar el Worker y los proyectos de Pages          |
| `CLOUDFLARE_ACCOUNT_ID` | Secreto  | Cuenta de Cloudflare donde se despliega               |
| `VITE_API_URL`          | Variable | URL pública de la API usada al compilar los frontends |

Se configuran en Settings → Secrets and variables → Actions. Si los secretos no existen, el workflow de deploy **se salta con un aviso** en lugar de fallar.

## CI/CD

- **`.github/workflows/ci.yml`** corre en cada Pull Request a `main`: install (con cache de pnpm), lint, typecheck, test y build. El check se llama `verificar` y es el requerido para fusionar.
- **`.github/workflows/deploy.yml`** corre en cada push a `main`. Primero ejecuta el mismo CI (`verificar`) y **solo si pasa** despliega (decisión D10):
  - la API como Worker `serviceagent-api`,
  - `apps/web` en Cloudflare Pages como `serviceagent-web`,
  - `apps/simuladores` en Cloudflare Pages como `serviceagent-simuladores` (el proyecto de Pages se crea si no existe).
- Nunca corren dos despliegues a la vez; un push nuevo espera su turno.

`web` y `simuladores` son SPA: no tienen `404.html`, así que Pages devuelve `index.html` para cualquier ruta (`/cocina`, `/banco`, …).

Para desplegar a mano desde tu máquina hace falta una cuenta de Cloudflare y las variables `CLOUDFLARE_*` de `.env.example`.
