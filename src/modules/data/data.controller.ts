import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataService } from './data.service';
import type { ClearableModel } from './data.service';
import { JwtAuthGuard } from '../auth';
import { Role } from '../../shared/enums';

@UseGuards(JwtAuthGuard)
@Controller('data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  // ── COUNTS ─────────────────────────────────────────────
  @Get('counts')
  counts(@Req() req: Request) {
    this.requireSuperAdmin(req);
    return this.dataService.counts();
  }

  // ── CLEAR ──────────────────────────────────────────────
  @Delete('clear/:model')
  clear(@Param('model') model: ClearableModel, @Req() req: Request) {
    this.requireSuperAdmin(req);
    return this.dataService.clear(model);
  }

  private requireSuperAdmin(req: Request) {
    const { role } = req.user as { role: Role };
    if (role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede vaciar datos');
    }
  }

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
