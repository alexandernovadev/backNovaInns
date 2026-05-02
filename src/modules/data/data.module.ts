import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Apartment, ApartmentSchema } from '../apartments/schemas/apartment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name,   schema: BookingSchema   },
      { name: Apartment.name, schema: ApartmentSchema },
    ]),
  ],
  controllers: [DataController],
  providers:   [DataService],
})
export class DataModule {}
