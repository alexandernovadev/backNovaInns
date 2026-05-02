import {
  Body, Controller, Delete, Get, HttpCode, Param,
  Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import type { ApartmentQuery } from './apartments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly svc: ApartmentsService) {}

  @Post()
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Get()
  findAll(@Query() query: ApartmentQuery) {
    return this.svc.findAll(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE') {
    return this.svc.setStatus(id, status);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  // --- Photos ---
  @Post(':id/photos')
  addPhoto(@Param('id') id: string, @Body() body: { url: string; publicId: string; caption?: string }) {
    return this.svc.addPhoto(id, body);
  }

  @Delete(':id/photos')
  removePhoto(@Param('id') id: string, @Body('publicId') publicId: string) {
    return this.svc.removePhoto(id, publicId);
  }
}
