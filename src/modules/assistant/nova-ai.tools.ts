import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';

const { EJSON } = mongo.BSON;

// Solo estas colecciones; users queda fuera (contraseñas)
export const COLLECTIONS = ['bookings', 'apartments', 'expenses'] as const;
type CollectionName = (typeof COLLECTIONS)[number];

const MAX_TIME_MS = 5000;
const MAX_FIND = 50;
const MAX_AGG_DOCS = 200;
const MAX_RESULT_CHARS = 15000;

// Operadores que ejecutan código o escriben en otra colección
const FORBIDDEN_KEYS = new Set([
  '$where',
  '$function',
  '$accumulator',
  '$out',
  '$merge',
]);
const ALLOWED_STAGES = new Set([
  '$match',
  '$group',
  '$project',
  '$addFields',
  '$set',
  '$unset',
  '$sort',
  '$limit',
  '$skip',
  '$unwind',
  '$count',
  '$lookup',
  '$facet',
  '$bucket',
  '$bucketAuto',
  '$sortByCount',
  '$replaceRoot',
  '$replaceWith',
]);
// Campos que no se mandan al modelo: fotos de documentos, imágenes y comprobantes
const HIDDEN_KEYS = new Set(['identifications', 'photos', 'receipt']);

const collectionParam = {
  type: 'string',
  enum: [...COLLECTIONS],
  description: 'Colección a consultar',
};
const ejsonNote =
  'JSON en formato Extended JSON: fechas como {"$date":"2026-08-01T00:00:00Z"}, ObjectId como {"$oid":"..."}.';

export const NOVA_AI_TOOLS = [
  {
    type: 'function' as const,
    name: 'find',
    description: `Busca documentos. Devuelve como máximo ${MAX_FIND}.`,
    parameters: {
      type: 'object',
      properties: {
        collection: collectionParam,
        filter: { type: 'string', description: `Filtro Mongo. ${ejsonNote}` },
        projection: {
          type: 'string',
          description: 'Proyección Mongo en JSON (opcional)',
        },
        sort: { type: 'string', description: 'Orden en JSON (opcional)' },
        limit: {
          type: 'integer',
          description: `Máximo de documentos (1-${MAX_FIND}, por defecto 20)`,
        },
      },
      required: ['collection', 'filter'],
    },
  },
  {
    type: 'function' as const,
    name: 'count',
    description: 'Cuenta documentos que cumplen un filtro.',
    parameters: {
      type: 'object',
      properties: {
        collection: collectionParam,
        filter: { type: 'string', description: `Filtro Mongo. ${ejsonNote}` },
      },
      required: ['collection', 'filter'],
    },
  },
  {
    type: 'function' as const,
    name: 'distinct',
    description: 'Valores distintos de un campo.',
    parameters: {
      type: 'object',
      properties: {
        collection: collectionParam,
        field: { type: 'string', description: 'Campo, ej: billing.platform' },
        filter: {
          type: 'string',
          description: `Filtro Mongo (opcional). ${ejsonNote}`,
        },
      },
      required: ['collection', 'field'],
    },
  },
  {
    type: 'function' as const,
    name: 'aggregate',
    description: `Pipeline de agregación (sumas, agrupaciones, cruces con $lookup). Devuelve como máximo ${MAX_AGG_DOCS} documentos.`,
    parameters: {
      type: 'object',
      properties: {
        collection: collectionParam,
        pipeline: {
          type: 'string',
          description: `Array de etapas en JSON. ${ejsonNote}`,
        },
      },
      required: ['collection', 'pipeline'],
    },
  },
];

export interface ToolRun {
  ok: boolean;
  result: string;
  summary: string;
}

class ToolInputError extends Error {}

@Injectable()
export class NovaAiTools {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async run(name: string, args: Record<string, unknown>): Promise<ToolRun> {
    const collection = String(args.collection ?? '');
    const summary = `${collection || '?'} (${name})`;
    try {
      if (!COLLECTIONS.includes(collection as CollectionName))
        throw new ToolInputError(
          `Colección no permitida. Usa: ${COLLECTIONS.join(', ')}`,
        );
      const data = await this.exec(name, collection as CollectionName, args);
      return { ok: true, result: this.serialize(data), summary };
    } catch (err) {
      // El modelo ve el error y puede corregir la consulta
      const msg =
        err instanceof ToolInputError
          ? err.message
          : `Error de Mongo: ${(err as Error).message}`;
      return { ok: false, result: msg, summary };
    }
  }

