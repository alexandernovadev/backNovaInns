import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.dashboard(from, to);
  }

  @Get('regions')
  regions(@Query('country') country: string, @Query('groupBy') groupBy?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.guestsByRegion(country, groupBy, from, to);
  }

  @Get('vacancy')
  vacancy(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.vacancy(from, to);
  }
}
