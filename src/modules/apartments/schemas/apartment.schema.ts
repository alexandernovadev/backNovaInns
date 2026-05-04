import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ApartmentStatus } from '../../../shared/enums';

export type ApartmentDocument = HydratedDocument<Apartment>;

const RoomSchema = {
  name: { type: String, required: true },
  furniture: {
    beds:        { type: Number, default: 0 },
    closets:     { type: Number, default: 0 },
    nightstands: { type: Number, default: 0 },
  },
  windows: {
    curtains: { type: Number, default: 0 },
    sheers:   { type: Number, default: 0 },
  },
  inventory: {
    hangers: { type: Number, default: 0 },
    pillows: { type: Number, default: 0 },
  },
};

const BathroomSchema = {
  name: { type: String, required: true },
  fixtures: {
    toilets:        { type: Number, default: 0 },
    sinks:          { type: Number, default: 0 },
    electricShowers:{ type: Number, default: 0 },
  },
};

const PhotoSchema = {
  url:       { type: String, required: true },
  publicId:  { type: String, required: true },
  caption:   { type: String, default: '' },
  uploadedAt:{ type: Date, default: Date.now },
};

@Schema({ timestamps: true })
export class Apartment {
  @Prop({ required: true, trim: true })
  internalName!: string;

  @Prop({ type: [RoomSchema], default: [] })
  rooms!: any[];

  @Prop({ type: [BathroomSchema], default: [] })
  bathrooms!: any[];

  @Prop({
    type: {
      kitchen: {
        appliances: {
          fridges:    { type: Number, default: 0 },
          stoves:     { type: Number, default: 0 },
          microwaves: { type: Number, default: 0 },
          blenders:   { type: Number, default: 0 },
        },
        cookware: {
          pots: { type: Number, default: 0 },
          pans: { type: Number, default: 0 },
        },
        seating: {
          diningSillas: { type: Number, default: 0 },
        },
      },
      electronics: {
        tvs:       { type: Number, default: 0 },
        irons:     { type: Number, default: 0 },
        hairDryers:{ type: Number, default: 0 },
      },
      furniture: {
        sofas:       { type: Number, default: 0 },
        sofaBeds:    { type: Number, default: 0 },
        rugs:        { type: Number, default: 0 },
        diningTables:{ type: Number, default: 0 },
      },
    },
    _id: false,
  })
  equipment!: any;

  @Prop({
    type: { totalSpots: { type: Number, default: 0 } },
    _id: false,
  })
  parking!: { totalSpots: number };

  @Prop({ type: [PhotoSchema], default: [] })
  photos!: { url: string; publicId: string; caption: string; uploadedAt: Date }[];

  @Prop({ type: String, enum: Object.values(ApartmentStatus), default: ApartmentStatus.ACTIVE })
  status!: ApartmentStatus;
}

export const ApartmentSchema = SchemaFactory.createForClass(Apartment);
