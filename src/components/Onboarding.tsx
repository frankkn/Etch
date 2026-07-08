export function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="mb-10 text-3xl font-semibold tracking-[0.3em] text-stone-100">
        ETCH
      </h1>
      <div className="space-y-6 text-stone-300">
        <p className="text-lg text-stone-100">一生只能發 100 則。</p>
        <ul className="space-y-3 text-sm leading-relaxed">
          <li>・按下 Etch 就立刻發布：立刻取得編號、立刻用掉一則額度。</li>
          <li>・發布後的 24 小時是可塑期：可以編輯（編號不變），也可以刪除（額度退還，之後的編號往前遞補）。時限固定，編輯不會延長它。</li>
          <li>・24 小時一到，貼文就定形——從此不可編輯、不可刪除。唯一的例外是劃掉（Strike）：劃掉的貼文仍然可見、仍佔額度，且劃掉本身也不可逆。</li>
          <li>・沒有讚、沒有留言、沒有追蹤。貼文只有編號和時間。</li>
          <li>・一切預設私密，資料存在你的裝置上。備份時以你的通關密語加密——密語遺失等於資料永久遺失，沒有重設、沒有後門，連我們都救不回來，因為連我們都讀不到。</li>
        </ul>
        <p className="text-sm text-stone-500">
          用完就沒有了。這不是限制，是為了讓每一則都值得。
        </p>
      </div>
      <button
        onClick={onDone}
        className="mt-12 self-start rounded border border-stone-600 px-6 py-2.5 text-stone-100 transition-colors hover:bg-stone-800"
      >
        我明白了，開始
      </button>
    </div>
  );
}
