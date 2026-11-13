import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { roundBillingCop, roundMoneyValueCop } from '../../shared/money.util';
import type { BillingAmounts } from '../../shared/money.util';
import { BOOKING_EXTRACTION_SCHEMA } from './booking-extraction.prompt';

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
  {
    type: 'function' as const,
    name: 'propose_create',
    description:
      'Propone crear una reserva nueva. NO crea nada: el usuario ve una tarjeta, elige/confirma el apartamento y decide.',
    parameters: {
      type: 'object',
      properties: {
        // Misma forma que la reserva leída de un screenshot
        booking: BOOKING_EXTRACTION_SCHEMA,
        apartmentId: {
          type: 'string',
          description:
            '_id del apartamento (búscalo antes con find en apartments). Vacío si el dueño no lo dijo o no está claro: lo elige en la tarjeta.',
        },
      },
      required: ['booking', 'apartmentId'],
    },
  },
];

// Lo que ve el front en la tarjeta
export interface ActionCard {
  id: string;
  type: 'create' | 'update' | 'delete' | 'undo';
  collection: CollectionName;
  status: string;
  summary: string;
  warnings: string[];
  expiresAt: Date;
  // create: apartamento sugerido (el select de la tarjeta arranca con este)
  apartmentId?: string | null;
  targets: {
    id: string;
    label: string;
    changes: ActionChange[];
    details: { field: string; value: unknown }[];
  }[];
}

// Lo que ve Admin → Historial NovaAI
export interface HistoryItem extends ActionCard {
  request: string;
  error: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  undoneAt: Date | null;
  undoOf: string | null;
  undoActionId: string | null;
}

const HISTORY_FILTERS: Record<string, Record<string, unknown>> = {
  applied: { status: 'confirmed' },
  undone: { status: 'undone' },
  other: { status: { $in: ['pending', 'cancelled', 'expired', 'failed'] } },
};

class ProposalError extends Error {}

@Injectable()
export class NovaAiProposals {
  private readonly models: Record<CollectionName, Model<any>>;
  // Nombres de apartamento en caché (ver apartmentNames)
  private static readonly NAMES_TTL_MS = 30_000;
  private namesCache: { at: number; map: Map<string, string> } | null = null;

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
    if (name === 'propose_create')
      return this.proposeCreateFromChat(args, request, userId);
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

