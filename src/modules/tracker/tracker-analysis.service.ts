import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { ProviderResult } from './providers/provider.interface';
import { OurReference, TrackerStats } from './tracker.types';

export interface TrackerAnalysis {
  summary: string;
  findings: string[];
  recommendations: {
    action: string;
    reason: string;
    confidence: 'alta' | 'media' | 'baja';
  }[];
  ai: boolean;
  model?: string;
}

interface AnalysisPayload {
  input: {
    checkIn: string;
    checkOut: string;
    guests: number;
    nights: number;
  };
  stats: TrackerStats;
  results: ProviderResult[];
  ourReference: OurReference;
}

const money = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(value);

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
        required: ['action', 'reason', 'confidence'],
      },
    },
  },
  required: ['summary', 'findings', 'recommendations'],
};

const ANALYSIS_PROMPT = `Eres analista de revenue management de Nova Inns, apartamentos de alquiler corto en Zipaquirá, Colombia.

Recibes una tabla con los precios por noche de la competencia para unas fechas concretas y el ADR histórico de Nova Inns. Tu trabajo:
- Leer el mercado: mediana, dispersión, disponibilidad.
- Decir si Nova Inns está caro, barato o en línea.
- Dar recomendaciones concretas y accionables (subir, bajar, mantener, esperar).
- Usa SOLO los números de la tabla. No inventes competidores ni precios.
- Responde en español, claro y breve. Montos en pesos colombianos.
- Si faltan datos, dilo en findings.`;

