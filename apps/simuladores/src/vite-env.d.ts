/// <reference types="vite/client" />

/** Variables `VITE_*` que usan los simuladores. Terminan en el navegador: nunca secretos. */
interface ImportMetaEnv {
  /** URL de la API, donde vive el servidor del banco simulado (por ejemplo, `http://localhost:8787`). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
