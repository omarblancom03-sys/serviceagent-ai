/// <reference types="vite/client" />

/** Variables `VITE_*` que usa la web. Terminan en el navegador: nunca secretos. */
interface ImportMetaEnv {
  /** URL de la API (por ejemplo, `http://localhost:8787`). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
