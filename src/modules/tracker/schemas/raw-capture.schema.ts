import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RawCaptureDocument = HydratedDocument<RawCapture>;

export const RAW_CAPTURE_STATUSES = ['ok', 'blocked', 'error'] as const;
export type RawCaptureStatus = (typeof RAW_CAPTURE_STATUSES)[number];

// Guarda la respuesta cruda tal como la devolvió la plataforma (o el demo).
// Es la fuente de verdad: el normalizado y el análisis se pueden reconstruir
// a partir de aquí sin volver a scrapear.
@Schema({ timestamps: true })
export class RawCapture {
  @Prop({ type: Types.ObjectId, ref: 'Competitor' })
  competitorId?: Types.ObjectId;

  @Prop({ default: '' })
  competitorName!: string;

  @Prop({ default: '' })
  platform!: string;

  @Prop({ default: '' })
  url!: string;

  @Prop({ default: '' })
  source!: string;

  @Prop({ enum: RAW_CAPTURE_STATUSES, default: 'ok' })
  status!: RawCaptureStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  payload?: any;

  @Prop({ default: '' })
  payloadHash!: string;

  @Prop({ default: '' })
  error!: string;
}

export const RawCaptureSchema = SchemaFactory.createForClass(RawCapture);

RawCaptureSchema.index({ competitorId: 1, createdAt: -1 });
RawCaptureSchema.index({ platform: 1, createdAt: -1 });
