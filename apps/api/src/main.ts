import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  loadDotenv({ path: ['.env.local', '.env', '../../.env'] });
  const env = loadEnv();

  const app = await NestFactory.create(AppModule);
  configureApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  new Logger('bootstrap').log(`API ทำงานที่ http://localhost:${env.API_PORT}/api`);
}

void bootstrap();
