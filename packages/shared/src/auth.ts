import { z } from 'zod';

/** Roles de empleado. `admin` puede entrar a todo. */
export const RolSchema = z.enum(['cocina', 'caja', 'admin']);
export type Rol = z.infer<typeof RolSchema>;

/** PIN de 4 dígitos (simula el lector de huella). */
export const PinSchema = z.string().regex(/^\d{4}$/, 'El PIN debe tener 4 dígitos');

/** Lo único que se muestra de un empleado en la pantalla de acceso. */
export const EmpleadoPublicoSchema = z.object({
  id: z.uuid(),
  nombre: z.string().min(1),
  rol: RolSchema,
});
export type EmpleadoPublico = z.infer<typeof EmpleadoPublicoSchema>;

/** Cuerpo de `POST /auth/login`. */
export const LoginSchema = z.object({
  empleadoId: z.uuid(),
  pin: PinSchema,
});
export type Login = z.infer<typeof LoginSchema>;

/**
 * Payload del JWT propio. Solo estos tres campos (docs/negocio.md → Autenticación):
 * `sub` = id del empleado, `rol` y `exp` (segundos Unix). Cualquier campo extra se rechaza.
 */
export const TokenPayloadSchema = z.strictObject({
  sub: z.uuid(),
  rol: RolSchema,
  exp: z.number().int().positive(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

/** Respuesta de `POST /auth/login` cuando el PIN es correcto. */
export const SesionSchema = z.object({
  token: z.string().min(1),
  /** Fecha de expiración del token en ISO 8601. */
  expiraEn: z.iso.datetime(),
  empleado: EmpleadoPublicoSchema,
});
export type Sesion = z.infer<typeof SesionSchema>;

/** Respuesta de error de los endpoints de autenticación. */
export const ErrorAuthSchema = z.object({
  error: z.string(),
  /** Solo con PIN incorrecto: intentos que quedan antes del bloqueo. */
  intentosRestantes: z.number().int().nonnegative().optional(),
  /** Solo con empleado bloqueado: minutos que faltan para poder intentar de nuevo. */
  minutosRestantes: z.number().int().positive().optional(),
});
export type ErrorAuth = z.infer<typeof ErrorAuthSchema>;
