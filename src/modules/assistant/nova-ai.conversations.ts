import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import {
  AssistantConversation,
  AssistantConversationDocument,
  CONVERSATION_TTL_DAYS,
  ConversationMessage,
} from './schemas/assistant-conversation.schema';
import { ActionCard, NovaAiProposals } from './nova-ai.proposals';
import type { ChatMessage } from './nova-ai.service';

const { ObjectId } = mongo.BSON;

// Lo que se le manda a Gemini por turno (igual que antes, cuando venía del front)
const MAX_HISTORY = 40;
const MAX_TEXT = 4000;
const MAX_TITLE = 60;
const MAX_LIST = 100;
const TTL_MS = CONVERSATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: Date;
}

@Injectable()
export class NovaAiConversations {
  constructor(
    @InjectModel(AssistantConversation.name)
    private readonly model: Model<AssistantConversationDocument>,
    private readonly proposals: NovaAiProposals,
  ) {}

  // Texto nuevo del usuario (lo único que manda el front por turno)
  validateText(text: unknown): string {
    if (typeof text !== 'string' || !text.trim())
      throw new BadRequestException('text es requerido');
    if (text.length > MAX_TEXT)
      throw new BadRequestException(`Máximo ${MAX_TEXT} caracteres`);
    return text.trim();
  }

  // Historial para Gemini: el guardado + el mensaje nuevo, los últimos 40,
  // empezando por un mensaje del usuario
  async history(
    id: string | undefined,
    userId: string,
    text: string,
  ): Promise<ChatMessage[]> {
    const saved = id ? (await this.find(id, userId)).messages : [];
    let msgs: ChatMessage[] = [
      ...saved.map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT) })),
      { role: 'user', text },
    ].slice(-MAX_HISTORY) as ChatMessage[];
    while (msgs.length > 1 && msgs[0].role !== 'user') msgs = msgs.slice(1);
    return msgs;
  }

  // Guarda la pregunta y la respuesta (solo si NovaAI respondió). Sin id crea
  // la conversación con el primer mensaje como título
  async append(
    id: string | undefined,
    userId: string,
    user: string,
    reply: { reply: string; queries: string[]; actions: ActionCard[] },
  ): Promise<string> {
    const now = new Date();
    const messages: ConversationMessage[] = [
      { role: 'user', text: user, createdAt: now },
      {
        role: 'model',
        text: reply.reply,
        queries: reply.queries,
        actionIds: reply.actions.map((a) => a.id),
        createdAt: now,
      },
    ];
    const expiresAt = new Date(now.getTime() + TTL_MS);
    if (id) {
      const r = await this.model.updateOne(
        { _id: this.oid(id), userId },
        { $push: { messages: { $each: messages } }, $set: { expiresAt } },
      );
      if (!r.matchedCount)
        throw new NotFoundException('Conversación no encontrada');
      return id;
    }
    const created = await this.model.create({
      userId,
      title: this.title(user),
      messages,
      expiresAt,
    });
    return String(created._id);
  }

  async list(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.model.aggregate<{
      _id: unknown;
      title: string;
      messageCount: number;
      updatedAt: Date;
    }>([
      { $match: { userId } },
      { $sort: { updatedAt: -1 } },
      { $limit: MAX_LIST },
      {
        $project: {
          title: 1,
          updatedAt: 1,
          messageCount: { $size: '$messages' },
        },
      },
    ]);
    return rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      messageCount: r.messageCount,
      updatedAt: r.updatedAt,
    }));
  }

  // Conversación completa; cada tarjeta con el estado actual de su propuesta
  async get(id: string, userId: string) {
    const conv = await this.find(id, userId);
    const ids = conv.messages.flatMap((m) => m.actionIds ?? []);
    const cards = await this.proposals.cards(ids);
    return {
      id: String(conv._id),
      title: conv.title,
      updatedAt: (conv as unknown as { updatedAt: Date }).updatedAt,
      messages: conv.messages.map((m) => ({
        role: m.role,
        text: m.text,
        queries: m.queries ?? [],
        actions: (m.actionIds ?? [])
          .map((a) => cards.get(a))
          .filter((c): c is ActionCard => !!c),
      })),
    };
  }

  async rename(id: string, userId: string, title: unknown) {
    const t = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE) : '';
    if (!t) throw new BadRequestException('title es requerido');
    const r = await this.model.updateOne(
      { _id: this.oid(id), userId },
      { $set: { title: t } },
      { timestamps: false },
    );
    if (!r.matchedCount)
      throw new NotFoundException('Conversación no encontrada');
    return { id, title: t };
  }

  async remove(id: string, userId: string) {
    const r = await this.model.deleteOne({ _id: this.oid(id), userId });
    if (!r.deletedCount)
      throw new NotFoundException('Conversación no encontrada');
    return { id, deleted: true };
  }

  private async find(id: string, userId: string) {
    const conv = await this.model.findOne({ _id: this.oid(id), userId }).lean();
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  private oid(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Conversación no encontrada');
    return new ObjectId(id);
  }

  private title(text: string) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
  }
}
