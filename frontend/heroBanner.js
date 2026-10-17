// Animated home banner (from the prompt-motion.com "photo print app launch
// film" prompt): a dot grows into a pill with a label, the pill becomes a
// circle, an iris opens onto a product photo, the circle turns into a tile,
// a 3x3 grid unfolds from behind it like a paper map, reflows into a bento,
// zooms into the big tile which becomes a product card, then a black flood
// contracts back into the dot and it loops with the next products.
// Every frame is a pure function of time (seek), drawn on a 600x600 stage
// scaled to the box. initHeroBanner(box, products, opts) where each product
// is { id, img, brand, name, price, sale } and opts gives the texts in the
// current language (read again every loop, so a language switch shows up
// on the next one): text(key) for 'label' / 'view' / 'off' ("{n}"
// replaced), name(product), num(str) for the digits, price(n), dir() and
// onOpen(id).
(function () {
  var S = 600, DUR = 10.0;
  var INK = '#1a1a1a', ACCENT = '#C2410C';

  function cl(x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, x)); }
  function prog(t, a, b) { return cl((t - a) / (b - a)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function eo(k) { return 1 - Math.pow(1 - k, 3); }
  function eio(k) { return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function ei(k) { return k * k * k; }
  function spring(t, t0, w, z) {
    if (t <= t0) return 0;
    var d = t - t0, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * d) * (Math.cos(wd * d) + (z * w / wd) * Math.sin(wd * d));
  }
  function lerpR(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) }; }
  function place(el, r) { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; }
  function pct(p) { return Math.round((p.price - p.sale) / p.price * 100); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  // 3x3 grid and the bento it reflows into (RTL: the big tile on the right).
  var GRID = [];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) GRID.push({ x: 24 + c * 188, y: 24 + r * 188, w: 176, h: 176 });
  var CENTER = 4;
  var BENTO = {
    4: { x: 214, y: 18, w: 368, h: 368 },  // the photo the iris opened on
    0: { x: 18, y: 18, w: 184, h: 178 }, 3: { x: 18, y: 208, w: 184, h: 178 },
    6: { x: 18, y: 398, w: 184, h: 184 }, 7: { x: 214, y: 398, w: 178, h: 184 }, 8: { x: 404, y: 398, w: 178, h: 184 },
  };
  // unfold order: the plus first, each from the centre; then the corners, each from a plus tile
  var UNFOLD = { 1: [CENTER, 2.45, 'b'], 3: [CENTER, 2.5, 'r'], 5: [CENTER, 2.5, 'l'], 7: [CENTER, 2.55, 't'],
    0: [1, 2.85, 'r'], 2: [1, 2.9, 'l'], 6: [7, 2.9, 'r'], 8: [7, 2.95, 'l'] };
  var CIRCLE = { x: 150, y: 150, w: 300, h: 300 };

  // The iris: black everywhere but a hexagonal aperture of radius a (one
  // even-odd path), and the blade seams, each edge continued outward past
  // its corner, turning as the iris opens.
  function irisHex(a) {
    var rot = (1 - a / 170) * 0.9, pts = [];
    for (var i = 0; i < 6; i++) pts.push([150 + a * Math.cos(rot + i * Math.PI / 3), 150 + a * Math.sin(rot + i * Math.PI / 3)]);
    return pts;
  }
  function irisPath(a) {
    var pts = irisHex(a);
    return 'M-300 -300H600V600H-300Z M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z';
  }
  function irisSeams(a) {
    var pts = irisHex(a), d = '';
    for (var i = 0; i < 6; i++) {
      var p0 = pts[(i + 5) % 6], p1 = pts[i];
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy) || 1;
      d += 'M' + p1[0] + ' ' + p1[1] + 'L' + (p1[0] + dx / l * 300) + ' ' + (p1[1] + dy / l * 300);
    }
    return d;
  }

  window.initHeroBanner = function (box, products, opts) {
    opts = opts || {};
    var text = opts.text || function (k) { return { label: 'تخفیف‌های امروز', view: 'مشاهده محصول', off: '{n}٪ تخفیف' }[k]; };
    var num = opts.num || function (s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); };
    var price = opts.price || function (n) { return Number(n).toFixed(2) + ' TL'; };
    if (!products || products.length < 6) return null;
    box.innerHTML = '';
    var stage = el('div', 'hb-stage', box);
    var cam = el('div', 'hb-cam', stage);
    var tiles = GRID.map(function () { var t = el('div', 'hb-tile', cam); el('img', '', t); el('span', 'hb-chip', t); return t; });
    var circle = el('div', 'hb-circle', cam); var circleImg = el('img', '', circle);
    circle.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 300 300" class="hb-iris"><path fill="' + INK + '" fill-rule="evenodd"/><path fill="none" stroke="#4a4a4a" stroke-width="2"/></svg>');
    var irisP = circle.querySelectorAll('path')[0], irisS = circle.querySelectorAll('path')[1];
    var pill = el('div', 'hb-pill', stage); var pillLabel = el('span', '', pill);
    var card = el('div', 'hb-card', stage);
    card.innerHTML = '<div class="hb-brand"></div><div class="hb-name"></div><div class="hb-row"><span class="hb-new"></span><span class="hb-old"></span></div><span class="hb-btn"></span><span class="hb-badge"></span>';
    var flood = el('div', 'hb-flood', stage);

    var loopShown = -1, current = [];
    function fill(loop) {
      var n = products.length;
      // 6 visible products per loop, the big one first
      current = [];
      for (var i = 0; i < 9; i++) current.push(products[(loop * 6 + i) % n]);
      var order = [CENTER, 0, 3, 6, 7, 8, 1, 2, 5];
      order.forEach(function (gi, k) {
        var p = current[k];
        tiles[gi].querySelector('img').src = p.img;
        tiles[gi].querySelector('.hb-chip').textContent = '−' + num(pct(p)) + '%';
        tiles[gi].dataset.id = p.id;
      });
      var big = current[0];
      circleImg.src = big.img;
      card.querySelector('.hb-brand').textContent = String(big.brand || '').toUpperCase();
      card.querySelector('.hb-name').textContent = opts.name ? opts.name(big) : big.name;
      card.querySelector('.hb-new').textContent = price(big.sale);
      card.querySelector('.hb-old').textContent = price(big.price);
      card.querySelector('.hb-badge').textContent = text('off').replace('{n}', num(pct(big)));
      card.querySelector('.hb-btn').textContent = text('view');
      card.setAttribute('dir', opts.dir ? opts.dir() : 'rtl');
      pillLabel.textContent = text('label');
      loopShown = loop;
    }

    function seek(T) {
      var loop = Math.floor(T / DUR), t = T - loop * DUR;
      if (loop !== loopShown) fill(loop);

      // ---- dot -> pill -> circle ----
      var dotIn = loop === 0 ? spring(t, 0, 16, 0.6) : 1;
      var toPill = spring(t, 0.3, 15, 0.7);
      var toCircle = eio(prog(t, 0.9, 1.25));
      var pr = { x: 300 - 12 * dotIn, y: 300 - 12 * dotIn, w: 24 * dotIn, h: 24 * dotIn };
      pr = lerpR(pr, { x: 180, y: 268, w: 240, h: 64 }, cl(toPill, 0, 1.2));
      pr = lerpR(pr, CIRCLE, toCircle);
      place(pill, pr);
      pill.style.borderRadius = Math.min(pr.w, pr.h) / 2 + 'px';
      pill.style.visibility = t < 1.3 ? 'visible' : 'hidden';
      var labIn = spring(t, 0.45, 14, 0.8), labOut = eio(prog(t, 0.85, 1.05));
      pillLabel.style.transform = 'translateY(' + ((1 - labIn) * 50 - labOut * 50) + 'px)';

      // ---- iris opens onto the photo, circle becomes the centre tile ----
      var open = eo(prog(t, 1.35, 1.85));
      var ap = lerp(0, 175, open);
      irisP.setAttribute('d', irisPath(ap));
      irisS.setAttribute('d', irisSeams(ap));
      irisP.style.visibility = irisS.style.visibility = open < 1 ? 'visible' : 'hidden';
      var toTile = eio(prog(t, 1.95, 2.4));
      var crr = lerpR(CIRCLE, GRID[CENTER], toTile);
      place(circle, crr);
      circle.style.borderRadius = lerp(150, 18, toTile) + 'px';
      circle.style.visibility = t >= 1.25 && t < 2.42 ? 'visible' : 'hidden';
      circleImg.style.transform = 'scale(' + lerp(1.15, 1, open) + ')';

      // ---- tiles: unfold, bento, zoom ----
      var toBento = eio(prog(t, 3.55, 4.25));
      tiles.forEach(function (tile, i) {
        var r, sx = 1, sy = 1, origin = '50% 50%', vis = t >= 2.4;
        if (i === CENTER) r = GRID[CENTER];
        else {
          var u = UNFOLD[i], from = GRID[u[0]], k = eo(prog(t, u[1], u[1] + 0.35));
          vis = vis && t >= u[1];
          r = lerpR(from, GRID[i], k);
          if (u[2] === 'b' || u[2] === 't') { sy = k; origin = u[2] === 'b' ? '50% 100%' : '50% 0%'; }
          else { sx = k; origin = u[2] === 'r' ? '100% 50%' : '0% 50%'; }
        }
        var tgt = BENTO[i];
        if (tgt) r = lerpR(r, tgt, toBento);
        else { var bc = BENTO[CENTER]; r = lerpR(r, { x: bc.x + bc.w / 2, y: bc.y + bc.h / 2, w: 0, h: 0 }, toBento); }
        place(tile, r);
        tile.style.transformOrigin = origin;
        tile.style.transform = 'scale(' + sx + ',' + sy + ')';
        tile.style.visibility = vis && (tgt || toBento < 1) ? 'visible' : 'hidden';
        tile.style.borderRadius = (tgt === BENTO[CENTER] && i === CENTER ? lerp(18, 24, toBento) : 18) + 'px';
        var img = tile.firstChild;
        img.style.transform = 'scale(' + (1.04 + 0.04 * Math.sin((t + i) * 0.6)) + ')';
        var chip = tile.lastChild;
        var cs = tgt ? spring(t, 4.45 + (i % 4) * 0.06, 16, 0.55) * (1 - prog(t, 5.9, 6.05)) : 0;
        chip.style.transform = 'scale(' + cs + ')';
        chip.style.visibility = cs > 0.01 ? 'visible' : 'hidden';
      });
      var A = BENTO[CENTER];
      var zin = eio(prog(t, 6.0, 6.6));
      var s = lerp(1, S / A.w, zin), tx = -A.x * s * zin, ty = -A.y * s * zin;
      cam.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      tiles[CENTER].style.borderRadius = lerp(24, 0, zin) + 'px';

      // ---- product card ----
      var cardIn = spring(t, 6.55, 13, 0.85), cardOut = eio(prog(t, 9.0, 9.2));
      card.style.transform = 'translateY(' + ((1 - cardIn) * 220) + 'px)';
      card.style.visibility = t > 6.55 && t < 9.4 ? 'visible' : 'hidden';
      var badge = card.querySelector('.hb-badge');
      var bs = spring(t, 6.85, 18, 0.45);
      badge.style.transform = 'scale(' + bs + ') rotate(' + ((1 - bs) * 20 - 4) + 'deg)';
      var btn = card.querySelector('.hb-btn');
      btn.style.transform = 'scale(' + (1 - 0.08 * Math.sin(Math.PI * prog(t, 8.6, 8.8))) + ')';

      // ---- flood from the button, contracts back into the dot ----
      var fr = 0, fx = 470, fy = 545;
      if (t >= 8.8 && t < 9.4) fr = eo(prog(t, 8.8, 9.15)) * 900;
      else if (t >= 9.4) { var kk = eio(prog(t, 9.4, 9.95)); fr = lerp(900, 12, kk); fx = lerp(470, 300, kk); fy = lerp(545, 300, kk); }
      place(flood, { x: fx - fr, y: fy - fr, w: fr * 2, h: fr * 2 });
      flood.style.visibility = fr > 0 ? 'visible' : 'hidden';
      if (t >= 9.4) { tiles.forEach(function (tl_) { tl_.style.visibility = 'hidden'; }); card.style.visibility = 'hidden'; }
    }

    // scale the 600x600 stage to the box
    function fit() { stage.style.transform = 'scale(' + (box.clientWidth / S) + ')'; box.style.height = box.clientWidth + 'px'; }
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(box);

    stage.addEventListener('click', function (e) {
      var tile = e.target.closest && e.target.closest('.hb-tile');
      var id = tile && tile.dataset.id ? Number(tile.dataset.id) : current[0] && current[0].id;
      if (id && opts.onOpen) opts.onOpen(id);
    });

    var api = { seek: seek, DUR: DUR };
    if (opts.manual) { seek(0); return api; }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { seek(5.2); return api; }
    // play only while on screen and the tab is visible
    var playing = false, start = 0, elapsed = 0, onScreen = true;
    function frame(now) {
      if (!playing) return;
      seek((now - start) / 1000);
      requestAnimationFrame(frame);
    }
    function update() {
      var want = onScreen && !document.hidden;
      if (want && !playing) { playing = true; start = performance.now() - elapsed * 1000; requestAnimationFrame(frame); }
      else if (!want && playing) { playing = false; elapsed = (performance.now() - start) / 1000; }
    }
    if (window.IntersectionObserver) new IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; update(); }).observe(box);
    document.addEventListener('visibilitychange', update);
    update();
    return api;
  };
})();
