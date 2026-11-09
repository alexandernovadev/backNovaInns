import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// El Tracker es una herramienta de desarrollo: en producción todos los
// endpoints del módulo responden 403, no solo los que abren navegador.
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'El Tracker solo está habilitado en entorno de desarrollo.',
      );
    }
    return true;
  }
}
