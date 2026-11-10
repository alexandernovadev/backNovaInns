import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings';
import { Apartment, ApartmentDocument } from '../apartments';
import { Expense, ExpenseDocument } from '../expenses';
import { roundBillingCop } from '../../shared/money.util';

export type ClearableModel = 'bookings' | 'apartments' | 'expenses';

@Injectable()
export class DataService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    @InjectModel(Apartment.name)
    private apartmentModel: Model<ApartmentDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  // ── EXPORT ──────────────────────────────────────────────
  async exportBookings() {
    return this.bookingModel
      .find()
      .populate('apartmentId', 'internalName status')
      .lean();
  }

  async exportApartments() {
    return this.apartmentModel.find().lean();
  }

  // ── IMPORT ──────────────────────────────────────────────
  private async importRecords<T>(
    model: Model<T, any, any, any, any, any, any>,
    records: any[],
    // Las reservas traen dinero: se redondea aquí porque bulkWrite/insertMany
    // no pasan por los hooks del schema
    prepare?: (data: any) => any,
  ): Promise<{ inserted: number; updated: number }> {
    const CHUNK = 500;
    let inserted = 0;
    let updated = 0;

    for (let i = 0; i < records.length; i += CHUNK) {
      const updates: any[] = [];
      const inserts: any[] = [];

      for (const record of records.slice(i, i + CHUNK)) {
        const { _id, __v, createdAt, updatedAt, ...rest } = record;
        const data = prepare ? prepare(rest) : rest;
        if (_id)
          updates.push({
            updateOne: {
              filter: { _id },
              update: { $set: data },
              upsert: true,
            },
          });
        else inserts.push({ _id, ...data });
      }

      if (updates.length) {
        const res = await model.bulkWrite(updates);
        inserted += res.upsertedCount ?? 0;
        updated += res.modifiedCount ?? 0;
      }
      if (inserts.length) {
        // insertMany sí aplica defaults y validadores del schema
        await model.insertMany(inserts);
        inserted += inserts.length;
      }
    }

    return { inserted, updated };
  }

  async importBookings(
    records: any[],
  ): Promise<{ inserted: number; updated: number }> {
    const clean = records.map((r) => ({
      ...r,
      apartmentId: r.apartmentId?._id ?? r.apartmentId,
    }));
    // bulkWrite/insertMany no pasan por los hooks: el dinero se redondea aquí
    return this.importRecords(this.bookingModel, clean, (data) =>
      data.billing ? { ...data, billing: roundBillingCop(data.billing) } : data,
    );
  }

  async importApartments(
    records: any[],
  ): Promise<{ inserted: number; updated: number }> {
    return this.importRecords(this.apartmentModel, records);
  }

  // ── COUNTS ─────────────────────────────────────────────
  async counts(): Promise<Record<ClearableModel, number>> {
    const [bookings, apartments, expenses] = await Promise.all([
      this.bookingModel.countDocuments(),
      this.apartmentModel.countDocuments(),
      this.expenseModel.countDocuments(),
    ]);
    return { bookings, apartments, expenses };
  }

  // ── CLEAR ──────────────────────────────────────────────
  async clear(model: ClearableModel): Promise<{ deleted: number }> {
    const models: Record<ClearableModel, Model<any>> = {
      bookings: this.bookingModel,
      apartments: this.apartmentModel,
      expenses: this.expenseModel,
    };

    const target = models[model];
    if (!target) throw new BadRequestException('Modelo no permitido');

    const result = await target.deleteMany({});
    return { deleted: result.deletedCount };
  }
}
