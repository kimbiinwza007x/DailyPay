/**
 * ทางเข้าของ API บน Vercel — ทุก request ถูก rewrite มาที่ function เดียว (api/index.js)
 * แล้วส่งต่อให้ express ที่ Nest คุมอยู่
 *
 * บูต Nest ครั้งเดียวต่อ instance แล้ว cache ไว้ Fluid compute ของ Vercel ใช้ instance ซ้ำ
 * ข้ามหลาย request ได้ ถ้าบูตใหม่ทุก request จะช้าและเปิด connection pool ใหม่ทุกครั้ง
 *
 * ไฟล์นี้ต้องถูก compile ด้วย tsc (`nest build`) เท่านั้น — builder ของ Vercel ใช้ esbuild
 * ซึ่งไม่ปล่อย decorator metadata แล้ว DI ของ Nest จะพัง (เหมือนตอนใช้ tsx กับ worker)
 * api/index.js จึงแค่ require ไฟล์ที่ build แล้วจาก dist/
 */
import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { configureApp } from './configure-app';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Promise<Handler> | null = null;

async function bootstrap(): Promise<Handler> {
  const env = loadEnv();
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: ['error', 'warn', 'log'],
  });
  configureApp(app, env);
  await app.init();
  return expressApp as unknown as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // บูตพังครั้งหนึ่งต้องไม่ cache promise ที่ reject ไว้ตลอดอายุ instance
  server ??= bootstrap().catch((err) => {
    server = null;
    throw err;
  });
  const app = await server;
  app(req, res);
}
