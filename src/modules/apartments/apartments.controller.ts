import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Post()
  create(@Body() body: any) {
    return this.apartmentsService.create(body);
  }

  @Get()
  findAll() {
    return this.apartmentsService.findAll();
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
  setStatus(@Param('id') id: string, @Body('status') status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE') {
    return this.apartmentsService.setStatus(id, status);
  }
}
