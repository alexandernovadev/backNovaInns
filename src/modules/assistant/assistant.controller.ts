import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
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
import { NovaAiConversations } from './nova-ai.conversations';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { Role } from '../../shared/enums';

const imageFilter = (_: any, file: Express.Multer.File, cb: any) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new BadRequestException('Solo se permiten imágenes'), false);
  }
  cb(null, true);
};

const userIdOf = (req: Request) => {
  const { userId } = (req.user ?? {}) as { userId?: string };
  if (!userId) throw new UnauthorizedException();
  return userId;
};

// NovaAI es solo para SUPER_ADMIN: lee todo el negocio y propone cambios
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly novaAiService: NovaAiService,
    private readonly proposals: NovaAiProposals,
    private readonly conversations: NovaAiConversations,
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
   * POST /api/assistant/chat-image
   * multipart: file (screenshot de Booking / AirBnB), hint y conversationId (opcionales)
   * Lee la reserva y devuelve una propuesta "Crear reserva" con la misma forma que /chat.
   * En la conversación se guarda solo el texto, nunca la imagen
   */
  @Post('chat-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: imageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async chatImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('hint') hint: string | undefined,
    @Body('conversationId') conversationId: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Falta la imagen (campo "file")');
    const userId = userIdOf(req);
    // Valida que la conversación exista antes de gastar la lectura con IA
    if (conversationId)
      await this.conversations.history(conversationId, userId, '-');
    const { booking, model } = await this.assistantService.extractBooking(
      file,
      hint,
    );
    const card = await this.proposals.proposeCreate(
      booking,
      hint?.trim()
        ? `📷 Screenshot · ${hint.trim()}`
        : '📷 Screenshot de reserva',
      userId,
    );
    const b = booking as {
      group?: { host?: { fullName?: string } };
      stay?: { checkIn?: string; checkOut?: string };
      billing?: { platform?: string };
    };
    const lines = [
      `Leí la reserva de **${b.group?.host?.fullName || 'un huésped'}**, del ${b.stay?.checkIn ?? '?'} al ${b.stay?.checkOut ?? '?'} por ${b.billing?.platform ?? '?'}.`,
      ...card.warnings.map((w) => `⚠️ ${w}`),
      'Revisa los datos, elige el apartamento en la tarjeta y confirma para crearla.',
    ];
    const result = {
      reply: lines.join('\n\n'),
      model,
      queries: ['screenshot (lectura con IA)'],
      actions: [card],
    };
    const userText = hint?.trim()
      ? `📷 ${hint.trim()}`
      : '📷 Screenshot de reserva';
    const id = await this.conversations.append(
      conversationId,
      userId,
      userText,
      result,
    );
    return { ...result, conversationId: id };
  }

  /**
   * POST /api/assistant/chat
   * body: { text, conversationId?, trackerContext? }. El historial sale de la
   * conversación guardada; sin conversationId se crea una nueva. Pregunta y
   * respuesta se guardan solo si NovaAI respondió (reintentar no duplica)
   */
  @Post('chat')
  async chat(
    @Body('text') rawText: unknown,
    @Body('conversationId') conversationId: string | undefined,
    @Body('trackerContext') trackerContext: Record<string, unknown> | undefined,
    @Req() req: Request,
  ) {
    const userId = userIdOf(req);
    const text = this.conversations.validateText(rawText);
    const messages = await this.conversations.history(
      conversationId,
      userId,
      text,
    );
    const result = await this.novaAiService.chat(
      messages,
      userId,
      trackerContext ?? null,
    );
    const id = await this.conversations.append(
      conversationId,
      userId,
      text,
      result,
    );
    return { ...result, conversationId: id };
  }

  /** GET /api/assistant/conversations — las del usuario, la más reciente primero */
  @Get('conversations')
  listConversations(@Req() req: Request) {
    return this.conversations.list(userIdOf(req));
  }

  /** GET /api/assistant/conversations/:id — mensajes con sus tarjetas al día */
  @Get('conversations/:id')
  getConversation(@Param('id') id: string, @Req() req: Request) {
    return this.conversations.get(id, userIdOf(req));
  }

  /** PATCH /api/assistant/conversations/:id — body { title } */
  @Patch('conversations/:id')
  renameConversation(
    @Param('id') id: string,
    @Body('title') title: unknown,
    @Req() req: Request,
  ) {
    return this.conversations.rename(id, userIdOf(req), title);
  }

  /** DELETE /api/assistant/conversations/:id — no toca las propuestas ni su historial */
  @Delete('conversations/:id')
  deleteConversation(@Param('id') id: string, @Req() req: Request) {
    return this.conversations.remove(id, userIdOf(req));
  }

  /** POST /api/assistant/actions/:id/confirm — ejecuta una propuesta de NovaAI */
  @Post('actions/:id/confirm')
  confirmAction(
    @Param('id') id: string,
    @Body('apartmentId') apartmentId: string | undefined,
    @Req() req: Request,
  ) {
    const { userId } = (req.user ?? {}) as { userId?: string };
    return this.proposals.confirm(id, userId ?? null, { apartmentId });
  }

  /** GET /api/assistant/actions?filter=applied|undone|other&page&limit — historial */
  @Get('actions')
  listActions(
    @Query('filter') filter?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.proposals.list({ filter, page, limit });
  }

  /** POST /api/assistant/actions/:id/undo — body { force?: boolean } */
  @Post('actions/:id/undo')
  undoAction(
    @Param('id') id: string,
    @Body('force') force: unknown,
    @Req() req: Request,
  ) {
    const { userId } = (req.user ?? {}) as { userId?: string };
    return this.proposals.undo(id, userId ?? null, force === true);
  }

  /** POST /api/assistant/actions/:id/cancel — descarta una propuesta de NovaAI */
  @Post('actions/:id/cancel')
  cancelAction(@Param('id') id: string) {
    return this.proposals.cancel(id);
  }
}
