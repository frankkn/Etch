import { describe, expect, it } from 'vitest';
import { createKdfParams, deriveKey, sha256Hex } from '../src/crypto';
import type { Post } from '../src/storage/db';
import {
  cloudPostDiffers,
  fromCloudPost,
  toCloudPost,
} from '../src/sync/mapping';

const makeKey = () => deriveKey('測試密語', createKdfParams(1_000));

const makePost = async (
  overrides: Partial<Post> = {},
): Promise<Post> => {
  const text = overrides.text ?? '刻下的話';
  return {
    id: 'p1',
    n: 1,
    text,
    visibility: 'private',
    contentHash: await sha256Hex(text),
    etchedAt: '2026-07-01T00:00:00.000Z',
    lastEditedAt: '2026-07-01T12:00:00.000Z',
    struckAt: null,
    ...overrides,
  };
};

describe('雲端映射', () => {
  it('私密貼文：只上傳密文，往返還原一致', async () => {
    const key = await makeKey();
    const post = await makePost();
    const cloud = await toCloudPost(post, key);
    expect(cloud.plaintext).toBeUndefined();
    expect(cloud.ciphertext).toBeTruthy();
    expect(JSON.stringify(cloud)).not.toContain('刻下的話');
    expect(await fromCloudPost('p1', cloud, key)).toEqual(post);
  });

  it('公開貼文：走明文路徑，不帶密文欄位', async () => {
    const key = await makeKey();
    const post = await makePost({ visibility: 'public' });
    const cloud = await toCloudPost(post, key);
    expect(cloud.plaintext).toBe('刻下的話');
    expect(cloud.ciphertext).toBeUndefined();
    expect(cloud.iv).toBeUndefined();
    expect(await fromCloudPost('p1', cloud, key)).toEqual(post);
  });

  it('contentHash 不符時拒絕還原（防雲端竄改）', async () => {
    const key = await makeKey();
    const post = await makePost({ visibility: 'public' });
    const cloud = await toCloudPost(post, key);
    cloud.plaintext = '被偷改過的內容';
    await expect(fromCloudPost('p1', cloud, key)).rejects.toThrow(/contentHash/);
  });

  it('錯誤金鑰解不開私密貼文', async () => {
    const key = await makeKey();
    const wrongKey = await deriveKey('錯的密語', createKdfParams(1_000));
    const cloud = await toCloudPost(await makePost(), key);
    await expect(fromCloudPost('p1', cloud, wrongKey)).rejects.toThrow(/解密失敗/);
  });

  it('差異偵測：內容相同不重傳（IV 隨機不影響判斷），metadata 變了要傳', async () => {
    const key = await makeKey();
    const post = await makePost();
    const cloud = await toCloudPost(post, key);
    expect(cloudPostDiffers(post, cloud)).toBe(false);
    expect(
      cloudPostDiffers({ ...post, struckAt: '2026-07-03T00:00:00.000Z' }, cloud),
    ).toBe(true);
    expect(cloudPostDiffers({ ...post, n: 2 }, cloud)).toBe(true);
    expect(
      cloudPostDiffers({ ...post, contentHash: 'e'.repeat(64) }, cloud),
    ).toBe(true);
  });
});
