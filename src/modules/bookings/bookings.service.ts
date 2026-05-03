import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from './schemas/booking.schema';

@Injectable()
export class BookingsService {
  constructor(@InjectModel(Booking.name) private bookingModel: Model<BookingDocument>) {}

  async create(data: any): Promise<BookingDocument> {
    return new this.bookingModel(data).save();
  }

  async findAll(query: {
    search?: string;
    status?: string;
    platform?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { search, status, platform, page = 1, limit = 20 } = query;
    const filter: Record<string, any> = {};

    if (search)   filter['group.host.fullName'] = { $regex: search, $options: 'i' };
    if (status)   filter['billing.status'] = status;
    if (platform) filter['billing.platform'] = platform;

    const total = await this.bookingModel.countDocuments(filter);
    const data  = await this.bookingModel
      .find(filter)
      .populate('apartmentId', 'internalName status')
      .sort({ 'stay.checkIn': -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findById(id)
      .populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  async update(id: string, data: any): Promise<BookingDocument> {
    const booking = await this.bookingModel.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  // Registra un pago parcial o total
  async remove(id: string): Promise<void> {
    const result = await this.bookingModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Reserva no encontrada');
  }

  async registerPayment(id: string, amount: number): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(id);
    if (!booking) throw new NotFoundException('Reserva no encontrada');

    booking.billing.amountReceived += amount;

    if (booking.billing.amountReceived >= booking.billing.totalAmount) {
      booking.billing.status = 'PAGADO';
      booking.billing.amountReceived = booking.billing.totalAmount; // cap
    }

    return booking.save();
  }

  // Resumen financiero: total esperado, recibido y pendiente
  async financialSummary() {
    const result = await this.bookingModel.aggregate([
      { $match: { 'billing.status': { $ne: 'NO SHOW' } } },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: '$billing.totalAmount' },
          totalReceived: { $sum: '$billing.amountReceived' },
        },
      },
      {
        $project: {
          _id: 0,
          totalExpected: 1,
          totalReceived: 1,
          totalPending: { $subtract: ['$totalExpected', '$totalReceived'] },
        },
      },
    ]);
    return result[0] ?? { totalExpected: 0, totalReceived: 0, totalPending: 0 };
  }
}
