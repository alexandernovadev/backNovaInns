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
}

// Historial de cambios propuestos por NovaAI (y, desde el paso 4, ejecutados)
@Schema({ timestamps: true, collection: 'assistant_actions' })
export class AssistantAction {
  @Prop({ required: true, enum: ['update', 'delete'] })
  type!: 'update' | 'delete';

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
}

export const AssistantActionSchema =
  SchemaFactory.createForClass(AssistantAction);
