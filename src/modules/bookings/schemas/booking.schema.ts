import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { toTitleCase } from '../../../shared/text.util';
import {
  applyBillingCop,
  roundBillingUpdateCop,
} from '../../../shared/money.util';

export type BookingDocument = HydratedDocument<Booking>;

const identificationDef = {
  _id: false,
  url: { type: String, required: true },
  publicId: { type: String, default: '' },
  type: { type: String, enum: ['FRONT', 'BACK', 'SELFIE'], required: true },
  uploadedAt: { type: Date, default: Date.now },
};

const locationDef = {
  _id: false,
  countryCode: { type: String, default: '' },
  countryName: { type: String, default: '' },
  department: { type: String, default: '' },
  city: { type: String, default: '' },
};

const guestDef = {
  _id: false,
  fullName: { type: String, default: '', set: toTitleCase },
  idNumber: { type: String, default: '' },
  birthDate: { type: String, default: undefined },
  location: { type: locationDef, default: undefined },
  identifications: { type: [identificationDef], default: [] },
};

const extraServiceDef = {
  type: { type: String, enum: ['PARKING', 'LAUNDRY', 'OTHER'], required: true },
  description: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  price: { type: Number, required: true },
  vehicleType: {
    type: String,
    enum: ['CAR', 'MOTORCYCLE', 'BICYCLE', 'OTHER'],
    default: undefined,
  },
  weightKg: { type: Number, default: undefined },
};

@Schema({ timestamps: true })
export class Booking {
  // Se guarda como string (el id viaja así desde el front y desde NovaAI); con
  // String explícito el índice de apartmentId sí sirve: Mixed no se indexa bien
  @Prop({ type: String, ref: 'Apartment', required: true })
  apartmentId!: string;

  @Prop({
    type: {
      host: { type: guestDef, required: true },
      members: { type: [guestDef], default: [] },
    },
    required: true,
    _id: false,
  })
  group!: { host: any; members: any[] };

  @Prop({
    type: {
      checkIn: { type: Date, required: true },
      checkOut: { type: Date, required: true },
      status: {
        type: String,
        enum: ['PENDIENTE', 'CHECK-IN', 'CHECK-OUT'],
        default: 'PENDIENTE',
      },
    },
    required: true,
    _id: false,
  })
  stay!: { checkIn: Date; checkOut: Date; status: string };

  @Prop({
    type: {
      basePrice: { type: Number, required: true },
      extraServices: { type: [extraServiceDef], default: [] },
      totalAmount: { type: Number, required: true },
      amountReceived: { type: Number, default: 0 },
      platform: {
        type: String,
        enum: ['Booking', 'AirBnB', 'Directo'],
        required: true,
      },
      paymentMethod: {
        type: String,
        enum: ['Efectivo', 'Nequi', 'Bancolombia', 'None'],
        default: 'None',
      },
      status: {
        type: String,
        enum: ['PAGADO', 'FALTA PAGO', 'NO SHOW'],
        default: 'FALTA PAGO',
      },
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

// Índices por los filtros reales de buildFilter/aggregate: casi nunca se filtra
// por un solo campo, así que van compuestos con la fecha ordenada
BookingSchema.index({ 'stay.checkIn': 1, 'stay.checkOut': 1 });
BookingSchema.index({ apartmentId: 1, 'stay.checkIn': 1 });
BookingSchema.index({ 'stay.status': 1, 'stay.checkIn': 1 });
BookingSchema.index({ 'billing.status': 1, 'stay.checkIn': 1 });
BookingSchema.index({ 'billing.platform': 1, 'stay.checkIn': 1 });
BookingSchema.index({ 'group.host.fullName': 1 });
BookingSchema.index({ 'group.host.location.countryCode': 1 });
BookingSchema.index({ createdAt: -1 });

BookingSchema.virtual('billing.pendingAmount').get(function () {
  return this.billing.totalAmount - this.billing.amountReceived;
});

// El dinero se guarda siempre en múltiplos de 100 COP (en Colombia no se usan
// centavos: 556.874 → 556.800). Cubre altas, ediciones y pagos por cualquier
// vía que pase por el modelo. Se muta en el sitio: billing es un subdocumento
// de mongoose y no se puede copiar con spread
BookingSchema.pre('save', function () {
  if (this.billing) applyBillingCop(this.billing);
});

function roundUpdate(this: {
  getUpdate(): unknown;
  setUpdate(u: unknown): void;
}) {
  this.setUpdate(roundBillingUpdateCop(this.getUpdate()));
}

BookingSchema.pre('findOneAndUpdate', roundUpdate);
BookingSchema.pre('updateOne', roundUpdate);
BookingSchema.pre('updateMany', roundUpdate);
