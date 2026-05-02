import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/schemas/booking.schema';
import { Apartment, ApartmentDocument } from '../apartments/schemas/apartment.schema';

@Injectable()
export class DataService {
  constructor(
    @InjectModel(Booking.name)   private bookingModel:   Model<BookingDocument>,
    @InjectModel(Apartment.name) private apartmentModel: Model<ApartmentDocument>,
  ) {}

  // ── EXPORT ──────────────────────────────────────────────
  async exportBookings() {
    return this.bookingModel.find().populate('apartmentId', 'internalName status').lean();
  }

  async exportApartments() {
    return this.apartmentModel.find().lean();
  }

  // ── IMPORT ──────────────────────────────────────────────
  async importBookings(records: any[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated  = 0;

    for (const record of records) {
      const { _id, __v, createdAt, updatedAt, ...data } = record;
      if (_id) {
        const res = await this.bookingModel.updateOne({ _id }, { $set: data }, { upsert: true });
        res.upsertedCount ? inserted++ : updated++;
      } else {
        await new this.bookingModel(data).save();
        inserted++;
      }
    }

    return { inserted, updated };
  }

  async importApartments(records: any[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated  = 0;

    for (const record of records) {
      const { _id, __v, createdAt, updatedAt, ...data } = record;
      if (_id) {
        const res = await this.apartmentModel.updateOne({ _id }, { $set: data }, { upsert: true });
        res.upsertedCount ? inserted++ : updated++;
      } else {
        await new this.apartmentModel(data).save();
        inserted++;
      }
    }

    return { inserted, updated };
  }
}
