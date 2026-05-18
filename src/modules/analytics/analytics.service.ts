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

  async dashboard(from?: string, to?: string) {
    const dateFilter = this.dateMatch(from, to);
    const [summary, monthly, platforms, payments, dayOfWeek, countries] =
      await Promise.all([
        this.summary(dateFilter),
        this.revenueByMonth(dateFilter),
        this.platformDistribution(dateFilter),
        this.paymentMethodDistribution(dateFilter),
        this.dayOfWeekDistribution(dateFilter),
        this.guestsByCountry(dateFilter),
      ]);

    return { summary, monthly, platforms, payments, dayOfWeek, countries };
  }

  // ── helpers ──
  private dateMatch(from?: string, to?: string): Record<string, any> {
    if (!from && !to) return {};
    const f: Record<string, any> = {};
    if (from) f.$gte = new Date(from);
    if (to) f.$lte = new Date(to);
    return { 'stay.checkIn': f };
  }

  // ── 1. summary ──
  private async summary(match: Record<string, any>) {
    const pipe: any[] = [{ $match: { ...match, 'billing.status': { $ne: 'NO SHOW' } } }];
    pipe.push({
      $group: {
        _id: null,
        totalExpected: { $sum: '$billing.totalAmount' },
        totalReceived: { $sum: '$billing.amountReceived' },
        bookingCount: { $sum: 1 },
        avgTotal: { $avg: '$billing.totalAmount' },
        avgNights: { $avg: { $divide: [{ $subtract: ['$stay.checkOut', '$stay.checkIn'] }, 86400000] } },
      },
    });
    const [r] = await this.bookingModel.aggregate(pipe);
    return r
      ? { totalExpected: r.totalExpected, totalReceived: r.totalReceived, totalPending: r.totalExpected - r.totalReceived, bookingCount: r.bookingCount, avgTotal: Math.round(r.avgTotal), avgNights: Math.round(r.avgNights * 10) / 10 }
      : { totalExpected: 0, totalReceived: 0, totalPending: 0, bookingCount: 0, avgTotal: 0, avgNights: 0 };
  }

  // ── 2. revenue by cycle (ciclo fiscal 18→18) ──
  private async revenueByMonth(match: Record<string, any>) {
    const pipe: any[] = [
      { $match: { ...match, 'billing.status': { $ne: 'NO SHOW' } } },
      {
        $project: {
          checkIn: '$stay.checkIn',
          pending: { $subtract: ['$billing.totalAmount', '$billing.amountReceived'] },
          received: '$billing.amountReceived',
        },
      },
      { $sort: { checkIn: 1 } },
    ];
    const bookings = await this.bookingModel.aggregate(pipe);

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const cycleOf = (d: Date) => {
      const m = d.getUTCMonth();
      const y = d.getUTCFullYear();
      if (d.getUTCDate() < 18) {
        const fromM = m === 0 ? 11 : m - 1;
        const fromY = m === 0 ? y - 1 : y;
        const toM = m;
        return { key: `${fromY}-${String(fromM).padStart(2, '0')}`, label: `${monthNames[fromM]} 18 - ${monthNames[toM]} 18`, sort: fromY * 12 + fromM };
      }
      const toM = m === 11 ? 0 : m + 1;
      const toY = m === 11 ? y + 1 : y;
      return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${monthNames[m]} 18 - ${monthNames[toM]} 18`, sort: y * 12 + m };
    };

    const map = new Map<string, { label: string; sort: number; pending: number; received: number; count: number }>();
    for (const b of bookings) {
      const { key, label, sort } = cycleOf(new Date(b.checkIn));
      if (!map.has(key)) map.set(key, { label, sort, pending: 0, received: 0, count: 0 });
      const entry = map.get(key)!;
      entry.pending += b.pending;
      entry.received += b.received;
      entry.count += 1;
    }

    return Array.from(map.values())
      .sort((a, b) => a.sort - b.sort)
      .map(r => ({ month: r.label, pending: r.pending, received: r.received, count: r.count }));
  }

  // ── 3. platform distribution ──
  private async platformDistribution(match: Record<string, any>) {
    const pipe: any[] = [{ $match: { ...match } }];
    pipe.push({ $group: { _id: '$billing.platform', total: { $sum: '$billing.totalAmount' }, count: { $sum: 1 } } });
    pipe.push({ $sort: { total: -1 } });
    return this.bookingModel.aggregate(pipe).then(rows =>
      rows.map(r => ({ platform: r._id || 'Desconocido', total: r.total, count: r.count })),
    );
  }

  // ── 4. payment method distribution ──
  private async paymentMethodDistribution(match: Record<string, any>) {
    const pipe: any[] = [{ $match: { ...match } }];
    pipe.push({ $group: { _id: '$billing.paymentMethod', total: { $sum: '$billing.totalAmount' }, count: { $sum: 1 } } });
    pipe.push({ $sort: { total: -1 } });
    return this.bookingModel.aggregate(pipe).then(rows =>
      rows.map(r => ({ method: r._id || 'Ninguno', total: r.total, count: r.count })),
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
    return rows.map(r => ({ day: days[r._id - 1] || '?', count: r.count, revenue: r.revenue }));
  }

  // ── 6. guests by country (host + members) ──
  private async guestsByCountry(match: Record<string, any>) {
    const pipe: any[] = [
      { $match: match },
      { $addFields: {
        guestCount: { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] },
        revenuePerGuest: { $divide: ['$billing.totalAmount', { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] }] },
        hostLoc: { $cond: [{ $ifNull: ['$group.host.location.countryCode', false] }, ['$group.host.location'], []] },
      }},
      { $addFields: {
        allGuestLocations: { $concatArrays: ['$hostLoc', { $ifNull: ['$group.members.location', []] }] },
      }},
      { $unwind: '$allGuestLocations' },
      { $match: { 'allGuestLocations.countryCode': { $ne: '' } } },
      { $group: {
        _id: '$allGuestLocations.countryCode',
        countryName: { $first: '$allGuestLocations.countryName' },
        guests: { $sum: 1 },
        revenue: { $sum: '$revenuePerGuest' },
      }},
      { $sort: { guests: -1 } },
    ];
    return this.bookingModel.aggregate(pipe).then(rows =>
      rows.filter(r => r._id).map(r => ({ code: r._id, name: r.countryName || r._id, guests: r.guests, revenue: Math.round(r.revenue) })),
    );
  }


  // ── 7. vacancy (unsold days) — ciclo fiscal 18→18 ──
  async vacancy(from?: string, to?: string) {
    const totalApts = await this.aptModel.countDocuments({ status: ApartmentStatus.ACTIVE });

    // Default: ciclo 18 del mes anterior → 18 del mes actual (o hoy si no llegó al 18)
    const now = new Date();
    const fDate = from ? new Date(from) : (() => {
      const d = new Date(now.getFullYear(), now.getMonth() - (now.getDate() < 18 ? 1 : 0), 18);
      return d;
    })();
    const tDate = to ? new Date(to) : (() => {
      const d = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 18 ? 1 : 0), 18);
      return d;
    })();

    // Single aggregation: expand each booking into individual days, count per date
    const daily = await this.bookingModel.aggregate([
      { $match: {
        'stay.checkIn':  { $lt: tDate },
        'stay.checkOut': { $gt: fDate },
        'billing.status': { $ne: 'NO SHOW' },
      }},
      { $addFields: {
        nights: { $range: [0, { $floor: {
          $divide: [{ $subtract: ['$stay.checkOut', '$stay.checkIn'] }, 86400000]
        } }] }
      }},
      { $unwind: '$nights' },
      { $addFields: {
        date: { $dateAdd: { startDate: '$stay.checkIn', unit: 'day', amount: '$nights' } }
      }},
      { $match: { date: { $gte: fDate, $lt: tDate } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        booked: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Build daily series with vacancy calculation
    const dayMap = new Map(daily.map(d => [d._id, d.booked]));
    const dailySeries: { date: string; booked: number; vacant: number }[] = [];
    let totalUnsoldDays = 0;
    let totalDaySlots = 0;

    for (let d = new Date(fDate); d < tDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const booked = dayMap.get(key) || 0;
      const vacant = totalApts - booked;
      dailySeries.push({ date: key, booked, vacant });
      totalUnsoldDays += vacant;
      totalDaySlots += totalApts;
    }

    // Monthly aggregation — agrupado por ciclo 18→18
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const cycleLabel = (d: Date) => {
      const m = d.getUTCMonth();
      const y = d.getUTCFullYear();
      if (d.getUTCDate() < 18) {
        const from = m === 0 ? 11 : m - 1;
        return `${monthNames[from]} 18 - ${monthNames[m]} 18`;
      }
      const to = m === 11 ? 0 : m + 1;
      return `${monthNames[m]} 18 - ${monthNames[to]} 18`;
    };
    const monthlyMap = new Map<string, { unsoldDays: number; availableDays: number; daysInCycle: number }>();
    for (const day of dailySeries) {
      const key = cycleLabel(new Date(day.date));
      if (!monthlyMap.has(key)) monthlyMap.set(key, { unsoldDays: 0, availableDays: 0, daysInCycle: 0 });
      const rec = monthlyMap.get(key)!;
      rec.unsoldDays += day.vacant;
      rec.availableDays += totalApts;
      rec.daysInCycle += 1;
    }
    const monthly = Array.from(monthlyMap.entries()).map(([label, v]) => ({
      label,
      unsoldDays: v.unsoldDays,
      availableDays: v.availableDays,
      vacancyPct: Math.round((v.unsoldDays / v.availableDays) * 100 * 10) / 10,
      daysInCycle: v.daysInCycle,
      avgUnsoldPerApt: Math.round(v.unsoldDays / totalApts),
      avgOccupiedPerApt: Math.round((v.availableDays - v.unsoldDays) / totalApts),
    })).sort((a, b) => a.label.localeCompare(b.label));

    const rangeDays = Math.floor((tDate.getTime() - fDate.getTime()) / 86400000);
    return {
      totalUnsoldDays,
      totalDaySlots,
      vacancyRate: totalDaySlots > 0 ? Math.round((totalUnsoldDays / totalDaySlots) * 100 * 10) / 10 : 0,
      avgUnsoldPerApt: totalApts > 0 ? Math.round(totalUnsoldDays / totalApts) : 0,
      avgOccupiedPerApt: totalApts > 0 ? Math.round((totalDaySlots - totalUnsoldDays) / totalApts) : 0,
      totalDaysInRange: rangeDays,
      totalApts,
      daily: dailySeries,
      monthly,
    };
  }

  // ── 13. region detail (departments/cities by country) ──
  async guestsByRegion(countryCode: string, groupBy?: string) {
    const match = { 'group.host.location.countryCode': countryCode };
    const pipe: any[] = [
      { $match: match },
      { $addFields: {
        guestCount: { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] },
        revenuePerGuest: { $divide: ['$billing.totalAmount', { $add: [1, { $size: { $ifNull: ['$group.members', []] } }] }] },
        hostLoc: { $cond: [{ $ifNull: ['$group.host.location.countryCode', false] }, ['$group.host.location'], []] },
      }},
      { $addFields: {
        allGuestLocations: { $concatArrays: ['$hostLoc', { $ifNull: ['$group.members.location', []] }] },
      }},
      { $unwind: '$allGuestLocations' },
      { $match: { 'allGuestLocations.countryCode': countryCode, 'allGuestLocations.department': { $ne: '' } } },
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
      return rows.map(r => ({ department: r._id, guests: r.guests, revenue: Math.round(r.revenue) }));
    }

    pipe.push({
      $group: {
        _id: { department: '$allGuestLocations.department', city: '$allGuestLocations.city' },
        guests: { $sum: 1 },
        revenue: { $sum: '$revenuePerGuest' },
      },
    });
    pipe.push({ $sort: { guests: -1 } });
    const rows = await this.bookingModel.aggregate(pipe);
    return rows
      .filter(r => r._id.department)
      .map(r => ({ department: r._id.department, city: r._id.city || '—', guests: r.guests, revenue: Math.round(r.revenue) }));
  }
}
