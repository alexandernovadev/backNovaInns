import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, mongo } from 'mongoose';
import { Booking } from '../bookings';
import { Apartment } from '../apartments';
import { Expense } from '../expenses';
import {
  ActionChange,
  ActionTarget,
  AssistantAction,
  AssistantActionDocument,
} from './schemas/assistant-action.schema';
import { COLLECTIONS, ToolRun } from './nova-ai.tools';

const { BSON } = mongo;
const { EJSON, ObjectId } = BSON;

type CollectionName = (typeof COLLECTIONS)[number];

const MAX_TARGETS = 20;
const EXPIRES_MS = 10 * 60 * 1000;
// Campos que nunca se editan
const PROTECTED_FIELDS = new Set(['_id', 'createdAt', 'updatedAt', '__v']);

const targetParams = {
  collection: {
    type: 'string',
    enum: [...COLLECTIONS],
    description: 'Colección del documento',
  },
  ids: {
    type: 'array',
    items: { type: 'string' },
    description: `_id de los documentos (24 caracteres hex), máximo ${MAX_TARGETS}. Búscalos antes con find.`,
  },
  summary: {
    type: 'string',
    description:
      'Frase corta de lo que se hará, para el usuario (ej: "Registrar el pago completo de Karol Alvarez en efectivo")',
  },
};

export const NOVA_AI_PROPOSAL_TOOLS = [
  {
    type: 'function' as const,
    name: 'propose_update',
    description:
      'Propone editar documentos. NO modifica nada: el usuario ve una tarjeta con antes/después y decide.',
    parameters: {
      type: 'object',
      properties: {
        ...targetParams,
        changes: {
          type: 'array',
          description:
            'Campos a cambiar y su valor NUEVO (absoluto, no un incremento)',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description: 'Ruta del campo, ej: billing.status',
              },
              value: {
                type: 'string',
                description:
                  'Valor nuevo en JSON: "PAGADO" con comillas, 231584, {"$date":"2026-11-05T00:00:00Z"}',
              },
            },
            required: ['field', 'value'],
          },
        },
      },
      required: ['collection', 'ids', 'changes', 'summary'],
    },
  },
  {
    type: 'function' as const,
    name: 'propose_delete',
    description:
      'Propone eliminar documentos. NO borra nada: el usuario ve una tarjeta y decide.',
    parameters: {
      type: 'object',
      properties: targetParams,
      required: ['collection', 'ids', 'summary'],
    },
  },
];

// Lo que ve el front en la tarjeta
export interface ActionCard {
  id: string;
  type: 'update' | 'delete';
  collection: CollectionName;
  status: string;
  summary: string;
  expiresAt: Date;
  targets: {
    id: string;
    label: string;
    changes: ActionChange[];
    details: { field: string; value: unknown }[];
  }[];
}

class ProposalError extends Error {}

