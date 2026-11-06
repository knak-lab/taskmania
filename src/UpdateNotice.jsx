import { useEffect, useState } from "react";

// 新しい版がデプロイされていたら、画面下にお知らせを出す。
// ホーム画面に追加したアプリは裏で前の画面が残ったままになりやすく、デプロイしても古い版のまま動き続けるため。
// 編集途中の入力を消さないよう、自動では再読み込みせず、押してもらってから更新する。
const SCRIPT_RE = /assets\/index-[\w-]+\.js/;
const CHECK_EVERY_MS = 30 * 60 * 1000;

function currentScript() {
  const el = [...document.querySelectorAll('script[type="module"][src]')].find((s) => SCRIPT_RE.test(s.src));
  return el ? el.src.match(SCRIPT_RE)[0] : null;
}

async function latestScript() {
  // cache: "reload" でサーバーから取り直し、ブラウザの保存分も新しい版に置き換える(このあとの再読み込みで新しい版が開くように)
  const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: "reload" });
  if (!res.ok) return null;
  const m = (await res.text()).match(SCRIPT_RE);
  return m ? m[0] : null;
}

export default function UpdateNotice() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const mine = currentScript();
    if (!mine) return;
    let stopped = false;
    const check = async () => {
      try {
        const latest = await latestScript();
        if (!stopped && latest && latest !== mine) setHasUpdate(true);
      } catch { /* オフラインなどは気にしない */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const first = setTimeout(check, 3000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!hasUpdate) return null;
  return (
    <div role="status" style={s.bar}>
      <span>新しい版があります</span>
      <button type="button" onClick={() => window.location.reload()} style={s.btn}>更新</button>
      <button type="button" onClick={() => setHasUpdate(false)} aria-label="閉じる" style={s.close}>×</button>
    </div>
  );
}

const s = {
  bar: { position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 100000, display: "flex", alignItems: "center", gap: 10, background: "#12314F", color: "#fff", padding: "8px 10px 8px 14px", borderRadius: 8, boxShadow: "0 4px 16px rgba(18,49,79,.3)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  btn: { border: 0, background: "#F39800", color: "#fff", borderRadius: 6, padding: "4px 12px", font: "inherit", cursor: "pointer" },
  close: { border: 0, background: "transparent", color: "#fff", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: "0 2px" },
};
