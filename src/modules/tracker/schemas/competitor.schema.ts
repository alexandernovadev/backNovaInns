import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CompetitorDocument = HydratedDocument<Competitor>;

export const COMPETITOR_PLATFORMS = ['Airbnb', 'Booking'] as const;
export type CompetitorPlatform = (typeof COMPETITOR_PLATFORMS)[number];

export const COMPETITOR_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

@Schema({ timestamps: true })
export class Competitor {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, enum: COMPETITOR_PLATFORMS })
  platform!: CompetitorPlatform;

  @Prop({ required: true, trim: true })
  url!: string;

  @Prop({ default: '' })
  externalId!: string;

  @Prop({ type: Number })
  lat?: number;

  @Prop({ type: Number })
  lng?: number;

  @Prop({ default: 0 })
  bedrooms!: number;

  @Prop({ default: 2 })
  guests!: number;

  @Prop({ enum: COMPETITOR_STATUSES, default: 'approved' })
  status!: CompetitorStatus;

  @Prop({ default: 'manual' })
  source!: string;

  @Prop({ default: '' })
  notes!: string;

  @Prop({ default: '' })
  rejectReason!: string;

  // Distancia al centro de Zipaquirá (km), calculada al guardar.
  @Prop({ type: Number })
  distanceKm?: number;

  @Prop({ type: Date })
  lastQuoteAt?: Date;
}

export const CompetitorSchema = SchemaFactory.createForClass(Competitor);

CompetitorSchema.index({ status: 1, platform: 1 });
CompetitorSchema.index({ externalId: 1, platform: 1 });