@Injectable()
export class NovaAiProposals {
  private readonly models: Record<CollectionName, Model<any>>;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(AssistantAction.name)
    private readonly actionModel: Model<AssistantActionDocument>,
    @InjectModel(Booking.name) bookingModel: Model<any>,
    @InjectModel(Apartment.name) apartmentModel: Model<any>,
    @InjectModel(Expense.name) expenseModel: Model<any>,
  ) {
    this.models = {
      bookings: bookingModel,
      apartments: apartmentModel,
      expenses: expenseModel,
    };
  }

  async propose(
    name: string,
    args: Record<string, unknown>,
    request: string,
    userId: string | null,
  ): Promise<{ run: ToolRun; card?: ActionCard }> {
    const collection = String(args.collection ?? '');
    const type = name === 'propose_delete' ? 'delete' : 'update';
    const summary = `${collection || '?'} (propuesta de ${type === 'delete' ? 'eliminación' : 'edición'})`;
    try {
      if (!COLLECTIONS.includes(collection as CollectionName))
        throw new ProposalError(
          `Colección no permitida. Usa: ${COLLECTIONS.join(', ')}`,
        );
      const col = collection as CollectionName;
      const docs = await this.loadTargets(col, args.ids);
      const names = await this.apartmentNames();
      const targets: ActionTarget[] = [];
      for (const doc of docs) {
        const changes =
          type === 'update' ? await this.diff(col, doc, args.changes) : [];
        if (type === 'update' && !changes.length) continue;
        targets.push({
          id: String(doc._id),
          label: this.label(col, doc, names),
          before: doc,
          changes,
        });
      }
      if (!targets.length)
        throw new ProposalError(
          'Los valores nuevos son iguales a los actuales: no hay nada que cambiar',
        );

      const action = await this.actionModel.create({
        type,
        targetCollection: col,
        summary: String(args.summary ?? '').slice(0, 300),
        request: request.slice(0, 1000),
        targets,
        userId,
        expiresAt: new Date(Date.now() + EXPIRES_MS),
      });
      return {
        run: {
          ok: true,
          summary,
          result: JSON.stringify({
            proposal_id: String(action._id),
            documentos: targets.length,
            cambios: targets.map((t) => ({ doc: t.label, cambios: t.changes })),
            nota: 'Propuesta lista. El usuario la confirma o la cancela en una tarjeta. NO digas que ya se hizo; dile que revise la tarjeta.',
          }),
        },
        card: this.toCard(action, names),
      };
    } catch (err) {
      const msg =
        err instanceof ProposalError
          ? err.message
          : `Error: ${(err as Error).message}`;
      return { run: { ok: false, summary, result: msg } };
    }
  }

  async cancel(id: string) {
    const action = ObjectId.isValid(id)
      ? await this.actionModel.findById(id)
      : null;
    if (!action) throw new NotFoundException('Propuesta no encontrada');
    if (action.status === 'pending') {
      action.status = action.expiresAt < new Date() ? 'expired' : 'cancelled';
      await action.save();
    }
    return { id: String(action._id), status: action.status };
  }

  // ── helpers ──

  private async loadTargets(col: CollectionName, rawIds: unknown) {
    if (!Array.isArray(rawIds) || !rawIds.length)
      throw new ProposalError('ids debe ser una lista con al menos un _id');
    if (rawIds.length > MAX_TARGETS)
      throw new ProposalError(`Máximo ${MAX_TARGETS} documentos por propuesta`);
    const bad = rawIds.filter((id) => !ObjectId.isValid(String(id)));
    if (bad.length) throw new ProposalError(`_id inválidos: ${bad.join(', ')}`);
    const ids = [...new Set(rawIds.map(String))].map((id) => new ObjectId(id));
    const docs = await this.connection
      .db!.collection(col)
      .find({ _id: { $in: ids } })
      .toArray();
    if (docs.length !== ids.length) {
      const found = new Set(docs.map((d) => String(d._id)));
      throw new ProposalError(
        `No existen: ${ids.filter((i) => !found.has(String(i))).join(', ')}`,
      );
    }
    return docs;
  }

  // Aplica los cambios a una copia, la valida con el schema y devuelve antes/después
  private async diff(
    col: CollectionName,
    raw: Record<string, any>,
    rawChanges: unknown,
  ): Promise<ActionChange[]> {
    if (!Array.isArray(rawChanges) || !rawChanges.length)
      throw new ProposalError('changes debe tener al menos un campo');
    const model = this.models[col];
    // Copia BSON: conserva ObjectId y Date (structuredClone los rompe)
    const doc = model.hydrate(BSON.deserialize(BSON.serialize(raw)));
    const fields: string[] = [];

    for (const c of rawChanges as { field?: unknown; value?: unknown }[]) {
      const field = String(c?.field ?? '');
      if (!field || field.includes('$') || PROTECTED_FIELDS.has(field))
        throw new ProposalError(`Campo no editable: ${field || '(vacío)'}`);
      if (model.schema.pathType(field) !== 'real')
        throw new ProposalError(`Campo desconocido en ${col}: ${field}`);
      // JSON (números, fechas EJSON, "texto"); si no es JSON se toma como texto
      let value: unknown;
      try {
        value = EJSON.parse(String(c.value), { relaxed: true });
      } catch {
        value = String(c.value);
      }
      if (field === 'apartmentId') value = await this.checkApartment(value);
      doc.set(field, value);
      fields.push(field);
    }

    // El total de una reserva siempre es precio base + extras
    if (
      col === 'bookings' &&
      fields.some(
        (f) =>
          f.startsWith('billing.basePrice') ||
          f.startsWith('billing.extraServices'),
      )
    ) {
      const extras = ((doc.get('billing.extraServices') as any[]) ?? []).reduce(
        (sum: number, e: any) => sum + (e.price ?? 0) * (e.quantity ?? 1),
        0,
      );
      doc.set('billing.totalAmount', doc.get('billing.basePrice') + extras);
      if (!fields.includes('billing.totalAmount'))
        fields.push('billing.totalAmount');
    }

    try {
      await doc.validate();
    } catch (err) {
      const errors = (err as { errors?: Record<string, Error> }).errors;
      throw new ProposalError(
        `Valores no válidos: ${
          errors
            ? Object.values(errors)
                .map((e) => e.message)
                .join('; ')
            : (err as Error).message
        }`,
      );
    }

    const plain = doc.toObject({ depopulate: true });
    return fields
      .map((field) => ({
        field,
        before: this.read(raw, field),
        after: this.read(plain, field),
      }))
      .filter((c) => !this.same(c.before, c.after));
  }

  private async checkApartment(value: unknown) {
    const id = String(value);
    const exists =
      ObjectId.isValid(id) &&
      (await this.connection
        .db!.collection('apartments')
        .countDocuments({ _id: new ObjectId(id) }));
    if (!exists) throw new ProposalError(`No existe el apartamento ${id}`);
    // En bookings apartmentId se guarda como string
    return id;
  }

  private read(obj: Record<string, any>, path: string): unknown {
    return path
      .split('.')
      .reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
  }

  private same(a: unknown, b: unknown) {
    return (
      JSON.stringify(EJSON.serialize(a ?? null)) ===
      JSON.stringify(EJSON.serialize(b ?? null))
    );
  }

  private async apartmentNames() {
    const apts = await this.connection
      .db!.collection('apartments')
      .find({}, { projection: { internalName: 1 } })
      .toArray();
    return new Map(apts.map((a) => [String(a._id), a.internalName as string]));
  }

  private label(
    col: CollectionName,
    d: Record<string, any>,
    names: Map<string, string>,
  ) {
    const day = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
    if (col === 'bookings')
      return `${d.group?.host?.fullName ?? 'Sin nombre'} · ${names.get(String(d.apartmentId)) ?? 'apto desconocido'} · ${day(d.stay?.checkIn)} → ${day(d.stay?.checkOut)}`;
    if (col === 'apartments') return String(d.internalName ?? d._id);
    return `${d.description ?? 'Gasto'} · $${d.amount ?? 0} · ${day(d.date)}`;
  }

  // Datos clave para la tarjeta de eliminación
  private details(
    col: CollectionName,
    d: Record<string, any>,
    names: Map<string, string>,
  ) {
    if (col === 'bookings')
      return [
        { field: 'group.host.fullName', value: d.group?.host?.fullName },
        { field: 'apartmentId', value: names.get(String(d.apartmentId)) },
        { field: 'stay.checkIn', value: d.stay?.checkIn },
        { field: 'stay.checkOut', value: d.stay?.checkOut },
        { field: 'billing.totalAmount', value: d.billing?.totalAmount },
        { field: 'billing.amountReceived', value: d.billing?.amountReceived },
        { field: 'billing.status', value: d.billing?.status },
        { field: 'billing.platform', value: d.billing?.platform },
      ];
    if (col === 'apartments')
      return [
        { field: 'internalName', value: d.internalName },
        { field: 'status', value: d.status },
      ];
    return [
      { field: 'description', value: d.description },
      { field: 'amount', value: d.amount },
      { field: 'category', value: d.category },
      { field: 'date', value: d.date },
    ];
  }

  private toCard(
    action: AssistantActionDocument,
    names: Map<string, string>,
  ): ActionCard {
    return {
      id: String(action._id),
      type: action.type,
      collection: action.targetCollection,
      status: action.status,
      summary: action.summary,
      expiresAt: action.expiresAt,
      targets: action.targets.map((t) => ({
        id: t.id,
        label: t.label,
        changes: t.changes,
        details:
          action.type === 'delete'
            ? this.details(action.targetCollection, t.before, names)
            : [],
      })),
    };
  }
}
