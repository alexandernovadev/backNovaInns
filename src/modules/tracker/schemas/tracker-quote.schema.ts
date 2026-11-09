import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type TrackerQuoteDocument = HydratedDocument<TrackerQuote>;

// Cada consulta on-demand (fechas + personas) queda guardada con su análisis,
// para poder comparar después o re-analizar sin scrapear de nuevo.
@Schema({ timestamps: true })
export class TrackerQuote {
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  input!: {
    checkIn: string;
    checkOut: string;
    guests: number;
    nights: number;
  };

  @Prop({ default: 'demo' })
  mode!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  stats?: any;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  results!: any[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  ourReference?: any;

  @Prop({ type: MongooseSchema.Types.Mixed })
  analysis?: any;

  @Prop({ default: 0 })
  durationMs!: number;
}

export const TrackerQuoteSchema = SchemaFactory.createForClass(TrackerQuote);

TrackerQuoteSchema.index({ createdAt: -1 });
