// The opening "hook" of every reel (user's choice, 2026-10-19): the
// discount in big type for the first HOOK_SEC, since most viewers decide in
// the first second or two whether to keep watching. Shown in full on frame
// 0 (often the reel's cover too), a small pulse, then it shrinks away.
// Loaded by the HTML reels (chatReel.html, brandReel.html) after their own
// script; reelBuilder.js draws the same badge with sharp for the ffmpeg reels.
(function () {
  const HOOK_SEC = 2.4, OUT_SEC = 0.35;
  let el = null;
  const css = document.createElement('style');
  css.textContent = `
#reelHook{position:absolute;left:0;width:1080px;display:flex;justify-content:center;z-index:50;pointer-events:none}
#reelHook .box{background:#C2410C;color:#fff;border-radius:64px;padding:26px 80px 34px;text-align:center;direction:rtl;box-shadow:0 24px 60px rgba(194,65,12,.35)}
#reelHook .big{font-family:Vazir,sans-serif;font-weight:900;font-size:132px;line-height:1.25;white-space:nowrap}
#reelHook .sub{font-family:Vazir,sans-serif;font-weight:700;font-size:46px;opacity:.92;margin-top:2px;white-space:nowrap}`;
  document.head.appendChild(css);

  // hook: { text, sub, top } (from the builder's reel data), or nothing.
  function mount(hook) {
    if (!hook || !hook.text) return;
    el = document.createElement('div');
    el.id = 'reelHook';
    el.style.top = (hook.top ?? 1260) + 'px';
    el.innerHTML = `<div class="box"><div class="big"></div>${hook.sub ? '<div class="sub"></div>' : ''}</div>`;
    el.querySelector('.big').textContent = hook.text;
    if (hook.sub) el.querySelector('.sub').textContent = hook.sub;
    document.body.appendChild(el);
  }

  function seek(t) {
    if (!el) return;
    const out = Math.min(1, Math.max(0, (t - (HOOK_SEC - OUT_SEC)) / OUT_SEC));
    const pulse = 1 + 0.05 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.5) / 0.5)));
    el.style.opacity = String(1 - out);
    el.style.transform = `scale(${pulse * (1 - 0.35 * out * out)})`;
    el.style.display = t < HOOK_SEC ? 'flex' : 'none';
  }

  window.ReelHook = { mount, seek };
})();
