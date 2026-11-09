import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrackerController } from './tracker.controller';
import { DevOnlyGuard } from './dev-only.guard';
import { TrackerService } from './tracker.service';
import { CompetitorsService } from './competitors.service';
import { TrackerAnalysisService } from './tracker-analysis.service';
import { TrackerBrowser } from './providers/tracker-browser';
import { DemoProvider } from './providers/demo.provider';
import { AirbnbProvider } from './providers/airbnb.provider';
import { BookingProvider } from './providers/booking.provider';
import { TrackerProviderRegistry } from './providers/provider.registry';
import { Competitor, CompetitorSchema } from './schemas/competitor.schema';
import { RawCapture, RawCaptureSchema } from './schemas/raw-capture.schema';
import {
  TrackerQuote,
  TrackerQuoteSchema,
} from './schemas/tracker-quote.schema';
import { Booking, BookingSchema } from '../bookings';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Competitor.name, schema: CompetitorSchema },
      { name: RawCapture.name, schema: RawCaptureSchema },
      { name: TrackerQuote.name, schema: TrackerQuoteSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [TrackerController],
  providers: [
    DevOnlyGuard,
    CompetitorsService,
    TrackerService,
    TrackerAnalysisService,
    TrackerBrowser,
    DemoProvider,
    AirbnbProvider,
    BookingProvider,
    TrackerProviderRegistry,
  ],
  exports: [TrackerService],
})
export class TrackerModule {}
