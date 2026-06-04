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
    const candidates = [
      resolve(process.cwd(), 'public', 'assets', 'version.json'),
      resolve(__dirname, '..', 'public', 'assets', 'version.json'),
    ];
    for (const path of candidates) {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf-8'));
      }
    }
    throw new NotFoundException('version.json not found. Run build first.');
  }
}
