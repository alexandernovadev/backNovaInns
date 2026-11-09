import { Injectable, Logger } from '@nestjs/common';
import type { Browser, Page } from 'playwright-core';
import {
  CompetitorLike,
  NightRate,
  ProviderResult,
  QuoteInput,
  TrackerProvider,
} from './provider.interface';
import { TrackerBrowser } from './tracker-browser';
import { nightsBetween } from '../geo.util';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// Formas mínimas del JSON interno de Airbnb que este provider consulta.
// El resto del payload se ignora (se guarda crudo en raw-capture).
interface AirbnbCalendarDay {
  calendarDate?: string;
  available?: boolean;
  bookable?: boolean;
  minNights?: number;
  price?: {
    localPriceFormatted?: unknown;
    priceFormatted?: unknown;
    price?: unknown;
  };
}

interface AirbnbCalendarResponse {
  data?: {
    merlin?: {
      pdpAvailabilityCalendar?: {
        calendarMonths?: Array<{ days?: AirbnbCalendarDay[] }>;
      };
    };
  };
}

interface AirbnbPriceItem {
  label?: unknown;
  amount?: unknown;
}

interface AirbnbSectionsResponse {
  data?: {
    presentation?: {
      stayProductDetailPage?: {
        sections?: {
          sections?: Array<{
            sectionComponentType?: string;
            section?: {
              structuredDisplayPrice?: {
                primaryLine?: {
                  discountedPrice?: unknown;
                  price?: unknown;
                };
                explanationData?: {
                  priceDetails?: Array<{ items?: AirbnbPriceItem[] }>;
                };
              };
            };
          }>;
        };
      };
    };
  };
}

function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.round(value);
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function roomIdFrom(url: string, externalId?: string): string | null {
  if (externalId && /^\d+$/.test(externalId)) return externalId;
  return /\/rooms\/(\d+)/.exec(url)?.[1] ?? null;
}

@Injectable()
export class AirbnbProvider implements TrackerProvider {
  readonly platform = 'Airbnb';
  private readonly logger = new Logger(AirbnbProvider.name);

  constructor(private readonly browser: TrackerBrowser) {}

  async quote(
    input: QuoteInput,
    competitor: CompetitorLike,
  ): Promise<ProviderResult> {
    const base: ProviderResult = {
      competitorId: competitor._id ? String(competitor._id) : undefined,
      competitorName: competitor.name,
      platform: this.platform,
      url: competitor.url,
      status: 'error',
      nights: [],
      avgNightly: null,
      available: false,
      source: 'airbnb_calendar',
    };

    const roomId = roomIdFrom(competitor.url, competitor.externalId);
    if (!roomId) {
      return {
        ...base,
        error: 'URL de Airbnb sin ID de anuncio (/rooms/<id>)',
      };
    }

    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      browser = await this.browser.get();
      const context = await browser.newContext({
        locale: 'es-CO',
        timezoneId: 'America/Bogota',
        userAgent: UA,
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: { 'accept-language': 'es-CO,es;q=0.9' },
      });
      page = await context.newPage();

      const calendarPromise = page
        .waitForResponse((r) => r.url().includes('PdpAvailabilityCalendar'), {
          timeout: 30000,
        })
        .catch(() => null);
      const pricePromise = page
        .waitForResponse((r) => r.url().includes('StaysPdpSections'), {
          timeout: 30000,
        })
        .catch(() => null);

      const url =
        `https://www.airbnb.com.co/rooms/${roomId}` +
        `?check_in=${input.checkIn}&check_out=${input.checkOut}` +
        `&adults=${input.guests}&currency=COP&locale=es`;

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      const [calendarRes, priceRes] = await Promise.all([
        calendarPromise,
        pricePromise,
      ]);

      let bodyText = '';
      try {
        bodyText = (
          await page.locator('body').innerText({ timeout: 3000 })
        ).slice(0, 500);
      } catch {
        // la página pudo cerrarse antes de leer el body
      }
      const blocked =
        response?.status() === 403 ||
        response?.status() === 429 ||
        /captcha|access denied|unusual traffic/i.test(page.url()) ||
        /captcha|access denied|unusual traffic/i.test(bodyText);

      if (blocked) {
        return {
          ...base,
          status: 'blocked',
          error: 'Airbnb bloqueó la consulta (captcha o 403/429)',
          raw: { blocked: true, url: page.url() },
        };
      }

      const calendar = (await calendarRes
        ?.json()
        .catch(() => null)) as AirbnbCalendarResponse | null;
      const sections = (await priceRes
        ?.json()
        .catch(() => null)) as AirbnbSectionsResponse | null;

      const days: AirbnbCalendarDay[] =
        calendar?.data?.merlin?.pdpAvailabilityCalendar?.calendarMonths?.flatMap(
          (m) => m?.days ?? [],
        ) ?? [];

      const sectionList =
        sections?.data?.presentation?.stayProductDetailPage?.sections
          ?.sections ?? [];
      const bookIt = sectionList.find(
        (s) => s?.sectionComponentType === 'BOOK_IT_SIDEBAR',
      )?.section;

      const priceData = bookIt?.structuredDisplayPrice;
      const primary = priceData?.primaryLine;
      const total =
        parseMoney(primary?.discountedPrice) ?? parseMoney(primary?.price);

      const details: AirbnbPriceItem[] =
        priceData?.explanationData?.priceDetails?.flatMap(
          (g) => g?.items ?? [],
        ) ?? [];
      const nightlyLine = details.find((d) =>
        /noche|night/i.test(typeof d?.label === 'string' ? d.label : ''),
      );
      const nightlyFromBreakdown = parseMoney(nightlyLine?.amount);

      const avgNightly =
        nightlyFromBreakdown ??
        (total && input.nights > 0 ? Math.round(total / input.nights) : null);

      const byDate = new Map<string, AirbnbCalendarDay>(
        days.flatMap((d) =>
          d.calendarDate ? [[d.calendarDate, d] as const] : [],
        ),
      );
      const nights: NightRate[] = nightsBetween(
        input.checkIn,
        input.checkOut,
      ).map((date) => {
        const day = byDate.get(date);
        const available =
          day != null
            ? day.available !== false && day.bookable !== false
            : avgNightly != null;
        const dayPrice =
          parseMoney(day?.price?.localPriceFormatted) ??
          parseMoney(day?.price?.priceFormatted) ??
          parseMoney(day?.price?.price) ??
          avgNightly;
        return { date, price: available ? dayPrice : null, available };
      });

      const minStays = nights
        .map((n) => byDate.get(n.date)?.minNights)
        .filter((n) => typeof n === 'number');
      const minStay = minStays.length ? Math.max(...minStays) : undefined;

      const result: ProviderResult = {
        ...base,
        status: avgNightly || days.length ? 'ok' : 'error',
        nights,
        avgNightly,
        available: nights.length > 0 && nights.every((n) => n.available),
        minStay,
        error:
          avgNightly || days.length
            ? undefined
            : 'Airbnb no devolvió calendario ni precio para estas fechas',
        raw: { calendar, price: bookIt ?? null },
      };
      return result;
    } catch (err) {
      this.logger.warn(`Airbnb ${competitor.name}: ${(err as Error).message}`);
      return {
        ...base,
        status: 'error',
        error: (err as Error).message,
      };
    } finally {
      await page
        ?.context()
        .close()
        .catch(() => undefined);
    }
  }
}
