import { Controller, Get, NotFoundException } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('info')
  getInfo() {
    const path = resolve(__dirname, '..', 'public', 'assets', 'version.json');
    if (!existsSync(path)) {
      throw new NotFoundException('version.json not found. Run build first.');
    }
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
}
