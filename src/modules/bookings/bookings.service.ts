import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from './schemas/booking.schema';
import { paginate } from '../../shared/pagination.util';

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
    fromDate?: string;
    toDate?: string;
  } = {}) {
    const { search, status, platform, fromDate, toDate } = query;
    const filter: Record<string, any> = {};

    if (search)   filter['group.host.fullName'] = { $regex: search, $options: 'i' };
    if (status)   filter['billing.status'] = status;
    if (platform) filter['billing.platform'] = platform;
    // Filtro por ciclo mensal (18 do mês X até 18 do mês seguinte)
    // O negócio iniciou operações no dia 18, então o ciclo fiscal é 18→18
    if (fromDate || toDate) {
      filter['stay.checkIn'] = {};
      if (fromDate) filter['stay.checkIn'].$gte = new Date(fromDate);
      if (toDate)   filter['stay.checkIn'].$lt = new Date(toDate);
    }

    return paginate(this.bookingModel, {
      filter,
      page: query.page,
      limit: query.limit ?? 20,
      sort: { 'stay.checkIn': -1 },
      populate: { path: 'apartmentId', select: 'internalName status' },
    });
  }

  async findById(id: string): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findById(id)
      .populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  async update(id: string, data: any): Promise<BookingDocument> {
    const booking = await this.bookingModel.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after' });
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  async findForCalendar(from?: string, to?: string) {
    const filter: Record<string, any> = {};
    if (from || to) {
      filter['stay.checkIn'] = {};
      if (from) filter['stay.checkIn'].$gte = new Date(from);
      if (to)   filter['stay.checkIn'].$lt = new Date(to);
    }
    return paginate(this.bookingModel, {
      filter,
      select: 'stay.checkIn stay.checkOut billing.totalAmount group.host.fullName',
      page: 1,
      limit: 9999,
      sort: { 'stay.checkIn': -1 },
      populate: { path: 'apartmentId', select: 'internalName' },
    });
  }

  // Registra un pago parcial o total
  async remove(id: string): Promise<void> {
    const result = await this.bookingModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Reserva no encontrada');
  }

  async registerPayment(id: string, amount: number): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(id).populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');

    booking.billing.amountReceived += amount;

    if (booking.billing.amountReceived >= booking.billing.totalAmount) {
      booking.billing.status = 'PAGADO';
      booking.billing.amountReceived = booking.billing.totalAmount; // cap
    }

    return booking.save();
  }

  // Resumen financiero: total esperado, recibido y pendiente
  async financialSummary(fromDate?: string, toDate?: string) {
    const match: Record<string, any> = { 'billing.status': { $ne: 'NO SHOW' } };
    if (fromDate || toDate) {
      match['stay.checkIn'] = {};
      if (fromDate) match['stay.checkIn'].$gte = new Date(fromDate);
      if (toDate) match['stay.checkIn'].$lt = new Date(toDate);
    }
    const result = await this.bookingModel.aggregate([
      { $match: match },
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