  // Tarjetas de una conversación guardada, con el estado actual de cada
  // propuesta. Una pendiente que ya venció se muestra como vencida
  async cards(ids: string[]): Promise<Map<string, ActionCard>> {
    const valid = ids.filter((id) => ObjectId.isValid(id));
    if (!valid.length) return new Map();
    const [actions, names] = await Promise.all([
      this.actionModel.find({ _id: { $in: valid } }),
      this.apartmentNames(),
    ]);
    const now = new Date();
    return new Map(
      actions.map((a) => {
        const card = this.toCard(a, names);
        if (card.status === 'pending' && a.expiresAt < now)
          card.status = 'expired';
        return [card.id, card];
      }),
    );
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

  // Reserva dictada en el chat → misma propuesta "create" que la del screenshot.
  // Si la reserva no es válida, el error vuelve al modelo para que la corrija
  private async proposeCreateFromChat(
    args: Record<string, unknown>,
    request: string,
    userId: string | null,
  ): Promise<{ run: ToolRun; card?: ActionCard }> {
    const summary = 'bookings (propuesta de creación)';
    try {
      const raw = args.booking;
      const booking = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
        Record<string, any> | undefined;
      if (!booking || typeof booking !== 'object')
        throw new ProposalError('Falta booking con los datos de la reserva');
      if (typeof booking.observations === 'string')
        booking.observations = booking.observations.replace(/\\n/g, '\n');
      const card = await this.proposeCreate(booking, request, userId, {
        apartmentId: String(args.apartmentId ?? ''),
      });
      return {
        run: {
          ok: true,
          summary,
          result: JSON.stringify({
            proposal_id: card.id,
            reserva: card.targets[0]?.label,
            avisos: card.warnings,
            nota: 'Propuesta lista. El usuario la confirma o la cancela en una tarjeta. NO digas que ya se hizo; dile que revise la tarjeta.',
          }),
        },
        card,
      };
    } catch (err) {
      return {
        run: { ok: false, summary, result: `Error: ${(err as Error).message}` },
      };
    }
  }

  // Reserva leída de un screenshot (o dictada en el chat) → propuesta "create".
  // El _id se reserva ya, para que confirmar y deshacer apunten siempre al mismo
  // documento. options.apartmentId: sugerencia; el definitivo sale al confirmar
  async proposeCreate(
    draft: Record<string, any>,
    request: string,
    userId: string | null,
    options: { apartmentId?: string } = {},
  ): Promise<ActionCard> {
    const { _id: _ignored, apartmentId: _apt, ...rest } = draft ?? {};
    // Montos en múltiplos de 100 COP (sin centavos) antes de mostrar la tarjeta
    const data = rest as { billing?: BillingAmounts };
    if (data.billing) data.billing = roundBillingCop(data.billing);
    const _id = new ObjectId();
    // apartmentId se elige al confirmar: aquí uno provisional solo para validar
    const doc = new this.models.bookings({
      ...data,
      _id,
      apartmentId: 'pending',
    });
    try {
      await doc.validate();
    } catch (err) {
      const errors = (err as { errors?: Record<string, Error> }).errors;
      throw new ConflictException({
        statusCode: 409,
        status: 'failed',
        message: `La reserva leída no es válida: ${
          errors
            ? Object.values(errors)
                .map((e) => e.message)
                .join('; ')
            : (err as Error).message
        }`,
      });
    }
    const plain = doc.toObject({ depopulate: true });
    if (!(plain.stay?.checkOut > plain.stay?.checkIn))
      throw new ConflictException({
        statusCode: 409,
        status: 'failed',
        message:
          'La reserva leída no es válida: la salida debe ser posterior a la entrada',
      });
    delete plain.apartmentId;
    // Apartamento sugerido: solo si existe; si no, se elige en la tarjeta
    if (options.apartmentId) {
      try {
        plain.apartmentId = await this.checkApartment(options.apartmentId);
      } catch {
        /* sin sugerencia */
      }
    }

    const names = await this.apartmentNames();
    const label = this.label('bookings', plain, names).replace(
      'apto desconocido',
      'apto por elegir',
    );
    const action = await this.actionModel.create({
      type: 'create',
      targetCollection: 'bookings',
      summary: `Crear reserva de ${plain.group?.host?.fullName ?? 'huésped'} (${plain.billing?.platform ?? 'sin plataforma'})`,
      request: request.slice(0, 1000),
      targets: [
        { id: String(_id), label, before: {}, changes: [], draft: plain },
      ],
      warnings: await this.duplicates(plain, names),
      userId,
      expiresAt: new Date(Date.now() + EXPIRES_MS),
    });
    return this.toCard(action, names);
  }

  // Misma reserva ya registrada: mismo huésped y misma entrada, o mismo
  // ID de Booking / código de AirBnB en las observaciones
  private async duplicates(
    b: Record<string, any>,
    names: Map<string, string>,
  ): Promise<string[]> {
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const or: Record<string, unknown>[] = [];
    const name = String(b.group?.host?.fullName ?? '').trim();
    if (name && b.stay?.checkIn)
      or.push({
        'group.host.fullName': { $regex: `^${esc(name)}$`, $options: 'i' },
        'stay.checkIn': b.stay.checkIn,
      });
    const code = /(?:ID Reserva|Codigo AirBnB):\s*(\S+)/i.exec(
      String(b.observations ?? ''),
    )?.[1];
    if (code) or.push({ observations: { $regex: esc(code) } });
    if (!or.length) return [];
    const found = await this.connection
      .db!.collection('bookings')
      .find({ $or: or })
      .limit(5)
      .toArray();
    return found.map(
      (d) => `Posible duplicado: ya existe ${this.label('bookings', d, names)}`,
    );
  }

  // Ejecuta una propuesta pendiente. Solo una vez (claim atómico), dentro del
  // plazo, y solo si los documentos siguen exactamente como cuando se propuso
  async confirm(
    id: string,
    userId: string | null,
    options: { apartmentId?: string } = {},
  ) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Propuesta no encontrada');
    // Crear una reserva exige elegir el apartamento (se valida antes de consumir la propuesta)
    const pre = await this.actionModel.findById(id, { type: 1 });
    let apartmentId: string | null = null;
    if (pre?.type === 'create') {
      try {
        apartmentId = await this.checkApartment(options.apartmentId ?? '');
      } catch {
        throw new ConflictException({
          statusCode: 409,
          status: 'pending',
          message: 'Elige el apartamento de la reserva antes de confirmar',
        });
      }
    }
    const now = new Date();
    const action = await this.actionModel.findOneAndUpdate(
      { _id: id, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: 'confirmed', confirmedAt: now, confirmedBy: userId } },
      { returnDocument: 'after' },
    );
    if (!action) {
      const current = await this.actionModel.findById(id);
      if (!current) throw new NotFoundException('Propuesta no encontrada');
      if (current.status === 'pending') {
        current.status = 'expired';
        await current.save();
        throw new ConflictException({
          statusCode: 409,
          status: 'expired',
          message:
            'La propuesta venció (10 minutos). Pídele a NovaAI que la vuelva a armar.',
        });
      }
      throw new ConflictException({
        statusCode: 409,
        status: current.status,
        message: `La propuesta ya no está pendiente (${current.status})`,
      });
    }

