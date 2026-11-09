import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser } from 'playwright-core';

// Un solo Chromium por consulta: los providers de Airbnb y Booking comparten
// el navegador y el servicio lo cierra al terminar la corrida.
@Injectable()
export class TrackerBrowser {
  private readonly logger = new Logger(TrackerBrowser.name);
  private browser: Browser | null = null;

  constructor(private readonly config: ConfigService) {}

  async get(): Promise<Browser> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException(
        'El Tracker de Booking solo está habilitado en entorno de desarrollo.',
      );
    }
    if (this.browser?.isConnected()) return this.browser;

    let chromium: typeof import('playwright-core').chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      throw new ServiceUnavailableException(
        'playwright-core no está instalado. Ejecuta `pnpm add playwright-core`.',
      );
    }

    const executablePath = this.config.get<string>('TRACKER_CHROME_PATH');
    const channel =
      this.config.get<string>('TRACKER_CHROME_CHANNEL') ?? 'chrome';
    const headless = this.config.get<string>('TRACKER_HEADLESS') === 'true';

    try {
      this.browser = await chromium.launch({
        headless,
        ...(executablePath ? { executablePath } : { channel }),
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--window-position=-2400,-2400',
        ],
      });
      return this.browser;
    } catch (err) {
      this.logger.error(`No se pudo abrir Chromium: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'No se pudo abrir Chromium para el Tracker. Revisa TRACKER_CHROME_PATH / TRACKER_CHROME_CHANNEL.',
      );
    }
  }

  async dispose(): Promise<void> {
    if (!this.browser) return;
    try {
      await this.browser.close();
    } catch {
      // el navegador ya estaba cerrado
    }
    this.browser = null;
  }
}
