import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { QuoteDto } from './dto/quote.dto';
import { CompetitorsService } from './competitors.service';
import { TrackerAnalysisService } from './tracker-analysis.service';
import { TrackerProviderRegistry } from './providers/provider.registry';
import { CompetitorLike, ProviderResult } from './providers/provider.interface';
import { RawCapture, RawCaptureDocument } from './schemas/raw-capture.schema';
import {
  TrackerQuote,
  TrackerQuoteDocument,
} from './schemas/tracker-quote.schema';
import { Booking, BookingDocument } from '../bookings';
import { median, nightsBetween, nightsCount, percentile } from './geo.util';
import { TRACKER_DEFAULTS, TrackerMode } from './tracker.config';

// Proyección de la consulta de ADR histórico (solo estos campos).
interface BookingRefRow {
  stay?: { checkIn?: Date | string; checkOut?: Date | string };
  billing?: { totalAmount?: number };
}

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly competitors: CompetitorsService,
    private readonly analysis: TrackerAnalysisService,
    private readonly registry: TrackerProviderRegistry,
    @InjectModel(RawCapture.name)
    private readonly rawModel: Model<RawCaptureDocument>,
    @InjectModel(TrackerQuote.name)
    private readonly quoteModel: Model<TrackerQuoteDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  private mode(): TrackerMode {
    return this.config.get<string>('TRACKER_MODE') === 'live' ? 'live' : 'demo';
  }

  private input(dto: QuoteDto) {
    const nights = nightsCount(dto.checkIn, dto.checkOut);
    if (nights <= 0) {
      throw new BadRequestException('checkOut debe ser posterior a checkIn');
    }
    if (nights > TRACKER_DEFAULTS.maxNights) {
      throw new BadRequestException(
        `Máximo ${TRACKER_DEFAULTS.maxNights} noches por consulta`,
      );
    }
    return {
      checkIn: dto.checkIn.slice(0, 10),
      checkOut: dto.checkOut.slice(0, 10),
      guests: dto.guests,
      nights,
    };
  }

  async quote(dto: QuoteDto) {
    const started = Date.now();
    const input = this.input(dto);
    const mode = this.mode();

    let competitors: CompetitorLike[];
    if (mode === 'demo') {
      const approved = await this.competitors.findApproved();
      competitors = approved.length
        ? approved
        : this.registry.demoProvider.syntheticCompetitors();
    } else {
      competitors = await this.competitors.findApproved();
      if (!competitors.length) {
        throw new BadRequestException(
          'No hay competidores aprobados. Agrega y aprueba el compset en la pestaña Competidores.',
        );
      }
    }

    let results: ProviderResult[] = [];
    try {
      results = await this.mapLimit(
        competitors,
        TRACKER_DEFAULTS.concurrency,
        (competitor) => this.runOne(mode, input, competitor),
      );
    } finally {
      if (mode === 'live') {
        await this.registry.get('Airbnb').dispose?.();
        await this.registry.get('Booking').dispose?.();
      }
    }

    await this.saveRaw(results);
    await this.touchCompetitors(results);

    const stats = this.buildStats(input, results);
    const ourReference = await this.ourReference();
    const analysis = await this.analysis.analyze({
      input,
      stats,
      results,
      ourReference,
    });

    const saved = await new this.quoteModel({
      input,
      mode,
      stats,
      results: this.stripRaw(results),
      ourReference,
      analysis,
      durationMs: Date.now() - started,
    }).save();

    return {
      id: String(saved._id),
      mode,
      input,
      results: this.stripRaw(results),
      stats,
      ourReference,
      analysis,
      durationMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    };
  }

  // La respuesta y el documento guardado no llevan el crudo: eso va aparte
  // en raw-capture, para no duplicar payloads gigantes en cada cita.
  private stripRaw(results: ProviderResult[]): ProviderResult[] {
    return results.map((result) => {
      const rest = { ...result };
      delete rest.raw;
      return rest;
    });
  }

  async recentQuotes(limit = 10) {
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 50);
    return this.quoteModel
      .find()
      .sort({ createdAt: -1 })
      .limit(safe)
      .select(
        'input mode stats.median stats.competitorCount analysis.summary durationMs createdAt',
      )
      .lean();
  }

  private async runOne(
    mode: TrackerMode,
    input: {
      checkIn: string;
      checkOut: string;
      guests: number;
      nights: number;
    },
    competitor: CompetitorLike,
  ): Promise<ProviderResult> {
    const provider =
      mode === 'demo'
        ? this.registry.demoProvider
        : this.registry.get(competitor.platform);
    try {
      return await provider.quote(input, competitor);
    } catch (err) {
      this.logger.warn(
        `${competitor.platform} ${competitor.name}: ${(err as Error).message}`,
      );
      return {
        competitorId: competitor._id ? String(competitor._id) : undefined,
        competitorName: competitor.name,
        platform: competitor.platform,
        url: competitor.url,
        status: 'error',
        nights: [],
        avgNightly: null,
        available: false,
        error: (err as Error).message,
        source: 'unknown',
      };
    }
  }

  private buildStats(
    input: {
      checkIn: string;
      checkOut: string;
      guests: number;
      nights: number;
    },
    results: ProviderResult[],
  ) {
    const dates = nightsBetween(input.checkIn, input.checkOut);
    const nights = dates.map((date) => {
      const prices: Record<string, number | null> = {};
      const values: number[] = [];
      let availableCount = 0;

      for (const result of results) {
        const key = this.keyOf(result);
        const night = result.nights.find((n) => n.date === date);
        const price = night?.available ? night.price : null;
        prices[key] = price;
        if (night?.available) availableCount++;
        if (price != null && price > 0) values.push(price);
      }

      return {
        date,
        availableCount,
        prices,
        median: median(values),
        p25: percentile(values, 25),
        p75: percentile(values, 75),
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
      };
    });

    const all = nights
      .flatMap((n) => Object.values(n.prices))
      .filter((v): v is number => v != null && v > 0);

    return {
      competitorCount: results.length,
      availableCompetitors: results.filter(
        (r) => r.status === 'ok' && r.available,
      ).length,
      failedCompetitors: results.filter((r) => r.status !== 'ok').length,
      median: median(all),
      p25: percentile(all, 25),
      p75: percentile(all, 75),
      min: all.length ? Math.min(...all) : null,
      max: all.length ? Math.max(...all) : null,
      nights,
    };
  }

  private keyOf(result: ProviderResult): string {
    return result.competitorId ?? result.competitorName;
  }

  // ADR histórico: promedio ponderado por noches de las reservas recientes.
  // Es la referencia contra la que se compara la mediana del mercado.
  private async ourReference() {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const rows = await this.bookingModel
      .find({
        'stay.checkIn': { $gte: since },
        'billing.status': { $ne: 'NO SHOW' },
      })
      .select('stay.checkIn stay.checkOut billing.totalAmount')
      .lean();

    let total = 0;
    let nights = 0;
    for (const row of rows as BookingRefRow[]) {
      const start = new Date(row.stay?.checkIn ?? 0).getTime();
      const end = new Date(row.stay?.checkOut ?? 0).getTime();
      const n = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
      const amount = Number(row.billing?.totalAmount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      total += amount;
      nights += n;
    }

    return {
      avgNightly: nights ? Math.round(total / nights) : null,
      sampleSize: rows.length,
      source: 'Histórico 180 días',
    };
  }

  private async saveRaw(results: ProviderResult[]) {
    const docs = results
      .filter((r) => r.raw && !r.synthetic)
      .map((r) => {
        const serialized = JSON.stringify(r.raw);
        return {
          competitorId: r.competitorId,
          competitorName: r.competitorName,
          platform: r.platform,
          url: r.url,
          source: r.source,
          status: r.status,
          payload: r.raw,
          payloadHash: createHash('sha1').update(serialized).digest('hex'),
          error: r.error ?? '',
        };
      });
    if (!docs.length) return;
    try {
      await this.rawModel.insertMany(docs);
    } catch (err) {
      this.logger.warn(
        `No se pudo guardar el crudo: ${(err as Error).message}`,
      );
    }
  }

  private async touchCompetitors(results: ProviderResult[]) {
    const ids = results
      .map((r) => r.competitorId)
      .filter((id): id is string => !!id);
    if (!ids.length) return;
    try {
      await this.competitors.touch(ids);
    } catch {
      // no es crítico para la consulta
    }
  }

  private async mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (true) {
          const index = next++;
          if (index >= items.length) return;
          out[index] = await fn(items[index]);
        }
      },
    );
    await Promise.all(workers);
    return out;
  }
}
