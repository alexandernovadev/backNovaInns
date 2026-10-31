import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BookingsService, type BookingFilters } from './bookings.service';
import { JwtAuthGuard } from '../auth';

@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@Body() body: any) {
    return this.bookingsService.create(body);
  }

  @Get()
  findAll(
    @Query()
    query: {
      search?: string;
      status?: string;
      platform?: string;
      apartmentId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.bookingsService.findAll(query);
  }

  @Get('calendar')
  findForCalendar(@Query('from') from?: string, @Query('to') to?: string) {
    return this.bookingsService.findForCalendar(from, to);
  }

  @Get('summary/financial')
  financialSummary(@Query() query: BookingFilters) {
    return this.bookingsService.financialSummary(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.bookingsService.update(id, body);
  }

  @Patch(':id/status')
  updateStayStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.bookingsService.updateStayStatus(id, status);
  }

  @Patch(':id/payment')
  registerPayment(@Param('id') id: string, @Body('amount') amount: number) {
    return this.bookingsService.registerPayment(id, amount);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bookingsService.remove(id);
  }
}
