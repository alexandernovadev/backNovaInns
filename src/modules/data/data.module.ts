import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { Booking, BookingSchema } from '../bookings';
import { Apartment, ApartmentSchema } from '../apartments';
import { Expense, ExpenseSchema } from '../expenses';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Apartment.name, schema: ApartmentSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
  ],
  controllers: [DataController],
  providers: [DataService],
})
export class DataModule {}
