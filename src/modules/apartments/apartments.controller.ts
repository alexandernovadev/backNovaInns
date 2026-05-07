import {
  Body, Controller, Delete, Get, HttpCode, Param,
  Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import type { ApartmentQuery } from './apartments.service';
import { JwtAuthGuard } from '../auth';
import { ApartmentStatus } from '../../shared/enums';

@UseGuards(JwtAuthGuard)
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Post()
  create(@Body() body: any) {
    return this.apartmentsService.create(body);
  }

  @Get()
  findAll(@Query() query: ApartmentQuery) {
    return this.apartmentsService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.apartmentsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.apartmentsService.update(id, body);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: ApartmentStatus) {
    return this.apartmentsService.setStatus(id, status);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.apartmentsService.remove(id);
  }

  // --- Photos ---
  @Post(':id/photos')
  addPhoto(@Param('id') id: string, @Body() body: { url: string; publicId: string; caption?: string }) {
    return this.apartmentsService.addPhoto(id, body);
  }

  @Delete(':id/photos')
  removePhoto(@Param('id') id: string, @Body('publicId') publicId: string) {
    return this.apartmentsService.removePhoto(id, publicId);
  }
}
