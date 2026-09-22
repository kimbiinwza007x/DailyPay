/**
 * ประกอบร่าง parser: ฉีด adapter จริง (QR/OCR) เข้า SlipImage ที่จุดนี้จุดเดียว
 * ชั้น core ไม่รู้จัก adapters เลย ทำให้เทส parser ได้ด้วย fake reader
 */
import { Global, Module } from '@nestjs/common';
import { readSlipQrAuto } from './adapters/qr-reader';
import { readSlipText } from './adapters/thai-ocr';
import { KBankCsv } from './core/parsers/kbank-csv';
import { ParserRegistry } from './core/parsers/registry';
import { ScbStatementPdf } from './core/parsers/scb-statement-pdf';
import { SlipImage } from './core/parsers/slip-image';

export const PARSER_REGISTRY = Symbol('PARSER_REGISTRY');

@Global()
@Module({
  providers: [
    {
      provide: PARSER_REGISTRY,
      useFactory: (): ParserRegistry =>
        new ParserRegistry([
          new KBankCsv(),
          new ScbStatementPdf(),
          new SlipImage(readSlipQrAuto, readSlipText),
        ]),
    },
  ],
  exports: [PARSER_REGISTRY],
})
export class ParsersModule {}
