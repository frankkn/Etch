import { useState } from 'react';

/**
 * mode 'set'：第一次設定通關密語（輸入兩次 + 不可逆警告）。
 * mode 'unlock'：輸入既有密語（匯出時已有 salt，或匯入解密）。
 */
export function PassphraseDialog({
  mode,
  title,
  busyLabel,
  onSubmit,
  onClose,
}: {
  mode: 'set' | 'unlock';
  title: string;
  busyLabel: string;
  onSubmit: (passphrase: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    pass.length >= 8 && (mode === 'unlock' || pass === confirm) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pass);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded border border-stone-700 bg-stone-900 p-6">
        <h2 className="mb-2 text-lg text-stone-100">{title}</h2>
        {mode === 'set' && (
          <p className="mb-4 text-xs leading-relaxed text-stone-500">
            通關密語與登入無關，只用來加密你的資料。
            <span className="text-stone-300">
              密語遺失＝資料永久遺失。沒有重設、沒有後門，連我們都救不回來。
            </span>
            請自己想辦法記住它。
          </p>
        )}
        <div className="space-y-3">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="通關密語（至少 8 個字元）"
            autoFocus
            className="w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-200 outline-none focus:border-stone-500"
          />
          {mode === 'set' && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="再輸入一次"
              className="w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-200 outline-none focus:border-stone-500"
            />
          )}
        </div>
        {mode === 'set' && confirm.length > 0 && pass !== confirm && (
          <p className="mt-2 text-xs text-red-400">兩次輸入不一致</p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded px-4 py-2 text-sm text-stone-400 hover:text-stone-200"
          >
            取消
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded border border-stone-400 px-5 py-2 text-sm text-stone-100 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? busyLabel : '確認'}
          </button>
        </div>
      </div>
    </div>
  );
}
