import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import type { Env } from './config/env';

/**
 * ตั้งค่าที่ต้องเหมือนกันทุกที่ที่บูต API — `main.ts` (เครื่องตัวเอง) กับ `vercel.ts` (serverless)
 * แยกออกมาที่เดียว ไม่งั้นวันหนึ่งแก้ CORS ฝั่งหนึ่งแล้วลืมอีกฝั่ง
 */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  // validation ทั้งหมดใช้ zod schema จาก @dailypay/shared ผ่าน ZodValidationPipe รายเส้นทาง
  // จึงไม่ต้องมี ValidationPipe ของ Nest (ที่ต้องพึ่ง class-validator) เป็น global
  app.useGlobalFilters(new AllExceptionsFilter());
}
