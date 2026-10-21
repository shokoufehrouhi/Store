// The reels' covers (user's choice, 2026-10-21): every reel used to open on
// the same frame, so the profile grid looked repeated. Now each HTML reel
// opens on one of three covers per slot, taken in turn by day (the builder
// picks the layout): frame 0 is the cover Instagram shows, it holds with a
// little motion for COVER_SEC and then leaves its own way while the reel
// starts underneath. It carries the discount, so it replaces reelHook/hook.js.
//   11:00 (brand reel): mosaic, brandwall, hero
//   20:00 (chat reel):  notif, pricetag, question
// Loaded by the HTML reels after their own script: it wraps window.setup,
// window.seek and window.DURATION (the reel's own timeline is shifted by
// COVER_SEC - EXIT_SEC).
(function () {
  const COVER_SEC = 1.9, EXIT_SEC = 0.45, SHIFT = COVER_SEC - EXIT_SEC;
  const W = 1080, H = 1920;
  const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => cl((t - a) / (b - a));
  const eio = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const ei = k => k * k * k;
  const tl = n => `${Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const css = document.createElement('style');
  css.textContent = `
#reelCover{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;z-index:60;font-family:Vazir,sans-serif;transform-origin:50% 50%}
#reelCover .a{position:absolute}
#reelCover .ph{position:absolute;overflow:hidden;background:#eee}
#reelCover .ph img{width:100%;height:100%;object-fit:cover;display:block;transform-origin:50% 50%}
#reelCover .rtl{direction:rtl;text-align:center;white-space:nowrap}
#reelCover .wall{position:absolute;left:-200px;white-space:nowrap;font-weight:900;font-size:150px;line-height:190px;letter-spacing:.04em;direction:ltr}`;
  document.head.appendChild(css);

  let el = null, layout = null, parts = {};
  const $c = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const add = (html) => { const n = $c(html); el.appendChild(n); return n; };

  // ---------------- layouts: build(c, theme) and seek(t) for the hold ----------------
  const LAYOUTS = {
    // 11:00 #1: a full-bleed 3x4 photo wall, the discount in a block in the middle.
    mosaic: {
      exit: 'tiles',
      build(c, th) {
        el.style.background = th.bg;
        const G = 12, cw = (W - 4 * G) / 3, ch = (H - 5 * G) / 4;
        parts.tiles = [];
        for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
          const i = r * 3 + k;
          const n = add(`<div class="ph" style="left:${G + k * (cw + G)}px;top:${G + r * (ch + G)}px;width:${cw}px;height:${ch}px;border-radius:24px"><img src="${c.photos[i % c.photos.length]}"></div>`);
          parts.tiles.push({ n, d: Math.hypot(k - 1, r - 1.5) });
        }
        parts.badge = add(`<div class="a rtl" style="left:110px;top:700px;width:860px;height:520px;background:${th.accent};border-radius:56px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff">
          <div style="font-weight:700;font-size:54px;opacity:.92">برندهای اصل ترکیه</div>
          <div style="font-weight:900;font-size:190px;line-height:1.15">تا ${esc(c.pct)}٪</div>
          <div style="font-weight:900;font-size:84px;line-height:1.1">تخفیف</div></div>`);
      },
      seek(t) {
        parts.tiles.forEach(({ n }, i) => { n.firstChild.style.transform = `scale(${1.04 + 0.05 * prog(t, 0, COVER_SEC) * (i % 2 ? 1 : -1) + 0.02})`; });
        parts.badge.style.transform = `scale(${1 + 0.035 * Math.sin(Math.PI * prog(t, 0.5, 1.1))}) rotate(-2deg)`;
      },
    },
    // 11:00 #2: brand names in big rows on the accent colour, three framed
    // photos fanned on top and a round discount sticker.
    brandwall: {
      exit: 'up',
      build(c, th) {
        el.style.background = th.accent;
        const names = (c.brands.length ? c.brands : ['SHILISTA']);
        parts.rows = [];
        for (let r = 0; r < 10; r++) {
          const line = Array.from({ length: 8 }, (_, i) => names[(r * 3 + i) % names.length]).join('  •  ');
          const solid = r % 2 === 0;
          const n = add(`<div class="wall" style="top:${r * 190 - 20}px;${solid ? 'color:rgba(255,255,255,.95)' : 'color:transparent;-webkit-text-stroke:3px rgba(255,255,255,.75)'}">${esc(line)}</div>`);
          parts.rows.push(n);
        }
        const P = [{ x: 90, y: 560, r: -9 }, { x: 590, y: 600, r: 8 }, { x: 330, y: 470, r: -1 }];
        parts.photos = P.map((p, i) => add(`<div class="ph" style="left:${p.x}px;top:${p.y}px;width:400px;height:520px;border:14px solid #fff;border-radius:22px;box-shadow:0 26px 60px rgba(0,0,0,.35);transform:rotate(${p.r}deg)"><img src="${c.photos[i % c.photos.length]}"></div>`));
        parts.sticker = add(`<div class="a rtl" style="left:640px;top:330px;width:340px;height:340px;border-radius:50%;background:#fff;color:${th.accent};display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 18px 50px rgba(0,0,0,.3)">
          <div style="font-weight:700;font-size:44px;line-height:1.1">تا</div>
          <div style="font-weight:900;font-size:120px;line-height:1.05">${esc(c.pct)}٪</div>
          <div style="font-weight:900;font-size:50px;line-height:1.1">تخفیف</div></div>`);
        parts.title = add(`<div class="a rtl" style="left:90px;top:1300px;width:900px;padding:36px 0;border-radius:48px;background:#1a1a1a;color:#fff;font-weight:900;font-size:90px;line-height:1.3;box-shadow:0 24px 60px rgba(0,0,0,.3)">برندهای محبوب<br>با تخفیف واقعی</div>`);
      },
      seek(t) {
        parts.rows.forEach((n, r) => { n.style.transform = `translateX(${(r % 2 ? -1 : 1) * t * 70}px)`; });
        parts.sticker.style.transform = `rotate(${-12 + 4 * Math.sin(t * 2.2)}deg) scale(${1 + 0.05 * Math.sin(Math.PI * prog(t, 0.4, 0.9))})`;
      },
    },
    // 11:00 #3: one photo full-bleed (the biggest discount), the percentage huge at the bottom.
    hero: {
      exit: 'iris',
      build(c, th) {
        el.style.background = '#111';
        parts.img = add(`<div class="ph" style="left:0;top:0;width:${W}px;height:${H}px"><img src="${c.photos[c.hero || 0]}"></div>`);
        add(`<div class="a" style="left:0;top:0;width:${W}px;height:${H}px;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 45%,rgba(0,0,0,.82) 78%,rgba(0,0,0,.9) 100%)"></div>`);
        add(`<div class="a rtl" style="left:70px;top:90px;padding:14px 36px;border-radius:999px;background:${th.accent};color:#fff;font-weight:900;font-size:44px">فقط امروز</div>`);
        parts.pct = add(`<div class="a rtl" style="left:0;top:1170px;width:${W}px;color:#fff;font-weight:900;font-size:300px;line-height:1.1">${esc(c.pct)}٪</div>`);
        add(`<div class="a rtl" style="left:0;top:1520px;width:${W}px;color:#fff;font-weight:900;font-size:76px">تخفیف روی برندهای اصل</div>`);
        add(`<div class="a" style="left:60px;top:1660px;width:960px;text-align:center;color:rgba(255,255,255,.8);font-weight:700;font-size:38px;letter-spacing:.14em;white-space:nowrap;overflow:hidden;direction:ltr">${esc(c.brands.slice(0, 4).join('  ·  '))}</div>`);
      },
      seek(t) {
        parts.img.firstChild.style.transform = `scale(${1 + 0.08 * prog(t, 0, COVER_SEC)})`;
        parts.pct.style.transform = `scale(${1 + 0.04 * Math.sin(Math.PI * prog(t, 0.45, 1.0))})`;
      },
    },
    // 20:00 #1: the pick's photo blurred full-bleed, the photo itself in the
    // middle and a phone notification from the shopping assistant on top.
    notif: {
      exit: 'fade',
      build(c, th) {
        el.style.background = '#111';
        add(`<div class="ph" style="left:-120px;top:-120px;width:${W + 240}px;height:${H + 240}px"><img src="${c.best.img}" style="filter:blur(36px) brightness(.55)"></div>`);
        parts.card = add(`<div class="ph" style="left:150px;top:560px;width:780px;height:960px;border-radius:48px;box-shadow:0 40px 90px rgba(0,0,0,.5)"><img src="${c.best.img}"></div>`);
        parts.notif = add(`<div class="a" style="left:60px;top:230px;width:960px;height:240px;background:rgba(255,255,255,.96);border-radius:48px;box-shadow:0 20px 60px rgba(0,0,0,.35);direction:rtl;display:flex;align-items:center;gap:30px;padding:0 40px">
          <div style="flex:none;width:132px;height:132px;border-radius:32px;background:${th.accent};display:flex;align-items:center;justify-content:center">
            <svg width="78" height="90" viewBox="0 0 26 30"><path d="M8 9V7a5 5 0 0 1 10 0v2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><rect x="2" y="9" width="22" height="20" rx="4" fill="#fff"/></svg></div>
          <div style="flex:1;min-width:0;text-align:right">
            <div style="font-weight:700;font-size:34px;color:#8a8a8a">دستیار خرید شیلیستا · الان</div>
            <div style="font-weight:900;font-size:50px;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">پیداش کردم! ${esc(c.pct)}٪ تخفیف</div>
          </div></div>`);
        parts.big = add(`<div class="a rtl" style="left:0;top:1580px;width:${W}px;color:#fff;font-weight:900;font-size:120px;line-height:1.2;text-shadow:0 8px 30px rgba(0,0,0,.4)">${esc(c.pct)}٪ تخفیف</div>`);
      },
      seek(t) {
        parts.notif.style.transform = `translateY(${4 * Math.sin(t * 3)}px)`;
        parts.card.firstChild.style.transform = `scale(${1.02 + 0.05 * prog(t, 0, COVER_SEC)})`;
      },
    },
    // 20:00 #2: the pick on a tilted card over the accent colour, the old
    // price struck through and the new one big.
    pricetag: {
      exit: 'down',
      build(c, th) {
        el.style.background = th.accent;
        parts.card = add(`<div class="a" style="left:150px;top:200px;width:780px;height:1040px;background:#fff;border-radius:48px;padding:22px;box-shadow:0 40px 90px rgba(0,0,0,.3)">
          <div class="ph" style="position:relative;width:736px;height:880px;border-radius:30px"><img src="${c.best.img}"></div>
          <div style="font-weight:900;font-size:40px;letter-spacing:.16em;color:#6b6b6b;text-align:center;margin-top:30px;direction:ltr;white-space:nowrap;overflow:hidden">${esc(String(c.best.brand).toUpperCase())}</div></div>`);
        parts.sticker = add(`<div class="a rtl" style="left:700px;top:120px;width:300px;height:300px;border-radius:50%;background:#1a1a1a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 18px 50px rgba(0,0,0,.3)">
          <div style="font-weight:900;font-size:110px;line-height:1.05">${esc(c.pct)}٪</div><div style="font-weight:700;font-size:46px">تخفیف</div></div>`);
        add(`<div class="a" style="left:0;top:1330px;width:${W}px;text-align:center;direction:ltr;color:rgba(255,255,255,.75);font-weight:700;font-size:76px;text-decoration:line-through;text-decoration-thickness:6px">${esc(tl(c.best.price))}</div>`);
        parts.price = add(`<div class="a" style="left:0;top:1440px;width:${W}px;text-align:center;direction:ltr;color:#fff;font-weight:900;font-size:170px;line-height:1.2">${esc(tl(c.best.sale))}</div>`);
        add(`<div class="a rtl" style="left:0;top:1690px;width:${W}px;color:#fff;font-weight:700;font-size:48px;opacity:.9">فقط امروز در شیلیستا</div>`);
      },
      seek(t) {
        parts.card.style.transform = `rotate(${-4 + 1.2 * Math.sin(t * 1.8)}deg)`;
        parts.sticker.style.transform = `rotate(12deg) scale(${1 + 0.06 * Math.sin(Math.PI * prog(t, 0.4, 0.9))})`;
      },
    },
    // 20:00 #3: the customer's question in big type on dark, the answer as a
    // pill, the products as a row of round photos.
    question: {
      exit: 'wipe',
      build(c, th) {
        el.style.background = '#161616';
        add(`<div class="a rtl" style="left:0;top:300px;width:${W}px;color:#8a8a8a;font-weight:700;font-size:44px">دستیار خرید شیلیستا</div>`);
        parts.q = add(`<div class="a rtl" style="left:60px;top:450px;width:960px;color:#fff;font-weight:900;font-size:96px;line-height:1.35;white-space:normal;text-wrap:balance">«${esc(c.ask)}»</div>`);
        parts.pill = add(`<div class="a rtl" style="left:90px;top:860px;width:900px;height:220px;border-radius:999px;background:${th.accent};color:#fff;font-weight:900;font-size:110px;line-height:220px">${esc(c.pct)}٪ تخفیف</div>`);
        const n = Math.min(3, c.photos.length);
        parts.circles = Array.from({ length: n }, (_, i) => {
          const x = W / 2 - (n * 300 - (n - 1) * 60) / 2 + i * 240;
          return add(`<div class="ph" style="left:${x}px;top:1240px;width:300px;height:300px;border-radius:50%;border:10px solid #161616;box-shadow:0 0 0 4px ${th.accent}"><img src="${c.photos[i]}"></div>`);
        });
        add(`<div class="a" style="left:0;top:1660px;width:${W}px;text-align:center;color:#d9d9d9;font-weight:700;font-size:56px;letter-spacing:.04em">shilista.com</div>`);
      },
      seek(t) {
        parts.pill.style.transform = `rotate(-3deg) scale(${1 + 0.04 * Math.sin(Math.PI * prog(t, 0.45, 1.0))})`;
        parts.circles.forEach((n, i) => { n.style.transform = `translateY(${10 * Math.sin(t * 3 + i * 1.3)}px)`; });
      },
    },
  };

  // How each cover leaves over the last EXIT_SEC (k: 0 -> 1).
  function exit(k) {
    const e = eio(k);
    switch (layout.exit) {
      case 'tiles':
        parts.tiles.forEach(({ n, d }) => { const s = 1 - ei(cl(k * 1.6 - d * 0.25)); n.style.transform = `scale(${s})`; n.style.opacity = s; });
        parts.badge.style.transform = `scale(${1 - ei(k)}) rotate(-2deg)`;
        el.style.background = 'transparent';
        break;
      case 'up': el.style.transform = `translateY(${-e * H}px)`; break;
      case 'down': el.style.transform = `translateY(${e * H}px)`; break;
      case 'iris': el.style.clipPath = `circle(${(1 - e) * 1150}px at 50% 50%)`; break;
      case 'fade': el.style.opacity = 1 - e; el.style.transform = `scale(${1 + 0.12 * e})`; break;
      case 'wipe': el.style.clipPath = `inset(0 0 0 ${e * 100}%)`; break;
    }
  }

  function mount(cover, theme) {
    layout = LAYOUTS[cover.layout];
    if (!layout) throw new Error('unknown cover layout: ' + cover.layout);
    el = document.createElement('div');
    el.id = 'reelCover';
    document.body.appendChild(el);
    layout.build(cover, theme);
  }

  function seekCover(t) {
    if (!el) return;
    el.style.display = t < COVER_SEC ? 'block' : 'none';
    if (t >= COVER_SEC) return;
    layout.seek(t);
    exit(prog(t, COVER_SEC - EXIT_SEC, COVER_SEC));
  }

  // data.cover: { layout, photos, pct, brands, hero, best, ask } from the
  // builder; data.theme: { bg, accent }. Without a cover the reel is unchanged.
  const setup0 = window.setup, seek0 = window.seek;
  window.setup = function (data) {
    if (!data.cover) return setup0(data);
    setup0({ ...data, hook: null });
    mount(data.cover, data.theme || { bg: '#fff', accent: '#C2410C' });
    window.DURATION += SHIFT;
    window.seek = (t) => { seek0(Math.max(0, t - SHIFT)); seekCover(t); };
    window.seek(0);
  };
})();
