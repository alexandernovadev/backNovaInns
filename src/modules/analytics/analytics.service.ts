import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings';
import { Apartment, ApartmentDocument } from '../apartments';
import { ApartmentStatus } from '../../shared/enums';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    @InjectModel(Apartment.name) private aptModel: Model<ApartmentDocument>,
  ) {}

  async dashboard(from?: string, to?: string, apartmentId?: string) {
    const match = this.baseMatch(from, to, apartmentId);
    const [
      summary,
      monthly,
      platforms,
      payments,
      dayOfWeek,
      countries,
      apartments,
    ] = await Promise.all([
      this.summary(match),
      this.revenueByMonth(match),
      this.platformDistribution(match),
      this.paymentMethodDistribution(match),
      this.dayOfWeekDistribution(match),
      this.guestsByCountry(match),
      this.revenueByApartment(match),
    ]);

    return {
      summary,
      monthly,
      platforms,
      payments,
      dayOfWeek,
      countries,
      apartments,
    };
  }

  // ── helpers ──
  private dateMatch(from?: string, to?: string): Record<string, any> {
    if (!from && !to) return {};
    const f: Record<string, any> = {};
    if (from) f.$gte = new Date(from);
    if (to) f.$lt = new Date(to);
    return { 'stay.checkIn': f };
  }

  // Filtro común: fechas + apartamento, sin NO SHOW en ninguna métrica.
  // apartmentId se guarda como string (el schema lo resuelve como Mixed), no se castea.
  private baseMatch(
    from?: string,
    to?: string,
    apartmentId?: string,
  ): Record<string, any> {
    return {
      ...this.dateMatch(from, to),
      ...(apartmentId ? { apartmentId } : {}),
      'billing.status': { $ne: 'NO SHOW' },
    };
  }

  private async apartmentNames(): Promise<Map<string, string>> {
    const apts = await this.aptModel.find({}, 'internalName').lean();
    return new Map(apts.map((a) => [String(a._id), a.internalName]));
  }

  // ── 1. summary ──
  private async summary(match: Record<string, any>) {
    const pipe: any[] = [{ $match: match }];
    pipe.push({
      $group: {
        _id: null,
        totalExpected: { $sum: '$billing.totalAmount' },
        totalReceived: { $sum: '$billing.amountReceived' },
        bookingCount: { $sum: 1 },
        avgTotal: { $avg: '$billing.totalAmount' },
        avgNights: {
          $avg: {
            $divide: [
              { $subtract: ['$stay.checkOut', '$stay.checkIn'] },
              86400000,
            ],
          },
        },
      },
    });
    const [r] = await this.bookingModel.aggregate(pipe);
    return r
      ? {
          totalExpected: r.totalExpected,
          totalReceived: r.totalReceived,
          totalPending: r.totalExpected - r.totalReceived,
          bookingCount: r.bookingCount,
          avgTotal: Math.round(r.avgTotal),
          avgNights: Math.round(r.avgNights * 10) / 10,
        }
      : {
          totalExpected: 0,
          totalReceived: 0,
          totalPending: 0,
          bookingCount: 0,
          avgTotal: 0,
          avgNights: 0,
        };
  }

  // ── 2. revenue by calendar month ──
  private async revenueByMonth(match: Record<string, any>) {
    const pipe: any[] = [
      { $match: match },
      {
        $project: {
          checkIn: '$stay.checkIn',
          pending: {
            $subtract: ['$billing.totalAmount', '$billing.amountReceived'],
          },
          received: '$billing.amountReceived',
        },
      },
      { $sort: { checkIn: 1 } },
    ];
    const bookings = await this.bookingModel.aggregate(pipe);

    const monthNames = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];

    const map = new Map<
      string,
      {
        label: string;
        sort: number;
        pending: number;
        received: number;
        count: number;
      }
    >();
    for (const b of bookings) {
      const d = new Date(b.checkIn);
      const m = d.getUTCMonth();
      const y = d.getUTCFullYear();
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!map.has(key))
        map.set(key, {
          label: `${monthNames[m]} ${String(y).slice(2)}`,
          sort: y * 12 + m,
          pending: 0,
          received: 0,
          count: 0,
        });
      const entry = map.get(key)!;
      entry.pending += b.pending;
      entry.received += b.received;
      entry.count += 1;
    }

    return Array.from(map.values())
      .sort((a, b) => a.sort - b.sort)
      .map((r) => ({
        month: r.label,
        pending: r.pending,
        received: r.received,
        count: r.count,
      }));
  }

  // ── 3. platform distribution ──
  private async platformDistribution(match: Record<string, any>) {
    const pipe: any[] = [{ $match: { ...match } }];
    pipe.push({
      $group: {
        _id: '$billing.platform',
        total: { $sum: '$billing.totalAmount' },
        count: { $sum: 1 },
      },
    });
    pipe.push({ $sort: { total: -1 } });
    return this.bookingModel.aggregate(pipe).then((rows) =>
      rows.map((r) => ({
        platform: r._id || 'Desconocido',
        total: r.total,
        count: r.count,
      })),
    );
  }

  // ── 4. payment method distribution ──
  private async paymentMethodDistribution(match: Record<string, any>) {
    const pipe: any[] = [{ $match: { ...match } }];
    pipe.push({
      $group: {
        _id: '$billing.paymentMethod',
        total: { $sum: '$billing.totalAmount' },
        count: { $sum: 1 },
      },
    });
    pipe.push({ $sort: { total: -1 } });
    return this.bookingModel.aggregate(pipe).then((rows) =>
      rows.map((r) => ({
        method: r._id || 'Ninguno',
        total: r.total,
        count: r.count,
      })),
    );
  }

  // ── 5. day of week ──
  private async dayOfWeekDistribution(match: Record<string, any>) {
    const pipe: any[] = [{ $match: match }];
    pipe.push({
      $group: {
        _id: { $dayOfWeek: '$stay.checkIn' },
        count: { $sum: 1 },
        revenue: { $sum: '$billing.totalAmount' },
      },
    });
    pipe.push({ $sort: { _id: 1 } });
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const rows = await this.bookingModel.aggregate(pipe);
    return rows.map((r) => ({
      day: days[r._id - 1] || '?',
      count: r.count,
      revenue: r.revenue,
    }));
  }

  // ── 6. guests by country (host + members) ──
  private async guestsByCountry(match: Record<string, any>) {
    const pipe: any[] = [
      { $match: match },
      {
        $addFields: {
          guestCount: {
            $add: [1, { $size: { $ifNull: ['$group.members', []] } }],
          },
          revenuePerGuest: {
            $divide: [
              '$billing.totalAmount',
              { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] },
            ],
          },
          hostLoc: {
            $cond: [
              { $ifNull: ['$group.host.location.countryCode', false] },
              ['$group.host.location'],
              [],
            ],
          },
        },
      },
      {
        $addFields: {
          allGuestLocations: {
            $concatArrays: [
              '$hostLoc',
              { $ifNull: ['$group.members.location', []] },
            ],
          },
        },
      },
      { $unwind: '$allGuestLocations' },
      { $match: { 'allGuestLocations.countryCode': { $ne: '' } } },
      {
        $group: {
          _id: '$allGuestLocations.countryCode',
          countryName: { $first: '$allGuestLocations.countryName' },
          guests: { $sum: 1 },
          revenue: { $sum: '$revenuePerGuest' },
        },
      },
      { $sort: { guests: -1 } },
    ];
    return this.bookingModel.aggregate(pipe).then((rows) =>
      rows
        .filter((r) => r._id)
        .map((r) => ({
          code: r._id,
          name: r.countryName || r._id,
          guests: r.guests,
          revenue: Math.round(r.revenue),
        })),
    );
  }

  // ── 7. revenue by apartment (comparativo) ──
  private async revenueByApartment(match: Record<string, any>) {
    const [rows, names] = await Promise.all([
      this.bookingModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$apartmentId',
            expected: { $sum: '$billing.totalAmount' },
            received: { $sum: '$billing.amountReceived' },
            count: { $sum: 1 },
            nights: {
              $sum: {
                $divide: [
                  { $subtract: ['$stay.checkOut', '$stay.checkIn'] },
                  86400000,
                ],
              },
            },
          },
        },
        { $sort: { expected: -1 } },
      ]),
      this.apartmentNames(),
    ]);
    return rows.map((r) => ({
      apartmentId: String(r._id),
      name: names.get(String(r._id)) ?? 'Sin apartamento',
      expected: r.expected,
      received: r.received,
      pending: r.expected - r.received,
      count: r.count,
      nights: Math.round(r.nights),
    }));
  }

  // ── 8. vacancy (unsold days) — mes calendario ──
  async vacancy(from?: string, to?: string, apartmentId?: string) {
    const aptFilter: Record<string, any> = { status: ApartmentStatus.ACTIVE };
    if (apartmentId) aptFilter._id = apartmentId;
    const apts = await this.aptModel.find(aptFilter, 'internalName').lean();
    const aptIds = apts.map((a) => String(a._id));

    // Default: mes calendario actual (1ro → 1ro del mes siguiente)
    const now = new Date();
    const fDate = from
      ? new Date(from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const tDate = to
      ? new Date(to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Cada apto cuenta como disponible desde su primera reserva (createdAt no
    // sirve: los datos se migran). Sin reservas → disponible desde hoy.
    const todayKey = now.toISOString().slice(0, 10);
    const firsts = await this.bookingModel.aggregate([
      {
        $match: {
          apartmentId: { $in: aptIds },
          'billing.status': { $ne: 'NO SHOW' },
        },
      },
      { $group: { _id: '$apartmentId', first: { $min: '$stay.checkIn' } } },
    ]);
    const startKey = new Map(aptIds.map((id) => [id, todayKey]));
    for (const f of firsts)
      startKey.set(String(f._id), new Date(f.first).toISOString().slice(0, 10));

    // Expande cada reserva en días ocupados, por apto
    const occupiedRows = await this.bookingModel.aggregate([
      {
        $match: {
          apartmentId: { $in: aptIds },
          'stay.checkIn': { $lt: tDate },
          'stay.checkOut': { $gt: fDate },
          'billing.status': { $ne: 'NO SHOW' },
        },
      },
      {
        $addFields: {
          nights: {
            $range: [
              0,
              {
                $floor: {
                  $divide: [
                    { $subtract: ['$stay.checkOut', '$stay.checkIn'] },
                    86400000,
                  ],
                },
              },
            ],
          },
        },
      },
      { $unwind: '$nights' },
      {
        $addFields: {
          date: {
            $dateAdd: {
              startDate: '$stay.checkIn',
              unit: 'day',
              amount: '$nights',
            },
          },
        },
      },
      { $match: { date: { $gte: fDate, $lt: tDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            apt: '$apartmentId',
          },
        },
      },
    ]);
    // Un apto ocupa como máximo un slot por día, aunque se crucen reservas
    const occupied = new Set(
      occupiedRows.map((r) => `${r._id.date}|${String(r._id.apt)}`),
    );

    const monthNames = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    const monthLabel = (d: Date) =>
      `${monthNames[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;

    const dailySeries: { date: string; booked: number; vacant: number }[] = [];
    const perApt = new Map(
      aptIds.map((id) => [id, { occupiedDays: 0, availableDays: 0 }]),
    );
    // Map conserva el orden de inserción → meses en orden cronológico
    const monthlyMap = new Map<
      string,
      {
        unsoldDays: number;
        availableDays: number;
        daysInCycle: number;
        apts: Set<string>;
      }
    >();
    let totalUnsoldDays = 0;
    let totalDaySlots = 0;

    for (let d = new Date(fDate); d < tDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const label = monthLabel(new Date(key));
      if (!monthlyMap.has(label))
        monthlyMap.set(label, {
          unsoldDays: 0,
          availableDays: 0,
          daysInCycle: 0,
          apts: new Set(),
        });
      const rec = monthlyMap.get(label)!;

      let available = 0;
      let booked = 0;
      for (const id of aptIds) {
        if (startKey.get(id)! > key) continue;
        const stats = perApt.get(id)!;
        available++;
        stats.availableDays++;
        rec.apts.add(id);
        if (occupied.has(`${key}|${id}`)) {
          booked++;
          stats.occupiedDays++;
        }
      }
      const vacant = available - booked;
      dailySeries.push({ date: key, booked, vacant });
      totalUnsoldDays += vacant;
      totalDaySlots += available;
      rec.unsoldDays += vacant;
      rec.availableDays += available;
      rec.daysInCycle += 1;
    }

    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 100 * 10) / 10 : 0;

    const monthly = Array.from(monthlyMap.entries()).map(([label, v]) => {
      const n = v.apts.size;
      return {
        label,
        unsoldDays: v.unsoldDays,
        availableDays: v.availableDays,
        vacancyPct: pct(v.unsoldDays, v.availableDays),
        daysInCycle: v.daysInCycle,
        avgUnsoldPerApt: n > 0 ? Math.round(v.unsoldDays / n) : 0,
        avgOccupiedPerApt:
          n > 0 ? Math.round((v.availableDays - v.unsoldDays) / n) : 0,
      };
    });

    const names = new Map(apts.map((a) => [String(a._id), a.internalName]));
    const byApartment = aptIds
      .map((id) => {
        const s = perApt.get(id)!;
        return {
          apartmentId: id,
          name: names.get(id) ?? id,
          occupiedDays: s.occupiedDays,
          availableDays: s.availableDays,
          occupancyPct: pct(s.occupiedDays, s.availableDays),
        };
      })
      .filter((a) => a.availableDays > 0)
      .sort((a, b) => b.occupancyPct - a.occupancyPct);

    // Solo cuentan los aptos que estaban operando en el período
    const totalApts = byApartment.length;
    const rangeDays = Math.floor(
      (tDate.getTime() - fDate.getTime()) / 86400000,
    );
    return {
      totalUnsoldDays,
      totalDaySlots,
      vacancyRate: pct(totalUnsoldDays, totalDaySlots),
      avgUnsoldPerApt:
        totalApts > 0 ? Math.round(totalUnsoldDays / totalApts) : 0,
      avgOccupiedPerApt:
        totalApts > 0
          ? Math.round((totalDaySlots - totalUnsoldDays) / totalApts)
          : 0,
      totalDaysInRange: rangeDays,
      totalApts,
      daily: dailySeries,
      monthly,
      byApartment,
    };
  }

  // ── 13. region detail (departments/cities by country) ──
  async guestsByRegion(
    countryCode: string,
    groupBy?: string,
    from?: string,
    to?: string,
    apartmentId?: string,
  ) {
    const match = {
      ...this.baseMatch(from, to, apartmentId),
      'group.host.location.countryCode': countryCode,
    };
    const pipe: any[] = [
      { $match: match },
      {
        $addFields: {
          guestCount: {
            $add: [1, { $size: { $ifNull: ['$group.members', []] } }],
          },
          revenuePerGuest: {
            $divide: [
              '$billing.totalAmount',
              { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] },
            ],
          },
          hostLoc: {
            $cond: [
              { $ifNull: ['$group.host.location.countryCode', false] },
              ['$group.host.location'],
              [],
            ],
          },
        },
      },
      {
        $addFields: {
          allGuestLocations: {
            $concatArrays: [
              '$hostLoc',
              { $ifNull: ['$group.members.location', []] },
            ],
          },
        },
      },
      { $unwind: '$allGuestLocations' },
      {
        $match: {
          'allGuestLocations.countryCode': countryCode,
          'allGuestLocations.department': { $ne: '' },
        },
      },
    ];

    if (groupBy === 'department') {
      pipe.push({
        $group: {
          _id: '$allGuestLocations.department',
          guests: { $sum: 1 },
          revenue: { $sum: '$revenuePerGuest' },
        },
      });
      pipe.push({ $sort: { guests: -1 } });
      const rows = await this.bookingModel.aggregate(pipe);
      return rows.map((r) => ({
        department: r._id,
        guests: r.guests,
        revenue: Math.round(r.revenue),
      }));
    }

    pipe.push({
      $group: {
        _id: {
          department: '$allGuestLocations.department',
          city: '$allGuestLocations.city',
        },
        guests: { $sum: 1 },
        revenue: { $sum: '$revenuePerGuest' },
      },
    });
    pipe.push({ $sort: { guests: -1 } });
    const rows = await this.bookingModel.aggregate(pipe);
    return rows
      .filter((r) => r._id.department)
      .map((r) => ({
        department: r._id.department,
        city: r._id.city || '—',
        guests: r.guests,
        revenue: Math.round(r.revenue),
      }));
  }
}