    const col = this.connection.db!.collection(action.targetCollection);
    const fail = async (error: string) => {
      action.status = 'failed';
      action.error = error;
      action.markModified('targets');
      await action.save();
      throw new ConflictException({
        statusCode: 409,
        status: 'failed',
        message: error,
      });
    };

    // Cualquier error inesperado deja la propuesta como fallida, nunca como
    // "confirmed" sin haberse aplicado
    try {
      // 1. Nada cambió desde la propuesta (si cambió, no se pisa). Una sola
      // lectura para todos los targets: antes era un findOne por target (hasta 20)
      const ids = action.targets.map((t) => new ObjectId(t.id));
      const existing = await col.find({ _id: { $in: ids } }).toArray();
      const byId = new Map(existing.map((d) => [String(d._id), d]));

      for (const t of action.targets) {
        const current = byId.get(String(t.id));
        if (action.type === 'create') {
          if (current) return fail(`"${t.label}" ya existe.`);
          continue;
        }
        if (!current)
          return fail(`"${t.label}" ya no existe. No se hizo ningún cambio.`);
        if (!this.sameDoc(current, t.before))
          return fail(
            `"${t.label}" cambió después de la propuesta. No se hizo ningún cambio; pídele a NovaAI que la vuelva a armar.`,
          );
      }

      // 2. Ejecutar. El filtro por updatedAt evita pisar un cambio que llegue justo ahora
      const written: ActionTarget[] = [];
      const names = await this.apartmentNames();
      for (const t of action.targets) {
        try {
          // before puede faltar: Mongoose no guarda objetos vacíos (create)
          const filter: Record<string, unknown> = { _id: new ObjectId(t.id) };
          if (t.before?.updatedAt) filter.updatedAt = t.before.updatedAt;
          if (action.type === 'create') {
            // Por el modelo: castea fechas, aplica defaults y timestamps
            await this.models.bookings.create({
              ...t.draft,
              _id: new ObjectId(t.id),
              apartmentId,
            });
            written.push(t);
          } else if (action.type === 'delete') {
            const r = await col.deleteOne(filter);
            if (!r.deletedCount)
              return fail(`"${t.label}" cambió justo antes de eliminarla.`);
            t.after = null;
          } else {
            const set = Object.fromEntries(
              t.changes.map((c) => [c.field, c.after]),
            );
            const r = await col.updateOne(filter, {
              $set: { ...set, updatedAt: now },
            });
            if (!r.matchedCount)
              return fail(`"${t.label}" cambió justo antes de guardarla.`);
            written.push(t);
          }
        } catch (err) {
          return fail(
            `Error al guardar "${t.label}": ${(err as Error).message}`,
          );
        }
      }

      // 3. Releer lo escrito en bloque (foto real del después, con casts y defaults)
      if (written.length) {
        const after = await col
          .find({ _id: { $in: written.map((t) => new ObjectId(t.id)) } })
          .toArray();
        const afterById = new Map(after.map((d) => [String(d._id), d]));
        for (const t of written) {
          t.after = afterById.get(String(t.id)) ?? null;
          if (action.type === 'create' && t.after)
            t.label = this.label('bookings', t.after, names);
        }
      }
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      return fail(`Error inesperado: ${(err as Error).message}`);
    }

