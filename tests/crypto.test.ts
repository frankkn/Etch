import { describe, expect, it } from 'vitest';
import {
  createKdfParams,
  decryptText,
  deriveKey,
  encryptText,
} from '../src/crypto';

// 測試用低 iterations 加速；正式預設 600k 由 DEFAULT_KDF_ITERATIONS 保證
const TEST_ITERATIONS = 1_000;

describe('crypto module', () => {
  it('加密後可用同一密語解回原文', async () => {
    const params = createKdfParams(TEST_ITERATIONS);
    const key = await deriveKey('正確的通關密語', params);
    const plaintext = '十年後的我，你還記得今天嗎？\n第二行。';
    const blob = await encryptText(key, plaintext);
    expect(await decryptText(key, blob)).toBe(plaintext);
  });

  it('錯誤的密語無法解密', async () => {
    const params = createKdfParams(TEST_ITERATIONS);
    const key = await deriveKey('正確的通關密語', params);
    const blob = await encryptText(key, '秘密');
    const wrongKey = await deriveKey('錯誤的通關密語', params);
    await expect(decryptText(wrongKey, blob)).rejects.toThrow();
  });

  it('同一密語、不同 salt 導出的金鑰互不相通', async () => {
    const keyA = await deriveKey('同一密語', createKdfParams(TEST_ITERATIONS));
    const keyB = await deriveKey('同一密語', createKdfParams(TEST_ITERATIONS));
    const blob = await encryptText(keyA, '秘密');
    await expect(decryptText(keyB, blob)).rejects.toThrow();
  });

  it('每次加密使用獨立的 IV', async () => {
    const key = await deriveKey('密語', createKdfParams(TEST_ITERATIONS));
    const a = await encryptText(key, '相同內容');
    const b = await encryptText(key, '相同內容');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('密文被竄改時解密失敗（GCM 完整性驗證）', async () => {
    const key = await deriveKey('密語', createKdfParams(TEST_ITERATIONS));
    const blob = await encryptText(key, '原始內容');
    const bytes = Uint8Array.from(atob(blob.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = {
      ...blob,
      ciphertext: btoa(String.fromCharCode(...bytes)),
    };
    await expect(decryptText(key, tampered)).rejects.toThrow();
  });

  it('拒絕未知的 KDF 演算法', async () => {
    const params = createKdfParams(TEST_ITERATIONS);
    await expect(
      deriveKey('密語', { ...params, algorithm: 'MD5' as never }),
    ).rejects.toThrow(/不支援/);
  });

  it('預設 iterations 不低於 600k', async () => {
    const { DEFAULT_KDF_ITERATIONS } = await import('../src/crypto');
    expect(DEFAULT_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(createKdfParams().iterations).toBe(DEFAULT_KDF_ITERATIONS);
  });
});
