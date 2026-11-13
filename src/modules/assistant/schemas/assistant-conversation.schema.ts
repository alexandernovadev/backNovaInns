import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AssistantConversationDocument =
  HydratedDocument<AssistantConversation>;

// Días sin actividad tras los que Mongo borra la conversación sola (índice TTL)
export const CONVERSATION_TTL_DAYS = 90;

export interface ConversationMessage {
  role: 'user' | 'model';
  text: string;
  // Consultas que hizo NovaAI para responder (solo para mostrar)
  queries?: string[];
  // Propuestas (assistant_actions): la tarjeta se arma con su estado actual al abrir
  actionIds?: string[];
  createdAt: Date;
}

// Conversaciones de NovaAI. Solo texto: los screenshots nunca se guardan
@Schema({ timestamps: true, collection: 'assistant_conversations' })
export class AssistantConversation {
  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ default: '' })
  title!: string;

  @Prop({ type: [Object], default: [] })
  messages!: ConversationMessage[];

  // Se corre en cada mensaje: 90 días desde la última actividad
  @Prop({ required: true })
  expiresAt!: Date;
}

export const AssistantConversationSchema = SchemaFactory.createForClass(
  AssistantConversation,
);

AssistantConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AssistantConversationSchema.index({ userId: 1, updatedAt: -1 });
