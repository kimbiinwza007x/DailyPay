/**
 * Use case: อัปโหลดไฟล์ → stage (sync, เร็ว, ตอบผู้ใช้ทันที) → parse (async, worker)
 * การ enqueue job ต้องอยู่ใน transaction เดียวกับการสร้าง batch เสมอ (design.md ข้อ 7)
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { classify } from '../../core/dedupe';
import { suggest } from '../../core/categorize';
import { type ParsedRow, parsedRowToJson, type StageResult } from '../../core/models';
import { NoParserMatched } from '../../core/parsers/base';
import type { ParserRegistry } from '../../core/parsers/registry';
import { PARSER_REGISTRY } from '../../parsers.module';
import { OBJECT_STORE, type ObjectStore } from '../../storage/object-store';
import { UnitOfWork } from '../../db/uow';

function hashRow(payload: Record<string, unknown>): string {
  // key เรียงแล้วเสมอ ไม่งั้นแถวเดิมได้ hash คนละค่าเมื่อ parser สลับลำดับ field
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

function contentTypeOf(filename: string): string {
  const n = filename.toLowerCase();
  if (n.endsWith('.csv')) return 'text/csv';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);

  constructor(
    private readonly uow: UnitOfWork,
    @Inject(OBJECT_STORE) private readonly objstore: ObjectStore,
    @Inject(PARSER_REGISTRY) private readonly registry: ParserRegistry,
  ) {}

  /** ---- ชั้นที่ 1: sync เร็ว ตอบผู้ใช้ทันที ---- */
  async stage(raw: Buffer, filename: string, accountId: string | null): Promise<StageResult> {
    const fileHash = createHash('sha256').update(raw).digest('hex');

    // ชั้นกันซ้ำที่ 1: ไฟล์เดิมที่ลากมาวางซ้ำ — หยุดตั้งแต่ด่านแรก ไม่ต้องอัปโหลดขึ้น storage
    const existing = await this.uow.read((tx) => tx.batches.byHash(fileHash));
    if (existing) return { batchId: existing.id, duplicateFile: true };

    const uri = await this.objstore.put(
      `imports/${fileHash}`,
      raw,
      contentTypeOf(filename),
    );

    return this.uow.run(async (tx) => {
      // เช็คซ้ำอีกรอบใน transaction: สองแท็บอัปไฟล์เดียวกันพร้อมกันได้
      const again = await tx.batches.byHash(fileHash);
      if (again) return { batchId: again.id, duplicateFile: true };

      const batch = await tx.batches.create({
        accountId,
        fileName: filename,
        fileHash,
        fileUri: uri,
        source: 'manual',
        status: 'parsing',
      });
      await tx.jobs.enqueue('parse_batch', { batch_id: batch.id });
      return { batchId: batch.id, duplicateFile: false };
    });
  }

  /** ---- ชั้นที่ 2: worker ---- */
  async parse(batchId: string): Promise<void> {
    const batch = await this.uow.read((tx) => tx.batches.get(batchId));
    if (!batch.file_uri) {
      await this.uow.run((tx) => tx.batches.fail(batchId, 'batch ไม่มี file_uri'));
      return;
    }

    const raw = await this.objstore.get(batch.file_uri);

    let parser;
    try {
      parser = await this.registry.pick(raw, batch.file_name ?? '');
    } catch (err) {
      const message = err instanceof NoParserMatched ? err.message : String(err);
      await this.uow.run((tx) => tx.batches.fail(batchId, message));
      return;
    }

    // อ่านไฟล์ทั้งก้อนนอก transaction ก่อน: parse สลิปด้วย OCR ใช้เวลาหลายวินาที
    // ถ้าทำในทรานแซกชันจะจับ connection ค้างไว้ทั้งช่วง
    const parsedRows: ParsedRow[] = [];
    for await (const row of parser.rows(raw)) parsedRows.push(row);

    await this.uow.run(async (tx) => {
      await tx.batches.setSource(batchId, parser.source);

      const counts: Record<string, number> = { new: 0, duplicate: 0, review: 0 };
      for (const [i, row] of parsedRows.entries()) {
        // batch ที่ยังไม่ผูกบัญชี: กันซ้ำระดับ fingerprint ยังทำไม่ได้ (fingerprint มี account_id)
        // ให้ทุกแถวไป review แทนการเดาบัญชีเอง
        const verdictResult = batch.account_id
          ? await classify(row, batch.account_id, tx.transactions)
          : { kind: 'review' as const, dupOf: null, reason: 'ยังไม่ได้เลือกบัญชี' };

        await tx.rawRows.upsert({
          batchId,
          lineNo: i,
          payload: row.payload,
          rowHash: hashRow(row.payload),
          parsed: parsedRowToJson(row),
          dedupe: verdictResult.kind,
          dupOf: verdictResult.dupOf,
          proposedCategoryId: await suggest(row, tx.categorize),
          confidence: row.confidence,
          parseStatus: row.confidence > 0 ? 'parsed' : 'error',
        });
        counts[verdictResult.kind] = (counts[verdictResult.kind] ?? 0) + 1;
      }

      await tx.batches.toReview(batchId, counts);
      this.log.log(
        `batch ${batchId}: ${parsedRows.length} แถว (${parser.name}) → ` +
          `new=${counts['new']} dup=${counts['duplicate']} review=${counts['review']}`,
      );
    });
  }
}