    action.markModified('targets');
    await action.save();
    return { id: String(action._id), status: action.status };
  }

  async list(query: { page?: unknown; limit?: unknown; filter?: unknown }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    const filter = HISTORY_FILTERS[String(query.filter)] ?? {};
    const [total, actions, names] = await Promise.all([
      this.actionModel.countDocuments(filter),
      this.actionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.apartmentNames(),
    ]);
    const now = new Date();
    const data: HistoryItem[] = actions.map((a) => {
      const raw = a.toObject() as unknown as { createdAt: Date };
      return {
        ...this.toCard(a, names),
        // Una pendiente vencida se muestra como vencida aunque nadie la haya tocado
        status:
          a.status === 'pending' && a.expiresAt < now ? 'expired' : a.status,
        request: a.request,
        error: a.error,
        createdAt: raw.createdAt,
        confirmedAt: a.confirmedAt,
        undoneAt: a.undoneAt,
        undoOf: a.undoOf,
        undoActionId: a.undoActionId,
      };
    });
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  // Deshace un cambio confirmado. Si el documento cambió después del cambio
  // de la IA, avisa (409 status "changed") salvo que se pida force: en ese caso
  // solo se restauran los campos que tocó la IA y se respetan los demás.
  async undo(id: string, userId: string | null, force = false) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Cambio no encontrado');
    const action = await this.actionModel.findById(id);
    if (!action) throw new NotFoundException('Cambio no encontrado');
    const conflict = (status: string, message: string, extra = {}) =>
      new ConflictException({ statusCode: 409, status, message, ...extra });
    if (action.type === 'undo')
      throw conflict(action.status, 'Un deshacer no se puede deshacer');
    if (action.status !== 'confirmed')
      throw conflict(
        action.status,
        'Solo se pueden deshacer cambios que se aplicaron',
      );

    const col = this.connection.db!.collection(action.targetCollection);
    const drift: { label: string; fields: string[] }[] = [];
    // Comprobación de deriva en una sola lectura (antes era un findOne por target)
    const currents = await col
      .find({ _id: { $in: action.targets.map((t) => new ObjectId(t.id)) } })
      .toArray();
    const currentById = new Map(currents.map((d) => [String(d._id), d]));

    for (const t of action.targets) {
      const current = currentById.get(String(t.id)) ?? null;
      if (action.type === 'create') {
        if (!current)
          throw conflict(
            'confirmed',
            `"${t.label}" ya no existe (se borró después). No hay nada que deshacer.`,
          );
        const fields = this.changedPaths(t.after ?? {}, current);
        if (fields.length) drift.push({ label: t.label, fields });
      } else if (action.type === 'delete') {
        if (current)
          throw conflict(
            'confirmed',
            `"${t.label}" ya existe otra vez; no se puede restaurar encima.`,
          );
      } else {
        if (!current)
          throw conflict(
            'confirmed',
            `"${t.label}" ya no existe (se borró después). No se puede deshacer la edición.`,
          );
        const fields = this.changedPaths(t.after ?? {}, current);
        if (fields.length) drift.push({ label: t.label, fields });
      }
    }
    if (drift.length && !force)
      throw conflict(
        'changed',
        action.type === 'create'
          ? 'La reserva que creó NovaAI se editó después. Si deshaces igual, se elimina con esos cambios.'
          : 'Este documento cambió después del cambio de NovaAI. Si deshaces igual, solo se restauran los campos que cambió NovaAI.',
        { drift },
      );

    const now = new Date();
    const claimed = await this.actionModel.findOneAndUpdate(
      { _id: action._id, status: 'confirmed' },
      { $set: { status: 'undone', undoneAt: now, undoneBy: userId } },
      { returnDocument: 'after' },
    );
    if (!claimed)
      throw conflict(action.status, 'Este cambio ya no está aplicado');

    const undoTargets: ActionTarget[] = [];
    try {
      // Estado actual en una sola lectura (antes era 2 o 3 findOne por target)
      const pre = await col
        .find({ _id: { $in: claimed.targets.map((t) => new ObjectId(t.id)) } })
        .toArray();
      const preById = new Map(pre.map((d) => [String(d._id), d]));
      const restored: ActionTarget[] = [];

      for (const t of claimed.targets) {
        const _id = new ObjectId(t.id);
        const current = preById.get(String(t.id)) ?? null;
        if (claimed.type === 'create') {
          // Deshacer una creación = eliminar la reserva creada
          await col.deleteOne({ _id });
          undoTargets.push({
            id: t.id,
            label: t.label,
            before: current ?? {},
            changes: [],
            after: null,
          });
        } else if (claimed.type === 'delete') {
          // Vuelve el documento completo, con el mismo _id
          await col.insertOne({ ...t.before, _id });
          const target: ActionTarget = {
            id: t.id,
            label: t.label,
            before: {},
            changes: [],
            after: null,
          };
          undoTargets.push(target);
          restored.push(target);
        } else {
          await col.updateOne(
            { _id },
            {
              $set: {
                ...Object.fromEntries(
                  t.changes.map((c) => [c.field, c.before]),
                ),
                updatedAt: now,
              },
            },
          );
          const target: ActionTarget = {
            id: t.id,
            label: t.label,
            before: current ?? {},
            changes: t.changes.map((c) => ({
              field: c.field,
              before: this.read(current ?? {}, c.field),
              after: c.before,
            })),
            after: null,
          };
          undoTargets.push(target);
          restored.push(target);
        }
      }

      // Foto final, en bloque también
      if (restored.length) {
        const post = await col
          .find({ _id: { $in: restored.map((t) => new ObjectId(t.id)) } })
          .toArray();
        const postById = new Map(post.map((d) => [String(d._id), d]));
        for (const t of restored) t.after = postById.get(String(t.id)) ?? null;
      }
    } catch (err) {
      // Si no se alcanzó a restaurar nada, el cambio sigue aplicado
      if (!undoTargets.length) {
        claimed.status = 'confirmed';
        claimed.undoneAt = null;
        claimed.undoneBy = null;
        await claimed.save();
      } else {
        claimed.error = `Deshacer parcial: ${(err as Error).message}`;
        await claimed.save();
      }
      throw conflict(
        claimed.status,
        `No se pudo deshacer: ${(err as Error).message}`,
      );
    }

    const undoAction = await this.actionModel.create({
      type: 'undo',
      targetCollection: claimed.targetCollection,
      status: 'confirmed',
      summary: `Deshacer: ${claimed.summary}`,
      request: '',
      targets: undoTargets,
      userId,
      expiresAt: now,
      confirmedAt: now,
      confirmedBy: userId,
      undoOf: String(claimed._id),
    });
    claimed.undoActionId = String(undoAction._id);
    await claimed.save();
    return {
      id: String(claimed._id),
      status: claimed.status,
      undoActionId: claimed.undoActionId,
    };
  }

  // ── helpers ──

  // Rutas que difieren entre dos documentos (sin updatedAt ni __v)
  private changedPaths(a: unknown, b: unknown): string[] {
    const flat = (
      v: unknown,
      prefix = '',
      out: Record<string, string> = {},
    ) => {
      const plain = EJSON.serialize(v, { relaxed: true }) as unknown;
      const walk = (x: unknown, p: string) => {
        if (
          x &&
          typeof x === 'object' &&
          !Array.isArray(x) &&
          !('$date' in x) &&
          !('$oid' in x)
        ) {
          for (const [k, val] of Object.entries(x))
            walk(val, p ? `${p}.${k}` : k);
        } else out[p] = JSON.stringify(x);
      };
      walk(plain, prefix);
      return out;
    };
    const fa = flat(a);
    const fb = flat(b);
    return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
      .filter((k) => !/^(updatedAt|__v)$/.test(k) && fa[k] !== fb[k])
      .slice(0, 10);
  }

  // Compara dos documentos sin importar el orden de las llaves
  private sameDoc(a: unknown, b: unknown) {
    const canon = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(canon)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
            )
          : v;
    const norm = (v: unknown) =>
      JSON.stringify(canon(EJSON.serialize(v, { relaxed: true })));
    return norm(a) === norm(b);
  }

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
      // Dinero en múltiplos de 100 COP: estas ediciones se guardan con
      // colección cruda, fuera de los hooks del schema
      if (col === 'bookings') value = roundMoneyValueCop(field, value);
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
    // Se pide en casi cada tarjeta (crear, editar, historial, duplicados): 30 s
    // de caché evitan escanear apartamentos en cada uno de esos pasos
    const hit = this.namesCache;
    if (hit && Date.now() - hit.at < NovaAiProposals.NAMES_TTL_MS)
      return hit.map;

    const apts = await this.connection
      .db!.collection('apartments')
      .find({}, { projection: { internalName: 1 } })
      .toArray();
    const map = new Map<string, string>(
      apts.map((a) => [String(a._id), a.internalName as string]),
    );
    this.namesCache = { at: Date.now(), map };
    return map;
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

  // Datos de la reserva a crear (o creada) para la tarjeta
  private createDetails(d: Record<string, any>, names: Map<string, string>) {
    return [
      { field: 'group.host.fullName', value: d.group?.host?.fullName },
      {
        field: 'group.host.location.countryName',
        value: d.group?.host?.location?.countryName,
      },
      {
        field: 'group.members',
        value: (d.group?.members ?? []).map((m: any) => m.fullName).join(', '),
      },
      ...(d.apartmentId
        ? [{ field: 'apartmentId', value: names.get(String(d.apartmentId)) }]
        : []),
      { field: 'stay.checkIn', value: d.stay?.checkIn },
      { field: 'stay.checkOut', value: d.stay?.checkOut },
      { field: 'billing.platform', value: d.billing?.platform },
      { field: 'billing.basePrice', value: d.billing?.basePrice },
      { field: 'billing.totalAmount', value: d.billing?.totalAmount },
      { field: 'billing.amountReceived', value: d.billing?.amountReceived },
      { field: 'billing.status', value: d.billing?.status },
      { field: 'observations', value: d.observations },
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
      warnings: action.warnings ?? [],
      expiresAt: action.expiresAt,
      ...(action.type === 'create' && {
        apartmentId: (action.targets[0]?.draft?.apartmentId as string) ?? null,
      }),
      targets: action.targets.map((t) => ({
        id: t.id,
        label: t.label,
        changes: t.changes,
        details:
          action.type === 'delete'
            ? this.details(action.targetCollection, t.before, names)
            : action.type === 'create'
              ? this.createDetails(t.after ?? t.draft ?? {}, names)
              : [],
      })),
    };
  }
}
