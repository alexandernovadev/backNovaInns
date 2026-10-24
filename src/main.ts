import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Import de reservas/apartamentos manda JSON grandes (default de Express: 100kb)
  app.useBodyParser('json', { limit: '20mb' });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
    'http://localhost:4200',
  ];
  app.enableCors({ origin: corsOrigins });
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Nova Inns API running on port ${port}`);
}
bootstrap();
