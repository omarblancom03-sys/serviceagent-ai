import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import {
  CotizarPedidoArgsSchema,
  ExtraPedidoSchema,
  ExtraSueltoPedidoSchema,
  ProductoPedidoSchema,
} from '@serviceagent/shared';

// Este test no habla con Retell. Compara el JSON Schema que se pega en el
// dashboard (agent/functions) con el contrato zod de packages/shared: si uno
// cambia y el otro no, falla aqui y no en una conversacion con un cliente.

const raizAgente = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function leerJson(rutaRelativa: string): unknown {
  return JSON.parse(readFileSync(path.join(raizAgente, rutaRelativa), 'utf-8'));
}

// Las unicas palabras de JSON Schema que usamos. Es estricto: una palabra
// nueva (enum, minimum...) obliga a revisar este test antes de entrar.
type Nodo = {
  type: 'object' | 'array' | 'string' | 'number';
  description?: string | undefined;
  properties?: Record<string, Nodo> | undefined;
  required?: string[] | undefined;
  additionalProperties?: boolean | undefined;
  items?: Nodo | undefined;
};

const esquemaNodo: z.ZodType<Nodo> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['object', 'array', 'string', 'number']),
    description: z.string().trim().min(1).optional(),
    properties: z.record(z.string(), esquemaNodo).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
    items: esquemaNodo.optional(),
  }),
);

function propiedad(nodo: Nodo, llave: string): Nodo {
  const hija = nodo.properties?.[llave];
  if (!hija) throw new Error(`Falta la propiedad "${llave}" en el JSON Schema`);
  return hija;
}

function elemento(nodo: Nodo): Nodo {
  if (!nodo.items) throw new Error('La lista no dice de que son sus elementos (items)');
  return nodo.items;
}

/** Arma un valor de ejemplo con TODAS las propiedades que declara el JSON Schema. */
function ejemplo(nodo: Nodo): unknown {
  if (nodo.type === 'string') return 'texto';
  if (nodo.type === 'number') return 1;
  if (nodo.type === 'array') return [ejemplo(elemento(nodo))];
  return Object.fromEntries(
    Object.entries(nodo.properties ?? {}).map(([llave, hija]) => [llave, ejemplo(hija)]),
  );
}

function sinLlave(objeto: unknown, llave: string): unknown {
  return Object.fromEntries(Object.entries(objeto as object).filter(([k]) => k !== llave));
}

describe('cotizar_pedido: el JSON Schema coincide con el contrato', () => {
  const raiz = esquemaNodo.parse(leerJson('functions/cotizar_pedido.json'));
  const producto = elemento(propiedad(raiz, 'productos'));

  const niveles = [
    { nombre: 'args', nodo: raiz, contrato: CotizarPedidoArgsSchema },
    { nombre: 'producto', nodo: producto, contrato: ProductoPedidoSchema },
    {
      nombre: 'extra de un platillo',
      nodo: elemento(propiedad(producto, 'extras')),
      contrato: ExtraPedidoSchema,
    },
    {
      nombre: 'extra suelto',
      nodo: elemento(propiedad(raiz, 'extrasSueltos')),
      contrato: ExtraSueltoPedidoSchema,
    },
  ];

  it('el nivel superior es un objeto (Retell lo exige)', () => {
    expect(raiz.type).toBe('object');
  });

  describe.each(niveles)('$nombre', ({ nodo, contrato }) => {
    const llaves = Object.keys(nodo.properties ?? {});
    const completo = ejemplo(nodo);

    it('tiene las mismas llaves que el contrato', () => {
      expect([...llaves].sort()).toEqual(Object.keys(contrato.shape).sort());
    });

    it('prohibe llaves de mas, igual que el contrato', () => {
      expect(nodo.additionalProperties).toBe(false);
      expect(contrato.safeParse({ ...(completo as object), llaveDeMas: 1 }).success).toBe(false);
    });

    it('un ejemplo con todas las propiedades pasa por el contrato', () => {
      expect(contrato.safeParse(completo).error?.issues ?? []).toEqual([]);
    });

    it.each(llaves)('"%s" es obligatoria solo si el contrato la exige', (llave) => {
      const obligatoriaEnJson = (nodo.required ?? []).includes(llave);
      const obligatoriaEnContrato = !contrato.safeParse(sinLlave(completo, llave)).success;
      expect(obligatoriaEnJson).toBe(obligatoriaEnContrato);
    });

    it.each(llaves)('"%s" trae descripcion para el modelo', (llave) => {
      expect(propiedad(nodo, llave).description).toBeDefined();
    });
  });
});

describe('cotizar_pedido en agent/retell.json', () => {
  // url lleva solo la ruta: la base es la URL de la API (docs/despliegue.md).
  // parameters apunta al archivo de functions/, como general_prompt a prompt.md.
  const esquemaHerramienta = z.looseObject({
    type: z.literal('custom'),
    name: z.string(),
    description: z.string().trim().min(1),
    url: z.string().startsWith('/'),
    method: z.literal('POST'),
    args_at_root: z.literal(false),
    parameters: z.string(),
  });
  const configuracion = z
    .object({ retell_llm: z.looseObject({ general_tools: z.array(esquemaHerramienta) }) })
    .parse(leerJson('retell.json'));
  const herramienta = configuracion.retell_llm.general_tools.find(
    (tool) => tool.name === 'cotizar_pedido',
  );

  it('esta declarada y llama a POST /pedidos/cotizar', () => {
    expect(herramienta?.url).toBe('/pedidos/cotizar');
  });

  // El contrato espera el sobre { name, call, args }: "Payload: args only" apagado.
  it('manda el sobre completo (args_at_root en false)', () => {
    expect(herramienta?.args_at_root).toBe(false);
  });

  it('sus parametros son el archivo de functions/', () => {
    expect(herramienta?.parameters).toBe('agent/functions/cotizar_pedido.json');
    expect(existsSync(path.join(raizAgente, 'functions', 'cotizar_pedido.json'))).toBe(true);
  });
});
