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

const AVAILABILITY_QUERY = `query AvailabilityCalendar($input: AvailabilityCalendarQueryInput!) {
  availabilityCalendar(input: $input) {
    ... on AvailabilityCalendarQueryResult {
      hotelId
      days { available avgPriceFormatted checkin minLengthOfStay __typename }
      __typename
    }
    ... on AvailabilityCalendarQueryError { message __typename }
    __typename
  }
}`;

function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.round(value);
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

// Forma mínima de la respuesta de AvailabilityCalendar que consulta este
// provider; el resto del payload se guarda crudo en raw-capture.
interface BookingCalendarDay {
  checkin?: string;
  available?: boolean;
  avgPriceFormatted?: string;
  minLengthOfStay?: number;
}

interface BookingCalendarResponse {
  data?: {
    availabilityCalendar?: {
      days?: BookingCalendarDay[];
    };
  };
}

@Injectable()
export class BookingProvider implements TrackerProvider {
  readonly platform = 'Booking';
  private readonly logger = new Logger(BookingProvider.name);

  constructor(private readonly browser: TrackerBrowser) {}

  keepAlive(): void {
    this.browser.keepAlive();
  }

  async search(input: {
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    childAge: number;
  }) {
    const params = new URLSearchParams({
      ss: 'Zipaquirá',
      ssne: 'Zipaquirá',
      ssne_untouched: 'Zipaquirá',
      efdco: '1',
      aid: '304142',
      lang: 'es',
      sb: '1',
      src_elem: 'sb',
      src: 'searchresults',
      dest_id: '-601831',
      dest_type: 'city',
      checkin: input.checkIn,
      checkout: input.checkOut,
      group_adults: String(input.adults),
      no_rooms: '1',
      group_children: String(input.children),
      ...(input.children > 0 ? { age: String(input.childAge) } : {}),
      selected_currency: 'COP',
      order: 'price',
    });
    const browser = await this.browser.get();
    const context = await browser.newContext({
      locale: 'es-CO',
      timezoneId: 'America/Bogota',
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      await page.goto(
        `https://www.booking.com/searchresults.es.html?${params}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      );
      await page
        .waitForSelector('[data-testid="property-card"]', { timeout: 25000 })
        .catch(() => null);

      // Total declarado por Booking en el H1 ("Zipaquirá: 27 alojamientos encontrados")
      const headerText = await page
        .locator('h1')
        .first()
        .textContent()
        .catch(() => '');
      const expectedMatch = /(\d+)\s+alojamientos?/i.exec(headerText ?? '');
      const expectedTotal = expectedMatch ? Number(expectedMatch[1]) : 0;

      // Barrido determinista: baja hasta la última tarjeta, pulsa "Cargar más"
      // si aparece, y repite hasta alcanzar expectedTotal o 3 pasadas sin crecer.
      let prevCount = 0;
      let stableRounds = 0;
      for (let round = 0; round < 25; round++) {
        await page.evaluate(() => {
          const cards = document.querySelectorAll(
            '[data-testid="property-card"]',
          );
          const last = cards[cards.length - 1];
          if (last) last.scrollIntoView({ behavior: 'instant', block: 'end' });
          window.scrollBy(0, 1200);
        });
        await page.waitForTimeout(750);

        const loadMore = page
          .locator(
            'button:has-text("Cargar más"), button:has-text("Mostrar más")',
          )
          .first();
        if (await loadMore.isVisible().catch(() => false)) {
          await loadMore.click().catch(() => null);
          await page.waitForTimeout(900);
        }

        const count = await page
          .locator('[data-testid="property-card"]')
          .count();
        if (expectedTotal > 0 && count >= expectedTotal) break;
        if (count === prevCount) {
          stableRounds++;
          if (stableRounds >= 3) break;
        } else {
          stableRounds = 0;
          prevCount = count;
        }
      }

      const raw = await page
        .locator('[data-testid="property-card"]')
        .evaluateAll((cards) =>
          cards.map((card) => {
            const title =
              card
                .querySelector('[data-testid="title"]')
                ?.textContent?.trim() ?? 'Alojamiento';
            const href =
              card.querySelector<HTMLAnchorElement>(
                'a[data-testid="title-link"], a',
              )?.href ?? '';
            const image =
              card.querySelector<HTMLImageElement>(
                'img[data-testid="image"], img',
              )?.src ?? '';
            const priceBox =
              card
                .querySelector('[data-testid="price-and-discounted-price"]')
                ?.textContent?.trim() ?? '';
            const taxesBox =
              card
                .querySelector('[data-testid="taxes-and-charges"]')
                ?.textContent?.trim() ?? '';
            const distance =
              card
                .querySelector('[data-testid="distance"]')
                ?.textContent?.trim() ?? '';
            const reviewText =
              (
                card.querySelector(
                  '[data-testid="review-score"]',
                ) as HTMLElement | null
              )?.innerText?.trim() ?? '';
            const secondaryScore =
              card
                .querySelector('[data-testid="secondary-review-score-link"]')
                ?.textContent?.trim() ?? '';
            const unitConfig =
              card
                .querySelector(
                  '[data-testid="property-card-unit-configuration"]',
                )
                ?.textContent?.trim() ?? '';
            const recText =
              (
                card.querySelector(
                  '[data-testid="recommended-units"]',
                ) as HTMLElement | null
              )?.innerText?.trim() ?? '';
            return {
              title,
              href,
              image,
              priceBox,
              taxesBox,
              distance,
              reviewText,
              secondaryScore,
              unitConfig,
              recText,
            };
          }),
        );

      const seen = new Set<string>();
      const results = raw
        .map((r) => {
          const prices = [...r.priceBox.matchAll(/COP\s*([\d.]+)/g)].map((m) =>
            Number(m[1].replace(/\./g, '')),
          );
          const price = prices[prices.length - 1] ?? null;
          const taxMatch = /COP\s*([\d.]+)/.exec(r.taxesBox);
          const taxesIncluded = /incluye/i.test(r.taxesBox);
          const taxes = taxMatch
            ? Number(taxMatch[1].replace(/\./g, ''))
            : taxesIncluded
              ? 0
              : null;
          const total = price != null ? price + (taxes ?? 0) : null;
          const slug = r.href.split('?')[0];

          // Puntaje y reseñas ("Puntuación: 9,4\n9,4\nFantástico\n204 comentarios")
          const scoreMatch = /(\d+(?:[.,]\d+)?)/.exec(r.reviewText);
          const score = scoreMatch
            ? Number(scoreMatch[1].replace(',', '.'))
            : null;
          const revCountMatch = /(\d+)\s+comentarios?/i.exec(r.reviewText);
          const reviewsCount = revCountMatch ? Number(revCountMatch[1]) : null;
          const revLines = r.reviewText
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean);
          const reviewLabel =
            revLines.find(
              (l) =>
                !/^puntuaci[oó]n/i.test(l) &&
                !/^\d+([.,]\d+)?$/.test(l) &&
                !/comentarios?/i.test(l),
            ) ?? '';

          // Desglose de lines de recommended-units (con saltos reales gracias a innerText)
          const recLines = r.recText
            .split(/\n+/)
            .map((l) => l.trim())
            .filter((l) => l && !/^recomendado para tu grupo$/i.test(l));

          const breakfastIncluded = recLines.some((l) => /desayuno/i.test(l));
          const freeCancellation = recLines.some((l) =>
            /cancelaci[oó]n gratis/i.test(l),
          );
          const noPrepayment = recLines.some((l) =>
            /sin pago por adelantado|pagar[aá]s en el alojamiento/i.test(l),
          );

          const policyRe =
            /desayuno|cancelaci[oó]n|sin pago por adelantado|pagar[aá]s en el alojamiento/i;
          const contentLines = recLines.filter((l) => !policyRe.test(l));
          const unitType = contentLines[0] ?? '';
          const beds =
            contentLines.find(
              (l, idx) =>
                idx > 0 &&
                /\bcama|\blitera|\bsof[aá]|\bdoble|\bindividual/i.test(l),
            ) ?? '';

          return {
            name: r.title,
            url: r.href,
            slug,
            image: r.image,
            distance: r.distance,
            score,
            reviewLabel,
            reviewsCount,
            secondaryScore: r.secondaryScore,
            unitType,
            unitConfig: r.unitConfig,
            beds,
            breakfastIncluded,
            freeCancellation,
            noPrepayment,
            room: recLines.join(' · '),
            price,
            taxes,
            taxesIncluded,
            total,
          };
        })
        .filter((r) => {
          if (seen.has(r.slug)) return false;
          seen.add(r.slug);
          return true;
        });

      return {
        destination: 'Zipaquirá',
        ...input,
        expectedTotal: expectedTotal || results.length,
        sweepComplete: expectedTotal === 0 || results.length >= expectedTotal,
        totalResults: results.length,
        results,
      };
    } finally {
      await context.close();
      // No se cierra el navegador: es compartido con las cotizaciones en curso
      this.browser.keepAlive();
    }
  }

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
      source: 'booking_graphql',
    };

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

      const response = await page.goto(competitor.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      const html = await page.content();
      const blocked =
        response?.status() === 403 ||
        response?.status() === 429 ||
        /captcha|access denied|unusual traffic/i.test(page.url()) ||
        /captcha|access denied|unusual traffic|robot/i.test(
          html.slice(0, 5000),
        );

      if (blocked) {
        return {
          ...base,
          status: 'blocked',
          error: 'Booking bloqueó la consulta (captcha o 403/429)',
          raw: { blocked: true, url: page.url() },
        };
      }

      const country = /hotelCountry:\s*"([^"]+)"/.exec(html)?.[1];
      const hotelName = /hotelName:\s*"([^"]+)"/.exec(html)?.[1];
      const csrf = /b_csrf_token:\s*['"]([^'"]+)['"]/.exec(html)?.[1];

      if (!country || !hotelName || !csrf) {
        return {
          ...base,
          status: 'error',
          error:
            'No se pudieron leer los datos de Booking (país, hotel o token CSRF)',
          raw: {
            url: page.url(),
            hasCountry: !!country,
            hasHotel: !!hotelName,
            hasCsrf: !!csrf,
          },
        };
      }

      const payload = await page.evaluate(
        async ({
          query,
          countryCode,
          pagename,
          token,
          checkIn,
          days,
          guests,
        }) => {
          const body = {
            operationName: 'AvailabilityCalendar',
            variables: {
              input: {
                travelPurpose: 2,
                pagenameDetails: { countryCode, pagename },
                searchConfig: {
                  searchConfigDate: { startDate: checkIn, amountOfDays: days },
                  nbAdults: guests,
                  nbRooms: 1,
                },
              },
            },
            extensions: {},
            query,
          };
          const res = await fetch('/dml/graphql?lang=es', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-booking-csrf-token': token,
            },
            body: JSON.stringify(body),
            credentials: 'include',
          });
          return { status: res.status, text: await res.text() };
        },
        {
          query: AVAILABILITY_QUERY,
          countryCode: country,
          pagename: hotelName,
          token: csrf,
          checkIn: input.checkIn,
          days: Math.max(1, input.nights),
          guests: input.guests,
        },
      );

      if (payload.status === 403 || payload.status === 429) {
        return {
          ...base,
          status: 'blocked',
          error: `Booking respondió ${payload.status} al pedir el calendario`,
          raw: { status: payload.status },
        };
      }

      let json: BookingCalendarResponse | null = null;
      try {
        json = JSON.parse(payload.text) as BookingCalendarResponse;
      } catch {
        return {
          ...base,
          status: 'error',
          error: 'Booking no devolvió JSON en AvailabilityCalendar',
          raw: { status: payload.status, body: payload.text.slice(0, 500) },
        };
      }

      const days: BookingCalendarDay[] =
        json?.data?.availabilityCalendar?.days ?? [];
      const wanted = new Set(nightsBetween(input.checkIn, input.checkOut));
      const byDate = new Map<string, BookingCalendarDay>(
        days.flatMap((d) =>
          d.checkin && wanted.has(d.checkin) ? [[d.checkin, d] as const] : [],
        ),
      );

      const nights: NightRate[] = [...wanted].map((date) => {
        const day = byDate.get(date);
        const price = parseMoney(day?.avgPriceFormatted);
        return {
          date,
          price,
          available: day ? day.available !== false : false,
          minStay: day?.minLengthOfStay,
        };
      });

      const prices = nights
        .filter((n) => n.available && n.price != null)
        .map((n) => n.price as number);
      const avgNightly = prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : null;

      const minStays = nights
        .map((n) => n.minStay)
        .filter((n) => typeof n === 'number');
      const minStay = minStays.length ? Math.max(...minStays) : undefined;

      return {
        ...base,
        status: days.length ? 'ok' : 'error',
        nights,
        avgNightly,
        available: nights.length > 0 && nights.every((n) => n.available),
        minStay,
        error: days.length
          ? undefined
          : 'Booking no devolvió días para el rango consultado',
        raw: {
          availabilityCalendar: json?.data?.availabilityCalendar ?? null,
          meta: { country, hotelName },
        },
      };
    } catch (err) {
      this.logger.warn(`Booking ${competitor.name}: ${(err as Error).message}`);
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
