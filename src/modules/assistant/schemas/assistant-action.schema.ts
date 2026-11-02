import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AssistantActionDocument = HydratedDocument<AssistantAction>;

export interface ActionChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ActionTarget {
  id: string;
  label: string;
  // Documento completo antes del cambio: sirve para mostrarlo y para deshacer
  before: Record<string, unknown>;
  changes: ActionChange[];
  // Documento después de confirmar (null si se eliminó): el deshacer compara contra esto
  after?: Record<string, unknown> | null;
  // create: datos de la reserva a crear (sin apartmentId: se elige al confirmar)
  draft?: Record<string, unknown>;
}

// Historial de cambios propuestos por NovaAI (y, desde el paso 4, ejecutados)
@Schema({ timestamps: true, collection: 'assistant_actions' })
export class AssistantAction {
  // create: reserva desde un screenshot; undo: registro de un deshacer (apunta al cambio original con undoOf)
  @Prop({ required: true, enum: ['create', 'update', 'delete', 'undo'] })
  type!: 'create' | 'update' | 'delete' | 'undo';

  @Prop({ required: true, enum: ['bookings', 'apartments', 'expenses'] })
  targetCollection!: 'bookings' | 'apartments' | 'expenses';

  @Prop({
    required: true,
    enum: ['pending', 'cancelled', 'expired', 'confirmed', 'failed', 'undone'],
    default: 'pending',
  })
  status!: string;

  // Lo que la IA dice que hace, y lo que pidió el usuario
  @Prop({ default: '' })
  summary!: string;

  @Prop({ default: '' })
  request!: string;

  @Prop({ type: [Object], default: [] })
  targets!: ActionTarget[];

  // Avisos para la tarjeta (ej: posible reserva duplicada)
  @Prop({ type: [String], default: [] })
  warnings!: string[];

  @Prop({ type: String, default: null })
  userId!: string | null;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

  @Prop({ type: String, default: null })
  confirmedBy!: string | null;

  // Por qué falló (documento cambiado, vencida, error de Mongo...)
  @Prop({ type: String, default: null })
  error!: string | null;

  // Deshacer: en el cambio original, cuándo/quién y con qué registro;
  // en el registro del deshacer, a qué cambio deshizo
  @Prop({ type: Date, default: null })
  undoneAt!: Date | null;

  @Prop({ type: String, default: null })
  undoneBy!: string | null;

  @Prop({ type: String, default: null })
  undoActionId!: string | null;

  @Prop({ type: String, default: null })
  undoOf!: string | null;
}

export const AssistantActionSchema =
  SchemaFactory.createForClass(AssistantAction);
