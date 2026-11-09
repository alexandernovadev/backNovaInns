import { Injectable } from '@nestjs/common';
import {
  CompetitorLike,
  NightRate,
  ProviderResult,
  QuoteInput,
  TrackerProvider,
} from './provider.interface';
import { nightsBetween } from '../geo.util';

// Competidores de ejemplo para que la pantalla se pueda ver sin configurar
// scraping. Se marcan como synthetic y la UI muestra el aviso de "modo demo".
const DEMO_COMPETITORS: CompetitorLike[] = [
  {
    name: 'Apto Centro Histórico',
    platform: 'Airbnb',
    url: 'https://www.airbnb.com/rooms/demo-centro',
    lat: 5.0261,
    lng: -74.0042,
  },
  {
    name: 'Loft Parque Principal',
    platform: 'Booking',
    url: 'https://www.booking.com/hotel/co/demo-parque.html',
    lat: 5.0234,
    lng: -74.0031,
  },
  {
    name: 'Suite Catedral',
    platform: 'Airbnb',
    url: 'https://www.airbnb.com/rooms/demo-catedral',
    lat: 5.0213,
    lng: -74.0062,
  },
  {
    name: 'Apartamento La Esperanza',
    platform: 'Booking',
    url: 'https://www.booking.com/hotel/co/demo-esperanza.html',
    lat: 5.0302,
    lng: -74.0014,
  },
  {
    name: 'Casa Norte Zipaquirá',
    platform: 'Airbnb',
    url: 'https://www.airbnb.com/rooms/demo-norte',
    lat: 5.0348,
    lng: -74.0101,
  },
  {
    name: 'Estudio Las Salinas',
    platform: 'Booking',
    url: 'https://www.booking.com/hotel/co/demo-salinas.html',
    lat: 5.0181,
    lng: -74.0023,
  },
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

@Injectable()
export class DemoProvider implements TrackerProvider {
  readonly platform = 'Demo';

  syntheticCompetitors(): CompetitorLike[] {
    return DEMO_COMPETITORS.map((c) => ({ ...c }));
  }

  quote(
    input: QuoteInput,
    competitor: CompetitorLike,
  ): Promise<ProviderResult> {
    const base = 150000 + (hash(competitor.name) % 80000);
    const minStay = 1 + (hash(`${competitor.name}|min`) % 3);
    const nights: NightRate[] = nightsBetween(
      input.checkIn,
      input.checkOut,
    ).map((date) => {
      const seed = hash(`${competitor.name}|${date}`);
      const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
      const weekend = day === 5 || day === 6 ? 1.18 : 1;
      const jitter = 0.9 + (seed % 21) / 100;
      const price = Math.round((base * weekend * jitter) / 1000) * 1000;
      const available = seed % 10 < 7;
      return { date, price, available, minStay };
    });

    const prices = nights
      .filter((n) => n.available && n.price != null)
      .map((n) => n.price as number);
    const avgNightly = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;

    return Promise.resolve({
      competitorId: competitor._id ? String(competitor._id) : undefined,
      competitorName: competitor.name,
      platform: competitor.platform,
      url: competitor.url,
      synthetic: true,
      status: 'ok',
      nights,
      avgNightly,
      available: nights.length > 0 && nights.every((n) => n.available),
      minStay,
      source: 'demo',
      raw: {
        demo: true,
        competitor: competitor.name,
        generatedAt: new Date().toISOString(),
        nights,
      },
    });
  }
}