  private async exec(
    name: string,
    collection: CollectionName,
    args: Record<string, unknown>,
  ) {
    const col = this.connection.db!.collection(collection);
    switch (name) {
      case 'find': {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), MAX_FIND);
        const docs = await col
          .find(this.parseObject(args.filter, 'filter') ?? {}, {
            projection: this.parseObject(args.projection, 'projection', true),
            sort: this.parseObject(args.sort, 'sort', true),
            limit,
            maxTimeMS: MAX_TIME_MS,
          })
          .toArray();
        return collection === 'bookings' ? this.withApartmentName(docs) : docs;
      }
      case 'count':
        return col.countDocuments(
          this.parseObject(args.filter, 'filter') ?? {},
          {
            maxTimeMS: MAX_TIME_MS,
          },
        );
      case 'distinct': {
        if (typeof args.field !== 'string' || !args.field)
          throw new ToolInputError('field es requerido');
        return col.distinct(
          args.field,
          this.parseObject(args.filter, 'filter', true) ?? {},
          { maxTimeMS: MAX_TIME_MS },
        );
      }
      case 'aggregate': {
        const pipeline = this.parse(args.pipeline, 'pipeline');
        if (!Array.isArray(pipeline))
          throw new ToolInputError('pipeline debe ser un array de etapas');
        for (const stage of pipeline) {
          const key = Object.keys(stage ?? {})[0];
          if (!ALLOWED_STAGES.has(key))
            throw new ToolInputError(`Etapa no permitida: ${key}`);
        }
        this.guard(pipeline);
        return col
          .aggregate([...pipeline, { $limit: MAX_AGG_DOCS }], {
            maxTimeMS: MAX_TIME_MS,
          })
          .toArray();
      }
      default:
        throw new ToolInputError(`Herramienta desconocida: ${name}`);
    }
  }

  // Las reservas solo traen apartmentId: se agrega el nombre real para que el
  // modelo no tenga que adivinarlo (llegó a inventar nombres de apartamentos)
  private async withApartmentName(docs: Record<string, any>[]) {
    const apts = await this.connection
      .db!.collection('apartments')
      .find({}, { projection: { internalName: 1 } })
      .toArray();
    const names = new Map(
      apts.map((a) => [String(a._id), a.internalName as string]),
    );
    return docs.map((d) =>
      d.apartmentId !== undefined
        ? { ...d, apartmentName: names.get(String(d.apartmentId)) ?? null }
        : d,
    );
  }

  private parse(raw: unknown, field: string): unknown {
    if (typeof raw !== 'string')
      throw new ToolInputError(`${field} debe ser un string JSON`);
    try {
      return EJSON.parse(raw, { relaxed: true });
    } catch (err) {
      throw new ToolInputError(
        `${field} no es JSON válido: ${(err as Error).message}`,
      );
    }
  }

  private parseObject(
    raw: unknown,
    field: string,
    optional = false,
  ): Record<string, any> | undefined {
    if (optional && (raw === undefined || raw === '' || raw === null))
      return undefined;
    const value = this.parse(raw, field);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ToolInputError(`${field} debe ser un objeto JSON`);
    this.guard(value);
    return value as Record<string, any>;
  }

  // Revisa todo el árbol: operadores prohibidos y $lookup a colecciones no permitidas
  private guard(node: unknown): void {
    if (Array.isArray(node)) return node.forEach((n) => this.guard(n));
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key))
        throw new ToolInputError(`Operador no permitido: ${key}`);
      if (key === '$lookup' || key === '$graphLookup' || key === '$unionWith') {
        const from =
          typeof value === 'string'
            ? value
            : ((value as { from?: string; coll?: string })?.from ??
              (value as { coll?: string })?.coll);
        if (!COLLECTIONS.includes(from as CollectionName))
          throw new ToolInputError(
            `${key} solo puede usar: ${COLLECTIONS.join(', ')}`,
          );
        if (key !== '$lookup')
          throw new ToolInputError(`Operador no permitido: ${key}`);
      }
      this.guard(value);
    }
  }

  private serialize(data: unknown): string {
    const json = JSON.stringify(
      EJSON.serialize(data, { relaxed: true }),
      (key, value: unknown) => (HIDDEN_KEYS.has(key) ? undefined : value),
    );
    return json.length > MAX_RESULT_CHARS
      ? `${json.slice(0, MAX_RESULT_CHARS)}… [resultado recortado: usa filtros, projection o aggregate para traer menos]`
      : json;
  }
}
