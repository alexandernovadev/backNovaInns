import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

const identificationDef = {
  _id:       false,
  url:       { type: String, required: true },
  publicId:  { type: String, default: '' },
  type:      { type: String, enum: ['FRONT', 'BACK', 'SELFIE'], required: true },
  uploadedAt:{ type: Date, default: Date.now },
};

const locationDef = {
  _id:         false,
  countryCode: { type: String, default: '' },
  countryName: { type: String, default: '' },
  department:  { type: String, default: '' },
  city:        { type: String, default: '' },
};

const guestDef = {
  _id:             false,
  fullName:        { type: String, default: '' },
  idNumber:        { type: String, default: '' },
  birthDate:       { type: String, default: undefined },
  location:        { type: locationDef, default: undefined },
  identifications: { type: [identificationDef], default: [] },
};

const extraServiceDef = {
  type:        { type: String, enum: ['PARKING', 'LAUNDRY', 'OTHER'], required: true },
  description: { type: String, default: '' },
  quantity:    { type: Number, default: 1 },
  price:       { type: Number, required: true },
  vehicleType: { type: String, enum: ['CAR', 'MOTORCYCLE', 'BICYCLE', 'OTHER'], default: undefined },
  weightKg:    { type: Number, default: undefined },
};

@Schema({ timestamps: true })
export class Booking {
  @Prop({ type: Types.ObjectId, ref: 'Apartment', required: true })
  apartmentId!: Types.ObjectId;

  @Prop({
    type: {
      host:    { type: guestDef,    required: true },
      members: { type: [guestDef],  default: [] },
    },
    required: true,
    _id: false,
  })
  group!: { host: any; members: any[] };

  @Prop({
    type: {
      checkIn:  { type: Date, required: true },
      checkOut: { type: Date, required: true },
    },
    required: true,
    _id: false,
  })
  stay!: { checkIn: Date; checkOut: Date };

  @Prop({
    type: {
      basePrice:      { type: Number, required: true },
      extraServices:  { type: [extraServiceDef], default: [] },
      totalAmount:    { type: Number, required: true },
      amountReceived: { type: Number, default: 0 },
      platform:       { type: String, enum: ['Booking', 'AirBnB', 'Directo'], required: true },
      paymentMethod:  { type: String, enum: ['Efectivo', 'Nequi', 'Bancolombia', 'None'], default: 'None' },
      status:         { type: String, enum: ['PAGADO', 'FALTA PAGO', 'NO SHOW'], default: 'FALTA PAGO' },
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

BookingSchema.index({ 'stay.checkIn': 1, 'stay.checkOut': 1 });

BookingSchema.virtual('billing.pendingAmount').get(function () {
  return this.billing.totalAmount - this.billing.amountReceived;
});
