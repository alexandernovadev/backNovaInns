import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Competitor,
  CompetitorDocument,
  CompetitorPlatform,
} from './schemas/competitor.schema';
import { CreateCompetitorDto, UpdateCompetitorDto } from './dto/competitor.dto';
import { haversineKm } from './geo.util';
import { TRACKER_DEFAULTS, ZIPAQUIRA } from './tracker.config';

function extractExternalId(url: string, platform: CompetitorPlatform): string {
  if (platform === 'Airbnb') return /\/rooms\/(\d+)/.exec(url)?.[1] ?? '';
  return /\/hotel\/[^/]+\/([^/?#.]+)/.exec(url)?.[1] ?? '';
}

@Injectable()
export class CompetitorsService {
  constructor(
    @InjectModel(Competitor.name)
    private readonly model: Model<CompetitorDocument>,
    private readonly config: ConfigService,
  ) {}

  private center() {
    return {
      name: ZIPAQUIRA.name,
      lat: Number(this.config.get('TRACKER_CENTER_LAT') ?? ZIPAQUIRA.lat),
      lng: Number(this.config.get('TRACKER_CENTER_LNG') ?? ZIPAQUIRA.lng),
      radiusKm: Number(
        this.config.get('TRACKER_RADIUS_KM') ?? TRACKER_DEFAULTS.radiusKm,
      ),
    };
  }

  // Calcula la distancia al centro y decide si está dentro del mercado.
  // Es la geocerca que descarta los "cerca de Zipaquirá" de otros municipios.
  private locate(lat?: number, lng?: number) {
    const center = this.center();
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { distanceKm: undefined, inMarket: true };
    }
    const distanceKm = haversineKm(center.lat, center.lng, lat, lng);
    return { distanceKm, inMarket: distanceKm <= center.radiusKm };
  }

  findAll() {
    return this.model.find().sort({ status: 1, platform: 1, name: 1 }).lean();
  }

  findApproved() {
    return this.model.find({ status: 'approved' }).lean();
  }

  async create(dto: CreateCompetitorDto) {
    const { distanceKm, inMarket } = this.locate(dto.lat, dto.lng);
    const center = this.center();
    return new this.model({
      ...dto,
      externalId: dto.externalId ?? extractExternalId(dto.url, dto.platform),
      distanceKm,
      status: inMarket ? (dto.status ?? 'approved') : 'rejected',
      rejectReason: inMarket
        ? ''
        : `Fuera del área de ${center.name} (${distanceKm?.toFixed(1)} km del centro)`,
    }).save();
  }

  async update(id: string, dto: UpdateCompetitorDto) {
    const current = await this.model.findById(id);
    if (!current) throw new NotFoundException('Competidor no encontrado');

    const lat = dto.lat ?? current.lat;
    const lng = dto.lng ?? current.lng;
    const { distanceKm, inMarket } = this.locate(lat, lng);
    const center = this.center();

    const status = inMarket ? (dto.status ?? current.status) : 'rejected';
    const updated = await this.model.findByIdAndUpdate(
      id,
      {
        ...dto,
        externalId:
          dto.externalId ??
          (dto.url || dto.platform
            ? extractExternalId(
                dto.url ?? current.url,
                dto.platform ?? current.platform,
              )
            : current.externalId),
        distanceKm,
        status,
        rejectReason: inMarket
          ? ''
          : `Fuera del área de ${center.name} (${distanceKm?.toFixed(1)} km del centro)`,
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new NotFoundException('Competidor no encontrado');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.model.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Competidor no encontrado');
  }

  // Marca la última vez que se consultó cada competidor.
  async touch(ids: string[]) {
    await this.model.updateMany(
      { _id: { $in: ids } },
      { $set: { lastQuoteAt: new Date() } },
    );
  }

  settings() {
    const center = this.center();
    return {
      mode:
        this.config.get<string>('TRACKER_MODE') === 'live' ? 'live' : 'demo',
      center,
      aiEnabled: !!this.config.get<string>('GEMINI_API_KEY'),
    };
  }
}
