import { Injectable } from '@nestjs/common';
import { DemoProvider } from './demo.provider';
import { AirbnbProvider } from './airbnb.provider';
import { BookingProvider } from './booking.provider';
import { TrackerProvider } from './provider.interface';

@Injectable()
export class TrackerProviderRegistry {
  constructor(
    private readonly demo: DemoProvider,
    private readonly airbnb: AirbnbProvider,
    private readonly booking: BookingProvider,
  ) {}

  get(platform: string): TrackerProvider {
    if (platform === 'Airbnb') return this.airbnb;
    if (platform === 'Booking') return this.booking;
    return this.demo;
  }

  get demoProvider(): DemoProvider {
    return this.demo;
  }
}
