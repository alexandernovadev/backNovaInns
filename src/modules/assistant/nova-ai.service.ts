import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { NOVA_AI_PROMPT } from './nova-ai.prompt';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const MAX_MESSAGES = 40;
const MAX_TEXT = 4000;

@Injectable()
export class NovaAiService {
  private readonly logger = new Logger(NovaAiService.name);
  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  private gemini(): GoogleGenAI {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException('GEMINI_API_KEY no configurada');
    this.client ??= new GoogleGenAI({ apiKey });
    return this.client;
  }

  // El historial vive en el front; se manda completo en cada turno
  private validate(messages: unknown): ChatMessage[] {
    if (!Array.isArray(messages) || messages.length === 0)
      throw new BadRequestException('messages debe ser un array no vacío');
    if (messages.length > MAX_MESSAGES)
      throw new BadRequestException(`Máximo ${MAX_MESSAGES} mensajes`);
    const valid = messages.every(
      (m: Partial<ChatMessage>) =>
        (m?.role === 'user' || m?.role === 'model') &&
        typeof m.text === 'string' &&
        m.text.trim().length > 0 &&
        m.text.length <= MAX_TEXT,
    );
    if (!valid)
      throw new BadRequestException(
        `Cada mensaje necesita role (user|model) y text (1-${MAX_TEXT} caracteres)`,
      );
    if ((messages as ChatMessage[]).at(-1)!.role !== 'user')
      throw new BadRequestException('El último mensaje debe ser del usuario');
    return messages as ChatMessage[];
  }

  async chat(rawMessages: unknown) {
    const messages = this.validate(rawMessages);
    const model =
      this.config.get<string>('GEMINI_CHAT_MODEL') ?? 'gemini-3.5-flash-lite';

    let interaction: Awaited<ReturnType<GoogleGenAI['interactions']['create']>>;
    try {
      interaction = await this.gemini().interactions.create({
        model,
        system_instruction: NOVA_AI_PROMPT,
        input: messages.map((m) => ({
          type: m.role === 'user' ? 'user_input' : 'model_output',
          content: [{ type: 'text', text: m.text }],
        })),
        generation_config: { thinking_level: 'minimal' },
        // Datos del negocio: que Google no guarde la conversación
        store: false,
      });
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Gemini falló: ${(err as Error).message}`);
      throw new BadGatewayException('NovaAI no pudo responder');
    }

    const reply = 'output_text' in interaction ? interaction.output_text : '';
    if (!reply?.trim()) throw new BadGatewayException('NovaAI respondió vacío');
    return { reply: reply.trim(), model };
  }
}
