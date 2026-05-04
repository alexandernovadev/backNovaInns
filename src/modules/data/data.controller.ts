import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { DataService } from './data.service';
import { JwtAuthGuard } from '../auth';

@UseGuards(JwtAuthGuard)
@Controller('data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  // ── EXPORT ──────────────────────────────────────────────
  @Get('export/bookings')
  exportBookings() {
    return this.dataService.exportBookings();
  }

  @Get('export/apartments')
  exportApartments() {
    return this.dataService.exportApartments();
  }

  // ── IMPORT ──────────────────────────────────────────────
  @Post('import/bookings')
  @HttpCode(200)
  importBookings(@Body() body: { records: any[] }) {
    return this.dataService.importBookings(body.records);
  }

  @Post('import/apartments')
  @HttpCode(200)
  importApartments(@Body() body: { records: any[] }) {
    return this.dataService.importApartments(body.records);
  }
}
