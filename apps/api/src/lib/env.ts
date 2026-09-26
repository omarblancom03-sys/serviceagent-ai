import type { TokenPayload } from '@serviceagent/shared';

/** Variables de entorno del Worker. Plantilla en `.env.example`; en local van en `apps/api/.dev.vars`. */
export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
  /** Secreto que se mezcla con cada PIN antes del hash (D13). */
  PIN_PEPPER: string;
  /** Duración del token: `8h`, `30m`, `900s`. Por defecto `8h`. */
  JWT_EXPIRES_IN?: string;
  /** Orígenes permitidos para CORS, separados por coma. */
  CORS_ORIGINS?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    /** Sesión del empleado; la pone `requiereRol` después de verificar el token. */
    sesion: TokenPayload;
  };
}
