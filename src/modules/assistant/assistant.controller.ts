import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AssistantService } from './assistant.service';
import { JwtAuthGuard } from '../auth';

const imageFilter = (_: any, file: Express.Multer.File, cb: any) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new BadRequestException('Solo se permiten imágenes'), false);
  }
  cb(null, true);
};

@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  /**
   * POST /api/assistant/extract-booking
   * multipart: file (screenshot de Booking / AirBnB), hint (opcional)
   */
  @Post('extract-booking')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: imageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  extractBooking(
    @UploadedFile() file: Express.Multer.File,
    @Body('hint') hint?: string,
  ) {
    if (!file) throw new BadRequestException('Falta la imagen (campo "file")');
    return this.assistantService.extractBooking(file, hint);
  }
}
