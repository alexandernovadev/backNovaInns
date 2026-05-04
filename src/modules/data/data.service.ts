import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings';
import { Apartment, ApartmentDocument } from '../apartments';

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
  private async importRecords<T>(model: Model<T>, records: any[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated  = 0;

    for (const record of records) {
      const { _id, __v, createdAt, updatedAt, ...data } = record;
      if (_id) {
        const res = await model.updateOne({ _id }, { $set: data }, { upsert: true });
        res.upsertedCount ? inserted++ : updated++;
      } else {
        await new model(data).save();
        inserted++;
      }
    }

    return { inserted, updated };
  }

  async importBookings(records: any[]): Promise<{ inserted: number; updated: number }> {
    return this.importRecords(this.bookingModel, records);
  }

  async importApartments(records: any[]): Promise<{ inserted: number; updated: number }> {
    return this.importRecords(this.apartmentModel, records);
  }
}
