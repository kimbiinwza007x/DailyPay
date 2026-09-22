import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { StageResultDto } from '@dailypay/shared';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { QueueKicker } from '../../worker/queue-kicker';
import { ImportService } from './import.service';

/**
 * Vercel ตัด request body ที่เกิน 4.5 MB ทิ้งก่อนถึงโค้ดเรา (413)
 * ตั้งเพดานให้ต่ำกว่านิดหน่อยเพื่อให้ได้ข้อความที่อ่านรู้เรื่องแทน
 * สลิปใบละ 200-350 KB สบาย statement PDF ปกติก็ไม่ถึง
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

@Controller('imports')
@UseGuards(SupabaseAuthGuard)
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly kicker: QueueKicker,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('accountId') accountId?: string,
  ): Promise<StageResultDto> {
    if (!file) throw new BadRequestException('ไม่ได้แนบไฟล์มา (field ชื่อ "file")');
    const result = await this.importService.stage(
      file.buffer,
      file.originalname || 'upload',
      accountId || null,
    );
    // ไฟล์ซ้ำไม่มีงานใหม่ในคิว ไม่ต้องสะกิด
    if (!result.duplicateFile) this.kicker.kick('หลังอัปโหลด');
    return result;
  }
}
