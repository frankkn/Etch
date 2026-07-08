import { useState } from 'react';
import { QUOTA_TOTAL } from '../lib/constants';
import type { Visibility } from '../storage/db';

export function EtchConfirm({
  text,
  quotaUsed,
  onConfirm,
  onClose,
}: {
  text: string;
  quotaUsed: number;
  onConfirm: (visibility: Visibility) => Promise<void>;
  onClose: () => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded border border-stone-700 bg-stone-900 p-6">
        <h2 className="mb-4 text-lg text-stone-100">
          十年後的你會想留著這則嗎？
        </h2>
        <p className="etch-content mb-6 max-h-56 overflow-y-auto rounded bg-stone-950 p-4 text-sm text-stone-300">
          {text}
        </p>

        <p className="mb-2 text-sm text-stone-300">
          這一則，是刻給自己的，還是刻給世界的？
        </p>
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setVisibility('private')}
            className={`flex-1 rounded border px-4 py-2 text-sm transition-colors ${
              visibility === 'private'
                ? 'border-stone-400 bg-stone-800 text-stone-100'
                : 'border-stone-700 text-stone-500 hover:text-stone-300'
            }`}
          >
            刻給自己（私密）
          </button>
          <button
            onClick={() => setVisibility('public')}
            className={`flex-1 rounded border px-4 py-2 text-sm transition-colors ${
              visibility === 'public'
                ? 'border-stone-400 bg-stone-800 text-stone-100'
                : 'border-stone-700 text-stone-500 hover:text-stone-300'
            }`}
          >
            刻給世界（公開）
          </button>
        </div>
        {visibility === 'public' && (
          <p className="mb-4 text-xs leading-relaxed text-stone-500">
            公開的貼文將以明文儲存；分享頁上線後，拿到你連結的人都能讀到它。
          </p>
        )}

        <p className="mb-6 text-xs leading-relaxed text-stone-500">
          這會立刻發布為 No. {quotaUsed + 1} / {QUOTA_TOTAL}。發布後 24
          小時內可以編輯或刪除（刪除退還額度，編輯不延長時限）；24
          小時一到就定形——再也不能改、不能刪。
        </p>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-stone-400 hover:text-stone-200"
          >
            再想想
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(visibility);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
            className="rounded border border-stone-400 px-5 py-2 text-sm font-medium text-stone-100 hover:bg-stone-700 disabled:opacity-40"
          >
            Etch
          </button>
        </div>
      </div>
    </div>
  );
}
