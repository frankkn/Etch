import { useState } from 'react';
import { createKdfParams } from '../crypto';
import {
  buildExportFile,
  decryptExportFile,
  parseExportFile,
} from '../export/exportFile';
import {
  getKdfParams,
  importAll,
  setKdfParams,
  type Draft,
  type Post,
} from '../storage/db';
import { PassphraseDialog } from './PassphraseDialog';

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'export'; mode: 'set' | 'unlock' }
  | { kind: 'import'; json: string };

export function Backup({
  posts,
  drafts,
  onImported,
}: {
  posts: Post[];
  drafts: Draft[];
  onImported: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [message, setMessage] = useState<string | null>(null);

  const storeEmpty = posts.length === 0 && drafts.length === 0;

  const startExport = async () => {
    setMessage(null);
    const existing = await getKdfParams();
    setDialog({ kind: 'export', mode: existing ? 'unlock' : 'set' });
  };

  const doExport = async (passphrase: string) => {
    const kdf = (await getKdfParams()) ?? createKdfParams();
    const file = await buildExportFile(passphrase, kdf, posts, drafts);
    await setKdfParams(kdf);
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`etch-export-${date}.json`, JSON.stringify(file, null, 2));
    setDialog({ kind: 'none' });
    setMessage('已匯出。建議把離線解密工具也存一份在檔案旁邊。');
  };

  const pickImportFile = async (fileList: FileList | null) => {
    setMessage(null);
    const file = fileList?.[0];
    if (!file) return;
    const json = await file.text();
    try {
      parseExportFile(json); // 先驗格式，密語留到解密時再要
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    setDialog({ kind: 'import', json });
  };

  const doImport = async (json: string, passphrase: string) => {
    const file = parseExportFile(json);
    const { posts: p, drafts: d } = await decryptExportFile(file, passphrase);
    await importAll(p, d, file.kdf);
    setDialog({ kind: 'none' });
    setMessage(`已還原 ${p.length} 則貼文、${d.length} 則草稿。`);
    await onImported();
  };

  return (
    <div className="space-y-8 text-sm">
      <section>
        <h2 className="mb-2 text-base text-stone-100">匯出</h2>
        <p className="mb-3 leading-relaxed text-stone-500">
          一個加密 JSON 檔就是你的一生：{posts.length} 則貼文、{drafts.length}{' '}
          則草稿。內容以你的通關密語加密（PBKDF2 + AES-256-GCM），檔案本身可以放心存在任何地方。
        </p>
        <button
          onClick={() => void startExport()}
          className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800"
        >
          匯出加密備份
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-base text-stone-100">離線解密工具</h2>
        <p className="mb-3 leading-relaxed text-stone-500">
          一個不連網的單檔 HTML。就算 Etch 消失了，拿著它和你的通關密語，仍然打得開匯出檔。格式規格公開在原始碼的
          docs/EXPORT_FORMAT.md——你不需要我們。
        </p>
        <a
          href="etch-decryptor.html"
          download
          className="inline-block rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800"
        >
          下載解密工具
        </a>
      </section>

      <section>
        <h2 className="mb-2 text-base text-stone-100">匯入</h2>
        <p className="mb-3 leading-relaxed text-stone-500">
          只能在全新裝置上還原——本機已有資料時不允許匯入覆蓋，因為刻下的東西不能被蓋掉。
        </p>
        <label
          className={`inline-block rounded border px-5 py-2 ${
            storeEmpty
              ? 'cursor-pointer border-stone-600 text-stone-100 hover:bg-stone-800'
              : 'cursor-not-allowed border-stone-800 text-stone-600'
          }`}
        >
          選擇匯出檔
          <input
            type="file"
            accept=".json,application/json"
            disabled={!storeEmpty}
            onChange={(e) => {
              void pickImportFile(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
        {!storeEmpty && (
          <p className="mt-2 text-xs text-stone-600">本機已有資料，匯入已停用。</p>
        )}
      </section>

      {message && <p className="text-stone-300">{message}</p>}

      {dialog.kind === 'export' && (
        <PassphraseDialog
          mode={dialog.mode}
          title={dialog.mode === 'set' ? '設定通關密語' : '輸入通關密語'}
          busyLabel="加密中⋯"
          onSubmit={doExport}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}
      {dialog.kind === 'import' && (
        <PassphraseDialog
          mode="unlock"
          title="輸入通關密語以解密"
          busyLabel="解密中⋯"
          onSubmit={(pass) => doImport(dialog.json, pass)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}
    </div>
  );
}
