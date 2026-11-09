import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth';
import { DevOnlyGuard } from './dev-only.guard';
import { TrackerService } from './tracker.service';
import { CompetitorsService } from './competitors.service';
import { QuoteDto } from './dto/quote.dto';
import { CreateCompetitorDto, UpdateCompetitorDto } from './dto/competitor.dto';
import { BookingSearchDto } from './dto/booking-search.dto';
import { TrackerChatDto } from './dto/tracker-chat.dto';
import { BookingProvider } from './providers/booking.provider';
import { TrackerAnalysisService } from './tracker-analysis.service';

// Primero el entorno: en producción el módulo ni siquiera pide JWT.
@UseGuards(DevOnlyGuard, JwtAuthGuard)
@Controller('tracker')
export class TrackerController {
  constructor(
    private readonly tracker: TrackerService,
    private readonly competitors: CompetitorsService,
    private readonly booking: BookingProvider,
    private readonly analysis: TrackerAnalysisService,
  ) {}

  @Post('booking-search')
  bookingSearch(@Body() dto: BookingSearchDto) {
    return this.booking.search(dto);
  }

  @Post('chat')
  chat(@Body() dto: TrackerChatDto) {
    return this.analysis.chat(dto);
  }

  @Get('config')
  config() {
    return this.competitors.settings();
  }

  @Get('competitors')
  list() {
    return this.competitors.findAll();
  }

  @Post('competitors')
  create(@Body() dto: CreateCompetitorDto) {
    return this.competitors.create(dto);
  }

  @Patch('competitors/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCompetitorDto) {
    return this.competitors.update(id, dto);
  }

  @Delete('competitors/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.competitors.remove(id);
  }

  @Post('quote')
  quote(@Body() dto: QuoteDto) {
    return this.tracker.quote(dto);
  }

  @Get('quotes')
  quotes(@Query('limit') limit?: string) {
    return this.tracker.recentQuotes(Number(limit ?? 10));
  }
}
