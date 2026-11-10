import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings';
import { Apartment, ApartmentDocument } from '../apartments';
import { Expense, ExpenseDocument } from '../expenses';
import { roundBillingCheckCop } from '../../shared/money.util';
import type { BillingAmounts } from '../../shared/money.util';

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
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const record of records) {
      const { _id, __v, createdAt, updatedAt, ...data } = record;
      if (_id) {
        const res = await model.updateOne(
          { _id },
          { $set: data },
          { upsert: true },
        );
        res.upsertedCount ? inserted++ : updated++;
      } else {
        await new model(data).save();
        inserted++;
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
    return this.importRecords(this.bookingModel, clean);
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

  // ── ARREGLAR PRECIOS (herramienta temporal) ────────────────
  // En Colombia no se usan centavos: trunca hacia abajo los montos que ya
  // están guardados (556.874 → 556.800) y recalcula el total como base + extras
  async fixBookingPrices(): Promise<{
    checked: number;
    fixed: number;
    changes: string[];
  }> {
    const bookings = await this.bookingModel
      .find()
      .select('group.host.fullName billing')
      .lean();

    let fixed = 0;
    const changes: string[] = [];

    for (const b of bookings) {
      const billing = (b.billing ?? {}) as BillingAmounts;
      const host = (
        b.group as { host?: { fullName?: string } } | undefined
      )?.host;
      const rounded = roundBillingCheckCop(billing);
      if (!rounded.changed) continue;

      await this.bookingModel.updateOne(
        { _id: b._id },
        { $set: { billing: rounded.billing } },
      );
      fixed++;

      if (changes.length < 10)
        changes.push(
          `${host?.fullName ?? String(b._id)}: ` +
            `base ${billing.basePrice ?? 0} → ${rounded.billing.basePrice ?? 0} · ` +
            `total ${billing.totalAmount ?? 0} → ${rounded.billing.totalAmount ?? 0} · ` +
            `recibido ${billing.amountReceived ?? 0} → ${rounded.billing.amountReceived ?? 0}`,
        );
    }

    return { checked: bookings.length, fixed, changes };
  }
}
