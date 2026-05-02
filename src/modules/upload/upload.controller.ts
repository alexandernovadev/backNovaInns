import {
  Controller, Post, Delete, Param, Query,
  UploadedFile, UseInterceptors, UseGuards, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService, UploadFolder } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const VALID_FOLDERS: UploadFolder[] = ['apartments', 'users', 'bookings'];

const imageFilter = (_: any, file: Express.Multer.File, cb: any) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new BadRequestException('Solo se permiten imágenes'), false);
  }
  cb(null, true);
};

@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * POST /api/upload/:folder
   * folder: apartments | users | bookings
   */
  @Post(':folder')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @Param('folder') folder: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!VALID_FOLDERS.includes(folder as UploadFolder)) {
      throw new BadRequestException(`Folder inválido. Usa: ${VALID_FOLDERS.join(', ')}`);
    }

    const result = await this.uploadService.uploadFile(file, folder as UploadFolder);

    return {
      url:      result.secure_url,
      publicId: result.public_id,
      width:    result.width,
      height:   result.height,
      format:   result.format,
    };
  }

  /**
   * DELETE /api/upload?publicId=nova-inns/apartments/abc123
   */
  @Delete()
  async remove(@Query('publicId') publicId: string) {
    if (!publicId) throw new BadRequestException('publicId requerido');
    await this.uploadService.deleteFile(publicId);
    return { message: 'Imagen eliminada' };
  }
}
