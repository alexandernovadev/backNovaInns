import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  BOOKING_EXTRACTION_PROMPT,
  BOOKING_EXTRACTION_SCHEMA,
} from './booking-extraction.prompt';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  private gemini(): GoogleGenAI {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException('GEMINI_API_KEY no configurada');
    this.client ??= new GoogleGenAI({ apiKey });
    return this.client;
  }

  // Screenshot de Booking / AirBnB → JSON con la forma de POST /bookings (sin apartmentId)
  async extractBooking(file: Express.Multer.File, hint?: string) {
    const model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.8-flash';
    const text = hint?.trim()
      ? `Lee esta reserva. Nota del usuario: ${hint.trim()}`
      : 'Lee esta reserva.';

    let interaction: Awaited<ReturnType<GoogleGenAI['interactions']['create']>>;
    try {
      interaction = await this.gemini().interactions.create({
        model,
        system_instruction: BOOKING_EXTRACTION_PROMPT,
        input: [
          { type: 'text', text },
          {
            type: 'image',
            data: file.buffer.toString('base64'),
            mime_type: file.mimetype as 'image/png',
          },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: BOOKING_EXTRACTION_SCHEMA,
        },
        // Extracción simple: con más razonamiento tardaba ~2 min sin ganar precisión
        generation_config: { thinking_level: 'low' },
        // Datos de huéspedes: que Google no guarde la conversación
        store: false,
      });
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Gemini falló: ${(err as Error).message}`);
      throw new BadGatewayException('No se pudo leer la imagen con Gemini');
    }

    const raw = 'output_text' in interaction ? interaction.output_text : '';
    let booking: Record<string, unknown>;
    try {
      booking = JSON.parse(raw ?? '') as Record<string, unknown>;
    } catch {
      this.logger.error(
        `Respuesta de Gemini no es JSON: ${raw?.slice(0, 200)}`,
      );
      throw new BadGatewayException('Gemini no devolvió un JSON válido');
    }

    // Las observaciones van con saltos de línea reales; a veces el modelo
    // escribe el texto "\n" escapado en vez del salto
    if (typeof booking.observations === 'string')
      booking.observations = booking.observations.replace(/\\n/g, '\n');

    return {
      booking,
      model,
      usage: 'usage' in interaction ? interaction.usage : undefined,
    };
  }
}
