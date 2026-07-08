import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKdfParams } from '../src/crypto';
import { buildExportFile } from '../src/export/exportFile';

/**
 * 用 docs/EXPORT_FORMAT.md 的參考實作（純 node:crypto，完全不經過
 * src/crypto）解密 buildExportFile 的產物。這個測試守住的是對外承諾：
 * 任何人照公開規格實作，都解得開我們的匯出檔。若它失敗，代表格式
 * 規格與實際實作出現分歧——修實作或升 version，不能改規格語義。
 */
function referenceDecrypt(
  file: { kdf: { salt: string; iterations: number } },
  ciphertextB64: string,
  ivB64: string,
  passphrase: string,
): string {
  const key = pbkdf2Sync(
    Buffer.from(passphrase, 'utf8'),
    Buffer.from(file.kdf.salt, 'base64'),
    file.kdf.iterations,
    32,
    'sha256',
  );
  const data = Buffer.from(ciphertextB64, 'base64');
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

describe('格式規格相容性', () => {
  it('EXPORT_FORMAT.md 的參考實作能解開 buildExportFile 的產物', async () => {
    const file = await buildExportFile(
      '通關密語123',
      createKdfParams(1_000),
      [{
        id: 'p1',
        n: 1,
        text: '刻在石頭上的話\n第二行',
        visibility: 'private',
        contentHash: 'a'.repeat(64),
        etchedAt: '2026-01-01T00:00:00.000Z',
        lastEditedAt: '2026-01-01T00:00:00.000Z',
        struckAt: null,
      }],
      [{ id: 'd1', text: '差點說出口的話', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }],
    );
    expect(
      referenceDecrypt(file, file.posts[0].ciphertext, file.posts[0].iv, '通關密語123'),
    ).toBe('刻在石頭上的話\n第二行');
    expect(
      referenceDecrypt(file, file.drafts[0].ciphertext, file.drafts[0].iv, '通關密語123'),
    ).toBe('差點說出口的話');
  });
});