@Injectable()
export class TrackerAnalysisService {
  private readonly logger = new Logger(TrackerAnalysisService.name);
  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  private gemini(): GoogleGenAI | null {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) return null;
    this.client ??= new GoogleGenAI({ apiKey });
    return this.client;
  }

  async analyze(payload: AnalysisPayload): Promise<TrackerAnalysis> {
    const deterministic = this.deterministic(payload);

    if (this.config.get<string>('TRACKER_AI') === 'false') return deterministic;

    const client = this.gemini();
    if (!client) return deterministic;

    const model =
      this.config.get<string>('GEMINI_CHAT_MODEL') ??
      this.config.get<string>('GEMINI_MODEL') ??
      'gemini-3.5-flash-lite';

    try {
      const interaction = await client.interactions.create({
        model,
        system_instruction: ANALYSIS_PROMPT,
        input: [{ type: 'text', text: this.table(payload) }],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: ANALYSIS_SCHEMA,
        },
        generation_config: { thinking_level: 'minimal' },
        store: false,
      });

      const raw = 'output_text' in interaction ? interaction.output_text : '';
      const parsed = JSON.parse(raw ?? '') as TrackerAnalysis;
      if (!parsed?.summary || !Array.isArray(parsed.recommendations)) {
        return deterministic;
      }

      // Los avisos de scraping incompleto no se negocian con la IA.
      const findings = [
        ...deterministic.findings.filter((f) => f.startsWith('⚠️')),
        ...(parsed.findings ?? []),
      ];

      return {
        summary: parsed.summary,
        findings,
        recommendations: parsed.recommendations.map((r) => ({
          action: String(r.action ?? ''),
          reason: String(r.reason ?? ''),
          confidence: (['alta', 'media', 'baja'] as const).includes(
            r.confidence,
          )
            ? r.confidence
            : 'media',
        })),
        ai: true,
        model,
      };
    } catch (err) {
      this.logger.warn(`Análisis con Gemini falló: ${(err as Error).message}`);
      return deterministic;
    }
  }

  private deterministic(payload: AnalysisPayload): TrackerAnalysis {
    const { input, stats, results, ourReference } = payload;
    const median = stats.median;
    const our = ourReference.avgNightly;
    const gap =
      median && our != null
        ? Math.round(((our - median) / median) * 100)
        : null;

    const okResults = results.filter((r) => r.status === 'ok');
    const available = okResults.filter((r) => r.available);
    const failed = results.filter((r) => r.status !== 'ok');
    const withPrice = okResults
      .filter((r) => r.avgNightly != null)
      .sort((a, b) => (a.avgNightly as number) - (b.avgNightly as number));

    const findings: string[] = [];
    if (median != null) {
      findings.push(
        `Mediana del compset: ${money(median)}/noche (p25 ${money(stats.p25)} · p75 ${money(stats.p75)}) para ${input.nights} noche(s).`,
      );
    }
    findings.push(
      `Disponibilidad: ${available.length} de ${results.length} competidores tienen libres las fechas consultadas.`,
    );
    if (withPrice.length) {
      const cheapest = withPrice[0];
      const priciest = withPrice[withPrice.length - 1];
      findings.push(
        `Más barato: ${cheapest.competitorName} a ${money(cheapest.avgNightly)}/noche. Más caro: ${priciest.competitorName} a ${money(priciest.avgNightly)}/noche.`,
      );
    }
    if (our != null) {
      findings.push(
        `Tu referencia: ${money(our)}/noche (${ourReference.source}, ${ourReference.sampleSize} reserva(s)).`,
      );
    } else {
      findings.push(
        'Aún no hay historial de reservas suficiente para calcular tu ADR de referencia.',
      );
    }
    if (failed.length) {
      findings.push(
        `⚠️ ${failed.length} competidor(es) no se pudieron consultar (bloqueo o error); la mediana puede estar incompleta.`,
      );
    }

    const recommendations: TrackerAnalysis['recommendations'] = [];
    if (gap != null) {
      if (gap > 10) {
        recommendations.push({
          action: `Bajar tu tarifa hacia ~${money(median)}/noche para estas fechas.`,
          reason: `Estás ${gap}% por encima de la mediana del mercado (${money(median)}).`,
          confidence: 'media',
        });
      } else if (gap < -10) {
        recommendations.push({
          action: `Tienes margen para subir: el mercado está en ~${money(median)}/noche.`,
          reason: `Estás ${Math.abs(gap)}% por debajo de la mediana; hay espacio sin salir del rango competitivo.`,
          confidence: 'media',
        });
      } else {
        recommendations.push({
          action: 'Mantener la tarifa actual para estas fechas.',
          reason: `Estás dentro de ±10% de la mediana (${money(median)}/noche).`,
          confidence: 'alta',
        });
      }
    } else {
      recommendations.push({
        action: 'Definir una tarifa base antes de comparar.',
        reason:
          'Sin ADR histórico no se puede medir la brecha contra el mercado; registra reservas o define tu precio para estas fechas.',
        confidence: 'baja',
      });
    }

    if (results.length > 0 && available.length / results.length < 0.4) {
      recommendations.push({
        action:
          'Sostener o subir la tarifa: hay poca disponibilidad en el compset.',
        reason: `Solo ${available.length} de ${results.length} competidores tienen libres esas noches; la demanda puede estar alta.`,
        confidence: 'media',
      });
    }

    const summary =
      median != null
        ? `Para ${input.nights} noche(s) desde el ${input.checkIn}, la competencia está en ${money(median)}/noche (rango ${money(stats.min)}–${money(stats.max)}).` +
          (gap != null
            ? gap > 10
              ? ` Nova Inns está ${gap}% por encima de la mediana.`
              : gap < -10
                ? ` Nova Inns está ${Math.abs(gap)}% por debajo: hay margen para subir.`
                : ' Nova Inns está en línea con el mercado.'
            : '')
        : `No se obtuvieron precios suficientes para ${input.nights} noche(s) desde el ${input.checkIn}.`;

    return { summary, findings, recommendations, ai: false };
  }

  private table(payload: AnalysisPayload): string {
    const { input, stats, results, ourReference } = payload;
    const competitors = results.slice(0, 12);
    const header = [
      'fecha',
      ...competitors.map((c) => c.competitorName),
      'mediana',
    ].join(' | ');
    const rows = stats.nights.slice(0, 31).map((night) => {
      const cells = competitors.map((c) => {
        const key = c.competitorId ?? c.competitorName;
        const value = night.prices?.[key];
        return value == null ? '—' : String(value);
      });
      return [
        night.date,
        ...cells,
        night.median == null ? '—' : String(night.median),
      ].join(' | ');
    });

    return [
      `Consulta: ${input.checkIn} → ${input.checkOut} (${input.nights} noches, ${input.guests} huéspedes)`,
      `ADR histórico Nova Inns: ${ourReference.avgNightly ?? 'sin dato'} (${ourReference.source}, ${ourReference.sampleSize} reservas)`,
      '',
      header,
      ...rows,
    ].join('\n');
  }

  async chat(input: {
    message: string;
    history?: { role: 'user' | 'assistant'; text: string }[];
    context?: Record<string, unknown>;
  }): Promise<{ reply: string; model: string }> {
    const client = this.gemini();
    if (!client) {
      return {
        reply:
          'No hay GEMINI_API_KEY configurada en el backend para responder.',
        model: 'none',
      };
    }

    const model =
      this.config.get<string>('GEMINI_CHAT_MODEL') ??
      this.config.get<string>('GEMINI_MODEL') ??
      'gemini-3.5-flash-lite';

    const systemPrompt = `Eres el analista de tarifas y competencia de Nova Inns (apartamentos turísticos en Zipaquirá, Colombia).
El usuario está viendo en pantalla la tabla de precios de Booking para Zipaquirá y tiene un historial de consultas guardado en su navegador (localStorage).

Recibes un bloque JSON de CONTEXTO con:
- "current": la consulta actual (fechas checkIn/checkOut, adultos, niños, totalResults y la lista completa de alojamientos con price, taxes, taxesIncluded, total, distance y room).
- "diff": comparación automática contra la consulta anterior para las mismas fechas/huéspedes (bookedOut = alojamientos que estaban antes y ya NO aparecen porque se reservaron o agotaron; newOnes = nuevos disponibles; priceChanges = subidas o bajadas de precio).
- "previousSameSearch": la captura anterior de esas mismas fechas (si existe).
- "recentSnapshots": resumen de otras consultas guardadas en localStorage.

Reglas:
- Responde en español, directo, claro y conciso. Usa viñetas o negritas cuando ayude a escanear.
- Formatea montos en pesos colombianos (ej. $280.000).
- Usa SOLO los datos del contexto; no inventes alojamientos ni precios.
- Cuando pregunten cuáles se reservaron/agotaron o qué cambió, apóyate en "diff.bookedOut", "diff.priceChanges" y "diff.newOnes".`;

    const historyText = (input.history ?? [])
      .slice(-10)
      .map((h) => `${h.role === 'user' ? 'Usuario' : 'Asistente'}: ${h.text}`)
      .join('\n');

    const promptText = [
      '=== CONTEXTO (JSON de Booking + historial localStorage) ===',
      JSON.stringify(input.context ?? {}, null, 2),
      historyText ? `\n=== CONVERSACIÓN PREVIA ===\n${historyText}` : '',
      `\n=== PREGUNTA ACTUAL ===\n${input.message}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const interaction = await client.interactions.create({
        model,
        system_instruction: systemPrompt,
        input: [{ type: 'text', text: promptText }],
        generation_config: { thinking_level: 'minimal' },
        store: false,
      });
      const reply =
        ('output_text' in interaction && interaction.output_text?.trim()) ||
        'No pude generar respuesta con el contexto actual.';
      return { reply, model };
    } catch (err) {
      this.logger.warn(`Chat Tracker falló: ${(err as Error).message}`);
      return {
        reply: `Error consultando a Gemini: ${(err as Error).message}`,
        model,
      };
    }
  }
}
