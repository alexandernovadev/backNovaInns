import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { AssistantService } from './assistant.service';
import { NovaAiService } from './nova-ai.service';
import { NovaAiProposals } from './nova-ai.proposals';
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
  constructor(
    private readonly assistantService: AssistantService,
    private readonly novaAiService: NovaAiService,
    private readonly proposals: NovaAiProposals,
  ) {}

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

  /**
   * POST /api/assistant/chat
   * body: { messages: [{ role: 'user' | 'model', text }] } — historial completo, último = user
   */
  @Post('chat')
  chat(@Body('messages') messages: unknown, @Req() req: Request) {
    const { userId } = (req.user ?? {}) as { userId?: string };
    return this.novaAiService.chat(messages, userId ?? null);
  }

  /** POST /api/assistant/actions/:id/confirm — ejecuta una propuesta de NovaAI */
  @Post('actions/:id/confirm')
  confirmAction(@Param('id') id: string, @Req() req: Request) {
    const { userId } = (req.user ?? {}) as { userId?: string };
    return this.proposals.confirm(id, userId ?? null);
  }

  /** POST /api/assistant/actions/:id/cancel — descarta una propuesta de NovaAI */
  @Post('actions/:id/cancel')
  cancelAction(@Param('id') id: string) {
    return this.proposals.cancel(id);
  }
}
