import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@Body() body: any) {
    return this.bookingsService.create(body);
  }

  @Get()
  findAll(@Query() query: { search?: string; status?: string; platform?: string; page?: number; limit?: number }) {
    return this.bookingsService.findAll(query);
  }

  @Get('summary/financial')
  financialSummary() {
    return this.bookingsService.financialSummary();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.bookingsService.update(id, body);
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
