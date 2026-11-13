import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Model } from 'mongoose';
import { Booking, BookingDocument } from './schemas/booking.schema';
import { paginate, MAX_LIMIT } from '../../shared/pagination.util';
import { roundBillingCop, roundCopDown } from '../../shared/money.util';
import type { BillingAmounts } from '../../shared/money.util';

export interface BookingFilters {
  search?: string;
  status?: string;
  lifecycle?: string;
  platform?: string;
  apartmentId?: string;
  fromDate?: string;
  toDate?: string;
}

// El dinero entra siempre en múltiplos de 100 COP (en Colombia no se usan
// centavos: 556.874 → 556.800). El schema lo repite por seguridad
function roundPayload(data: any): any {
  const d = data as { billing?: BillingAmounts } | undefined;
  if (d?.billing) d.billing = roundBillingCop(d.billing);
  return data;
}

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
  ) {}

  async create(data: any): Promise<BookingDocument> {
    return new this.bookingModel(roundPayload(data)).save();
  }

  async findAll(
    query: BookingFilters & { page?: number; limit?: number } = {},
  ) {
    const filter = this.buildFilter(query);
    const page = Math.max(1, query.page ?? 1);
    // Tope: ?limit=100000 no es una consulta legítima (ver MAX_LIMIT)
    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_LIMIT);

    // La lista es por fecha de entrada, pero los CHECK-OUT terminados caen al
    // final. Se pagina dentro de la agregación para que el orden sea estable
    // entre páginas, y después se poblan solo los ids de la página.
    const [facet] = await this.bookingModel.aggregate<{
      data: { _id: unknown }[];
      meta: { total: number }[];
    }>([
      { $match: filter },
      {
        $addFields: {
          __done: { $cond: [{ $eq: ['$stay.status', 'CHECK-OUT'] }, 1, 0] },
        },
      },
      { $sort: { __done: 1, 'stay.checkIn': 1, _id: 1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: { _id: 1 } },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ]);

    const ids = (facet?.data ?? []).map((d) => d._id);
    // Sin las identificaciones: la lista no las muestra y son URLs de documentos
    // de identidad viajando en cada página
    const docs = (await this.bookingModel
      .find({ _id: { $in: ids } } as QueryFilter<BookingDocument>, {
        'group.host.identifications': 0,
        'group.members.identifications': 0,
      })
      .populate({ path: 'apartmentId', select: 'internalName status' })
      .lean()) as unknown as BookingDocument[];

    const order = new Map(ids.map((id, i) => [String(id), i]));
    const data = docs
      .filter((d) => order.has(String(d._id)))
      .sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
      );

    const total = facet?.meta?.[0]?.total ?? 0;
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Filtros compartidos por la lista y el resumen financiero
  private buildFilter(query: BookingFilters): Record<string, any> {
    const {
      search,
      status,
      lifecycle,
      platform,
      apartmentId,
      fromDate,
      toDate,
    } = query;
    const filter: Record<string, any> = {};

    if (search)
      filter['group.host.fullName'] = { $regex: search, $options: 'i' };
    if (status) filter['billing.status'] = status;
    if (lifecycle) filter['stay.status'] = lifecycle;
    if (platform) filter['billing.platform'] = platform;
    if (apartmentId) filter.apartmentId = apartmentId;
    // Filtro por rango de fechas de checkIn (mes calendario)
    if (fromDate || toDate) {
      filter['stay.checkIn'] = {};
      if (fromDate) filter['stay.checkIn'].$gte = new Date(fromDate);
      if (toDate) filter['stay.checkIn'].$lt = new Date(toDate);
    }

    return filter;
  }

  async findById(id: string): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findById(id)
      .populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  async update(id: string, data: any): Promise<BookingDocument> {
    const booking = await this.bookingModel.findByIdAndUpdate(
      id,
      { $set: roundPayload(data) },
      { returnDocument: 'after' },
    );
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  async findForCalendar(from?: string, to?: string) {
    const filter: Record<string, any> = {};
    if (from || to) {
      filter['stay.checkIn'] = {};
      if (from) filter['stay.checkIn'].$gte = new Date(from);
      if (to) filter['stay.checkIn'].$lt = new Date(to);
    }
    return paginate(this.bookingModel, {
      filter,
      select:
        'stay.checkIn stay.checkOut stay.status billing.totalAmount group.host.fullName',
      page: 1,
      // El calendario dibuja el rango completo: necesita más que una tabla, pero
      // no un sinfín (antes era 9999 sin tope)
      limit: 1500,
      maxLimit: 1500,
      lean: true,
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
    const booking = await this.bookingModel
      .findById(id)
      .populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');

    // Pagos también en múltiplos de 100 COP
    booking.billing.amountReceived += roundCopDown(amount);

    if (booking.billing.amountReceived >= booking.billing.totalAmount) {
      booking.billing.status = 'PAGADO';
      booking.billing.amountReceived = booking.billing.totalAmount; // cap
    }

    return booking.save();
  }

  async updateStayStatus(id: string, status: string): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findByIdAndUpdate(
        id,
        { $set: { 'stay.status': status } },
        { returnDocument: 'after' },
      )
      .populate('apartmentId', 'internalName status');
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  // Resumen financiero: total esperado, recibido y pendiente
  async financialSummary(query: BookingFilters = {}) {
    // Mismos filtros que la lista. apartmentId se guarda como string (el schema
    // lo resuelve como Mixed), así que no se castea a ObjectId.
    const match = this.buildFilter(query);
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
