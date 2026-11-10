import { Controller, Get, NotFoundException } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { AppService } from './app.service';

@Controller()
export class AppController {
  // version.json no cambia hasta el siguiente deploy: se lee una vez
  private versionInfo: unknown | null = null;

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
    if (this.versionInfo) return this.versionInfo;
    for (const path of candidates) {
      if (existsSync(path)) {
        this.versionInfo = JSON.parse(readFileSync(path, 'utf-8'));
        return this.versionInfo;
      }
    }
    throw new NotFoundException('version.json not found. Run build first.');
  }
}
