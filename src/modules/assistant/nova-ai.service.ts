import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { novaAiPrompt } from './nova-ai.prompt';
import { NOVA_AI_TOOLS, NovaAiTools } from './nova-ai.tools';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const MAX_MESSAGES = 40;
const MAX_TEXT = 4000;
// Rondas de consultas por pregunta, para que no se quede en un bucle
const MAX_ROUNDS = 10;

type Interaction = Awaited<ReturnType<GoogleGenAI['interactions']['create']>>;
type InputStep = Exclude<
  Parameters<GoogleGenAI['interactions']['create']>[0]['input'],
  string | undefined
>;

@Injectable()
export class NovaAiService {
  private readonly logger = new Logger(NovaAiService.name);
  private client: GoogleGenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: NovaAiTools,
  ) {}

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
    const today = new Date().toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // El historial + lo que el modelo va pidiendo y lo que le devolvemos
    let input = messages.map((m) => ({
      type: m.role === 'user' ? 'user_input' : 'model_output',
      content: [{ type: 'text', text: m.text }],
    })) as unknown[];
    const queries: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const interaction = await this.create({
        model,
        system_instruction: novaAiPrompt(today),
        input: input as InputStep,
        tools: NOVA_AI_TOOLS,
        generation_config: { thinking_level: 'minimal' },
        // Datos del negocio: que Google no guarde la conversación
        store: false,
      });
      const steps = ('steps' in interaction ? interaction.steps : []) ?? [];
      const calls = steps.filter((s) => s.type === 'function_call');

      if (!calls.length) {
        const reply =
          'output_text' in interaction ? interaction.output_text : '';
        if (!reply?.trim())
          throw new BadGatewayException('NovaAI respondió vacío');
        return { reply: reply.trim(), model, queries };
      }

      const results = await Promise.all(
        calls.map(async (call) => {
          const run = await this.tools.run(call.name, call.arguments ?? {});
          queries.push(run.summary);
          return {
            type: 'function_result',
            call_id: call.id,
            name: call.name,
            result: run.result,
            is_error: !run.ok,
          };
        }),
      );
      // Se devuelven los pasos del modelo tal cual (incluye su razonamiento) + los resultados
      input = [...input, ...steps, ...results];
    }

    return {
      reply:
        'Me enredé con esa pregunta y no llegué a una respuesta. ¿La puedes hacer más concreta?',
      model,
      queries,
    };
  }

  private async create(
    params: Parameters<GoogleGenAI['interactions']['create']>[0],
  ): Promise<Interaction> {
    try {
      return await this.gemini().interactions.create(params);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Gemini falló: ${(err as Error).message}`);
      throw new BadGatewayException('NovaAI no pudo responder');
    }
  }
}
