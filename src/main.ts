import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS so frontend clients can call the API
  app.enableCors();

  // Read port from .env, fallback to 3000
  const port = process.env.PORT || 3000;

  await app.listen(port);
  logger.log(`🚀 Application running on http://localhost:${port}`);
  logger.log(`📋 Jobs API available at http://localhost:${port}/api/jobs`);
}

bootstrap();