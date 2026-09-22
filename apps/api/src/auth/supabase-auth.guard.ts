/**
 * ตรวจ JWT ที่ Supabase Auth ออกให้ ด้วย JWKS ของโปรเจกต์ (ไม่ต้องเก็บ JWT secret)
 * design.md ข้อ 11 บอกว่า "ยังไม่มี auth/session — deploy จริงควรมีอย่างน้อย basic auth"
 * ย้ายมา Supabase แล้วจึงใช้ของจริงได้เลย ไม่ต้อง basic auth
 */
import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { loadEnv } from '../config/env';

export interface AuthUser {
  id: string;
  email: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly log = new Logger(SupabaseAuthGuard.name);
  private readonly env = loadEnv();
  private readonly jwks = createRemoteJWKSet(
    new URL(`${loadEnv().SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  );

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.env.AUTH_DISABLED) {
      // dev เครื่องตัวเองเท่านั้น — env.ts ปฏิเสธค่านี้ถ้า NODE_ENV=production
      const req = context.switchToHttp().getRequest<Request>();
      req.user = { id: 'dev-user', email: 'dev@localhost' };
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('ไม่มี access token');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: `${this.env.SUPABASE_URL}/auth/v1`,
      }));
    } catch (err) {
      this.log.debug(`ตรวจ token ไม่ผ่าน: ${String(err)}`);
      throw new UnauthorizedException('token ไม่ถูกต้องหรือหมดอายุ');
    }

    if (!payload.sub) throw new UnauthorizedException('token ไม่มี sub');
    req.user = {
      id: payload.sub,
      email: typeof payload['email'] === 'string' ? payload['email'] : null,
    };
    return true;
  }
}
