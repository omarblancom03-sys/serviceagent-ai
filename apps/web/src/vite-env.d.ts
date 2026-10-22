/// <reference types="vite/client" />

/** Variables `VITE_*` que usa la web. Terminan en el navegador: nunca secretos. */
interface ImportMetaEnv {
  /** URL de la API (por ejemplo, `http://localhost:8787`). */
  readonly VITE_API_URL?: string;
  /** URL del proyecto de Supabase, solo para escuchar la señal de Realtime (D47). */
  readonly VITE_SUPABASE_URL?: string;
  /**
   * Llave pública de Supabase: la anon o la publishable (`sb_publishable_…`), nunca la secreta ni la
   * de servicio. Pública por diseño; con ella no se lee ninguna tabla (D15).
   */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
