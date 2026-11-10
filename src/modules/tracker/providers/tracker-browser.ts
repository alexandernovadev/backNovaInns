import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser } from 'playwright-core';

// Un solo Chromium compartido por los providers de Airbnb y Booking. Se cierra
// por inactividad (no al terminar cada consulta): levantar el navegador cuesta
// 1-3 s y las cotizaciones suelen llegar en ráfaga.
const IDLE_CLOSE_MS = 120_000;

@Injectable()
export class TrackerBrowser implements OnModuleDestroy {
  private readonly logger = new Logger(TrackerBrowser.name);
  private browser: Browser | null = null;
  // Mutex: dos consultas concurrentes no deben lanzar dos Chromium
  private launching: Promise<Browser> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  async get(): Promise<Browser> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException(
        'El Tracker de Booking solo está habilitado en entorno de desarrollo.',
      );
    }

    this.clearIdle();
    if (this.browser?.isConnected()) return this.browser;

    this.launching ??= this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  // El navegador se queda vivo un rato y se cierra solo si nadie lo retoma
  keepAlive(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => void this.dispose(), IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  async dispose(): Promise<void> {
    this.clearIdle();
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    try {
      await browser.close();
    } catch {
      // el navegador ya estaba cerrado
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async launch(): Promise<Browser> {
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
}
