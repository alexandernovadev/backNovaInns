import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

const IdentificationSourceSchema = {
  url: { type: String, required: true },
  type: { type: String, enum: ['FRONT', 'BACK', 'SELFIE'], required: true },
  uploadedAt: { type: Date, default: Date.now },
};

const GuestSchema = {
  fullName: { type: String, required: true },
  identifications: { type: [IdentificationSourceSchema], default: [] },
};

const ExtraServiceSchema = {
  type: { type: String, enum: ['CAR', 'MOTORCYCLE', 'OTHER'], required: true },
  description: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  price: { type: Number, required: true },
};

@Schema({ timestamps: true })
export class Booking {
  @Prop({ type: Types.ObjectId, ref: 'Apartment', required: true })
  apartmentId!: Types.ObjectId;

  @Prop({
    type: {
      host: { type: GuestSchema, required: true },
      members: { type: [GuestSchema], default: [] },
    },
    required: true,
    _id: false,
  })
  group!: { host: any; members: any[] };

  @Prop({
    type: {
      checkIn: { type: Date, required: true },
      checkOut: { type: Date, required: true },
    },
    required: true,
    _id: false,
  })
  stay!: { checkIn: Date; checkOut: Date };

  @Prop({
    type: {
      basePrice: { type: Number, required: true },
      extraServices: { type: [ExtraServiceSchema], default: [] },
      totalAmount: { type: Number, required: true },
      amountReceived: { type: Number, default: 0 },
      platform: { type: String, enum: ['Booking', 'AirBnB', 'Directo'], required: true },
      paymentMethod: { type: String, enum: ['Efectivo', 'Nequi', 'Bancolombia', 'None'], default: 'None' },
      status: { type: String, enum: ['PAGADO', 'FALTA PAGO', 'NO SHOW'], default: 'FALTA PAGO' },
    },
    required: true,
    _id: false,
  })
  billing!: {
    basePrice: number;
    extraServices: any[];
    totalAmount: number;
    amountReceived: number;
    platform: string;
    paymentMethod: string;
    status: string;
  };

  @Prop({ type: String, default: '' })
  observations!: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Virtual: cuánto falta por recibir
BookingSchema.virtual('billing.pendingAmount').get(function () {
  return this.billing.totalAmount - this.billing.amountReceived;
});
