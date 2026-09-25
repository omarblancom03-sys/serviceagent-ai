// Genera el hash de un PIN para supabase/seed/: pnpm --filter @serviceagent/api hash-pin 1234
// Usa el mismo código que la API (src/lib/pin.ts) y el PIN_PEPPER de apps/api/.dev.vars
// (lo carga `node --env-file-if-exists`). Solo imprime el hash, nunca el pepper.
import { hashPin } from '../src/lib/pin.ts';

const pin = process.argv[2];
if (!pin || !/^\d{4}$/.test(pin)) {
  console.error('Uso: pnpm --filter @serviceagent/api hash-pin <PIN de 4 dígitos>');
  process.exit(1);
}

try {
  console.log(await hashPin(pin, process.env.PIN_PEPPER ?? ''));
} catch (error) {
  console.error(`${(error as Error).message}\nDefínelo en apps/api/.dev.vars.`);
  process.exit(1);
}
