import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { NovaAiService } from './nova-ai.service';
import { NovaAiTools } from './nova-ai.tools';
import { NovaAiProposals } from './nova-ai.proposals';
import {
  AssistantAction,
  AssistantActionSchema,
} from './schemas/assistant-action.schema';
import { Booking, BookingSchema } from '../bookings';
import { Apartment, ApartmentSchema } from '../apartments';
import { Expense, ExpenseSchema } from '../expenses';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantAction.name, schema: AssistantActionSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Apartment.name, schema: ApartmentSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
  ],
  controllers: [AssistantController],
  providers: [AssistantService, NovaAiService, NovaAiTools, NovaAiProposals],
})
export class AssistantModule {}
