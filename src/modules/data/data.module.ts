import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { Booking, BookingSchema } from '../bookings';
import { Apartment, ApartmentSchema } from '../apartments';

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
