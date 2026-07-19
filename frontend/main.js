window._mfv = 74;
// ─── Confirm Popup ────────────────────────────────────────────────────────────
function showConfirm(msg, onYes, yesLabel) {
  var t   = TRANSLATIONS[currentLang];
  var ov  = document.getElementById('confirm-overlay');
  var box = document.getElementById('confirm-box');
  if (!ov) return onYes();
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-yes').textContent = yesLabel || t.confirm_yes || 'بله';
  document.getElementById('confirm-no').textContent  = t.confirm_no  || 'انصراف';
  ov.style.display = 'flex';
  function close() { ov.style.display = 'none'; ov.removeEventListener('click', onOverlay); }
  function onOverlay(e) { if (e.target === ov) close(); }
  ov.addEventListener('click', onOverlay);
  document.getElementById('confirm-yes').onclick = function() { close(); onYes(); };
  document.getElementById('confirm-no').onclick  = function() { close(); };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type) {
  var wrap = document.getElementById('app-toast');
  if (!wrap) return;
  document.getElementById('app-toast-msg').textContent = msg;
  var icon = document.getElementById('app-toast-icon');
  if (icon) {
    if (type === 'error') {
      icon.textContent = '✕';
      icon.classList.add('error');
    } else {
      icon.textContent = '✓';
      icon.classList.remove('error');
    }
  }
  wrap.classList.add('show');
  clearTimeout(wrap._t);
  wrap._t = setTimeout(function() { wrap.classList.remove('show'); }, 2600);
}
function closeToast() {
  var wrap = document.getElementById('app-toast');
  if (wrap) wrap.classList.remove('show');
}

var PLACEHOLDER_SVG = '<svg class="img-placeholder" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 1L2 15h8.5L6 27L20 13h-8.5L14 1z" fill="white" opacity="0.18"/></svg>';

// ─── State ────────────────────────────────────────────────────────────────────
var _isLocal    = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
var SERVER_BASE = _isLocal ? 'http://localhost:3001' : '';
var API_BASE    = SERVER_BASE + '/api';
var _urlLang = new URLSearchParams(location.search).get('lang');
if (_urlLang && ['fa','tr','en'].includes(_urlLang)) localStorage.setItem('lang_v2', _urlLang);
var currentLang = localStorage.getItem('lang_v2') || 'tr';
var currentSearch      = '';
var currentCategory    = 'all';
var currentSubcategory = null;
var currentGender      = 'all';
var currentColors      = [];
var currentSizes       = [];
var currentSort        = 'newest';
var _filterBaseList    = [];
var cart               = JSON.parse(localStorage.getItem('cart') || '[]');
var cachedCategories   = [];
var _qaProduct = null, _qaColor = null, _qaSize = null;
var _pendingCart = null;
var currentPreorder    = null;
var _preorderPollTimer = null;

function updateOrderStatusBtn() {
  var btn = document.getElementById('order-status-btn');
  var dot = document.getElementById('order-status-dot');
  if (!btn || !dot) return;
  if (!currentPreorder) {
    btn.style.display = 'none';
    btn.classList.remove('has-order');
    dot.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
  btn.classList.add('has-order');
  var statusColors = {
    preorder:        '#f97316',
    payment_needed:  '#ef4444',
    approval_needed: '#3b82f6',
    preparing:       '#8b5cf6',
    delivery:        '#0ea5e9',
    delivered:       '#22c55e',
    rejected:        '#ef4444',
    cancelled:       '#6b7280',
  };
  var color = statusColors[currentPreorder.status] || '#f97316';
  dot.style.background = color;
  dot.style.display = 'block';
}

// ─── Category Badge Color (hash-based, works for any category key) ────────────
function catBadgeStyle(key) {
  var palette = [
    { bg: '#ede9fe', color: '#7c3aed' },
    { bg: '#dbeafe', color: '#1d4ed8' },
    { bg: '#d1fae5', color: '#065f46' },
    { bg: '#fef3c7', color: '#92400e' },
    { bg: '#fee2e2', color: '#991b1b' },
    { bg: '#ffedd5', color: '#9a3412' },
    { bg: '#e0f2fe', color: '#0369a1' },
    { bg: '#fce7f3', color: '#be185d' },
  ];
  var idx = (key || '').split('').reduce(function(s, c) { return s + c.charCodeAt(0); }, 0) % palette.length;
  var p = palette[idx];
  return 'background:' + p.bg + ';color:' + p.color;
}

// ─── API Product Mapper ───────────────────────────────────────────────────────
function mapApiProduct(p) {
  var media  = p.product_media || [];
  var images = media.filter(function(m) { return m.type === 'image'; });
  var videos = media.filter(function(m) { return m.type === 'video'; });
  return {
    id:          p.id,
    code:        p.code || null,
    _fromApi:    true,
    category:    p.categories    ? p.categories.key    : '',
    subcategory: p.subcategories ? p.subcategories.key : null,
    extra_categories: (p.product_categories || []).map(function(pc) {
      return { category: pc.categories.key, subcategory: pc.subcategories ? pc.subcategories.key : null };
    }),
    gender:      p.gender  || 'unisex',
    tag:         p.tag     || null,
    gradient:     p.gradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    delivery_days: p.delivery_days != null ? Number(p.delivery_days) : 5,
    name:        { fa: p.name_fa, en: p.name_en || p.name_fa, tr: p.name_tr || p.name_fa },
    description: { fa: p.desc_fa || '', en: p.desc_en || '', tr: p.desc_tr || '' },
    colors: (p.product_colors || []).map(function(pc) {
      return { id: pc.colors.id, key: pc.colors.key, hex: pc.colors.hex,
               name: { fa: pc.colors.name_fa, en: pc.colors.name_en, tr: pc.colors.name_tr },
               is_available: pc.is_available };
    }),
    sizes:            (p.product_sizes || []).map(function(s) { return s.size_label; }),
    unavailableSizes: (p.product_sizes || []).filter(function(s) { return !s.is_available; }).map(function(s) { return s.size_label; }),
    unavailableColors:(p.product_colors || []).filter(function(pc) { return !pc.is_available; }).map(function(pc) { return pc.colors.key; }),
    media:  media,
    images: images,
    videos: videos,
    price:            Number(p.price) || 0,
    discounted_price: p.discounted_price != null ? Number(p.discounted_price) : null,
    stock:            p.stock || 0,
    sales:               Number(p.sales) || 0,
    has_customer_photos: !!p.has_customer_photos,
    inventory: (p.product_inventory || []).map(function(i) {
      return { color_id: i.color_id, size_label: i.size_label, quantity: i.quantity };
    }),
  };
}

// ─── Number Helpers ───────────────────────────────────────────────────────────
var PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toLatinNumbers(str) {
  return String(str).replace(/[۰-۹]/g, function(c) {
    return PERSIAN_DIGITS.indexOf(c).toString();
  });
}
function localizeNumber(str) {
  return currentLang === 'fa' ? str : toLatinNumbers(str);
}

function showCopyToast(code) {
  var old = document.getElementById('_cct');
  if (old) { clearTimeout(old._t); old.remove(); }
  var label = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang].code_copied) || 'Copied';
  var el = document.createElement('div');
  el.id = '_cct';
  el.setAttribute('dir', 'ltr');
  el.style.position = 'fixed';
  el.style.bottom = '48px';
  el.style.left = '50%';
  el.style.transform = 'translateX(-50%)';
  el.style.background = '#1f2937';
  el.style.padding = '11px 24px';
  el.style.borderRadius = '100px';
  el.style.fontSize = '15px';
  el.style.fontWeight = '600';
  el.style.whiteSpace = 'nowrap';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2147483647';
  el.style.boxShadow = '0 8px 32px rgba(0,0,0,.45)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.gap = '8px';
  var icon = document.createElement('span');
  icon.textContent = '✓';
  icon.style.color = '#4ade80';
  icon.style.fontWeight = '700';
  var lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.color = '#ffffff';
  el.appendChild(icon);
  el.appendChild(lbl);
  document.body.appendChild(el);
  el._t = setTimeout(function() { if (el.parentNode) el.remove(); }, 2500);
}
function copyProductCode(code) {
  console.log('[copy] copyProductCode called, v=' + window._mfv);
  showCopyToast(code);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code);
    } else {
      _clipboardFallback(code);
    }
  } catch(e) {}
}
function _clipboardFallback(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  } catch(e) {}
}

function formatPrice(amount) {
  var num = Math.floor(Number(amount) * 100) / 100;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
}

// Returns price HTML — if discounted_price exists: strikethrough original + discounted in red
function renderPriceHtml(p, cssClass) {
  var cls = cssClass || 'product-price';
  if (!p.price) return '';
  var hasDiscount = p.discounted_price && p.discounted_price < p.price;
  if (hasDiscount) {
    return '<div class="' + cls + ' price-has-discount" dir="ltr">' +
      '<span class="price-original">' + formatPrice(p.price) + '</span>' +
      '<span class="price-discounted">' + formatPrice(p.discounted_price) + '</span>' +
      '</div>';
  }
  return '<div class="' + cls + ' price-has-discount" dir="ltr">' +
    '<span class="price-discounted">' + formatPrice(p.price) + '</span>' +
    '</div>';
}

// ─── Cart Persistence ─────────────────────────────────────────────────────────
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartBadge();
  var tok = getSession();
  if (tok) {
    fetch(API_BASE + '/customers/cart/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': tok },
      body: JSON.stringify({ items: cart }),
    }).catch(function() {});
  }
}

function loadCartFromServer() {
  var tok = getSession(); if (!tok) return;
  fetch(API_BASE + '/customers/cart', {
    headers: { 'x-session-token': tok },
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success && Array.isArray(data.data)) {
      var serverCart = data.data;
      var localCart  = JSON.parse(localStorage.getItem('cart') || '[]');
      // merge: keep local items not yet synced to server
      localCart.forEach(function(li) {
        var exists = serverCart.find(function(si) {
          return si.id === li.id && (si.colorKey||null) === (li.colorKey||null) && (si.size||null) === (li.size||null);
        });
        if (!exists) serverCart.push(li);
      });
      cart = serverCart;
      localStorage.setItem('cart', JSON.stringify(cart));
      // sync merged cart back to server
      if (cart.length) {
        fetch(API_BASE + '/customers/cart/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': tok }, body: JSON.stringify({ items: cart }) }).catch(function() {});
      }
      updateCartBadge();
    }
  }).catch(function() {});
}

function updateCartBadge() {
  var total = cart.reduce(function(sum, item) { return sum + item.qty; }, 0);
  var badge = document.getElementById('cart-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = localizeNumber(String(total));
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ─── Cart Panel ───────────────────────────────────────────────────────────────
function openCart() {
  renderCart();
  document.getElementById('cart-panel').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cart-panel').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
  if (!document.getElementById('modal-overlay').classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

function addToCart(productId, colorKey, size) {
  if (!getCurrentUser()) {
    _pendingCart = { productId: productId, colorKey: colorKey, size: size };
    openAuthModal('login');
    return;
  }
  var existing = cart.find(function(item) {
    return item.id === productId && item.colorKey === colorKey && item.size === size;
  });
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: productId, colorKey: colorKey, size: size, qty: 1 });
  }
  saveCart();
  openCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  renderCart();
}

function updateQty(index, delta) {
  if (!cart[index]) return;
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
  renderCart();
}

var WA_SVG_SMALL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
var TG_SVG_SMALL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

function renderCart() {
  var t = TRANSLATIONS[currentLang];
  var itemsEl  = document.getElementById('cart-items');
  var footerEl = document.getElementById('cart-footer');
  var titleEl  = document.querySelector('.cart-header h3');
  if (!itemsEl || !footerEl) return;
  if (titleEl) titleEl.textContent = t.cart_title;

  var user = getCurrentUser();

  // ── Empty cart ───────────────────────────────────────────────────────────────
  if (cart.length === 0) {
    itemsEl.innerHTML = emptyView(SVG_CART,
      t.cart_empty      || 'سبد خرید خالی است',
      t.cart_empty_hint || 'محصول مورد نظرتان را انتخاب کنید',
      null, null);
    footerEl.innerHTML = '';
    return;
  }

  // ── Cart items ───────────────────────────────────────────────────────────────
  itemsEl.innerHTML = cart.map(function(item, i) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    if (!p) return '';
    var name      = p.name[currentLang];
    var colorHex  = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].hex : '';
    var colorName = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].name[currentLang] : '';
    var size      = item.size ? localizeNumber(item.size) : '';

    var firstImg   = p.images && p.images.length ? p.images[0] : null;
    var thumbInner = firstImg
      ? '<img src="' + SERVER_BASE + firstImg.url + '" onerror="this.style.display=\'none\'">'
      : PLACEHOLDER_SVG;
    var thumbStyle = firstImg ? '' : 'style="background:' + p.gradient + '"';
    return (
      '<div class="cart-item">' +
      '<div class="cart-item-thumb" ' + thumbStyle + '>' + thumbInner + '</div>' +
      '<div class="cart-item-info">' +
      '<span class="cart-item-name">' + name + '</span>' +
      (p.code ? '<span class="cart-item-code" onclick="copyProductCode(\'' + p.code + '\')" title="Copy">' + p.code + '</span>' : '') +
      (colorName
        ? '<span class="cart-item-meta"><span class="cart-item-color-dot" style="background:' + colorHex + '"></span>' + colorName + '</span>'
        : '') +
      (size ? '<span class="cart-item-meta">' + size + '</span>' : '') +
      (p.price
        ? (p.discounted_price && p.discounted_price < p.price
            ? '<div class="cart-item-price-wrap"><span class="cart-item-price-original">' + formatPrice(p.price * item.qty) + '</span><span class="cart-item-price">' + formatPrice(p.discounted_price * item.qty) + '</span></div>'
            : '<div class="cart-item-price-wrap"><span class="cart-item-price">' + formatPrice(p.price * item.qty) + '</span></div>')
        : '') +
      '</div>' +
      '<div class="cart-item-qty">' +
      '<button onclick="updateQty(' + i + ',-1)">−</button>' +
      '<span>' + localizeNumber(String(item.qty)) + '</span>' +
      '<button onclick="updateQty(' + i + ',1)">+</button>' +
      '</div>' +
      '<button class="cart-item-remove" onclick="removeFromCart(' + i + ')">✕</button>' +
      '</div>'
    );
  }).join('');

  var totalQty   = cart.reduce(function(s, item) { return s + item.qty; }, 0);
  var totalPrice = cart.reduce(function(s, item) {
    var pr = products.find(function(p) { return p.id === item.id; });
    if (!pr || !pr.price) return s;
    var unitPrice = pr.discounted_price && pr.discounted_price < pr.price ? pr.discounted_price : pr.price;
    return s + unitPrice * item.qty;
  }, 0);

  // ── Footer: preorder button (if logged in) or WA/TG buttons ─────────────────
  if (user) {
    footerEl.innerHTML =
      '<div class="cart-total">' +
      '<span>' + localizeNumber(String(totalQty)) + ' ' + t.cart_item_unit + '</span>' +
      (totalPrice ? '<span class="cart-total-price">' + formatPrice(totalPrice) + '</span>' : '') +
      '</div>' +
      '<div class="cart-order-btns">' +
      '<button class="cart-order-btn" style="background:#FF5C00;color:#fff;width:100%" onclick="openCheckout()">' +
      (t.preorder_btn || 'ثبت پیش‌سفارش') +
      '</button>' +
      '</div>';
  } else {
    footerEl.innerHTML =
      '<div style="font-size:13px;color:#888;text-align:center;margin-bottom:10px">' + (t.login_to_order || 'برای ثبت پیش‌سفارش وارد شوید') + '</div>' +
      '<div class="cart-order-btns">' +
      '<button class="cart-order-btn cart-order-wa" onclick="sendCartOrder()">' +
      WA_SVG_SMALL + ' ' + t.cart_order_btn +
      '</button>' +
      '<button class="cart-order-btn cart-order-tg" onclick="sendCartOrderTelegram()">' +
      TG_SVG_SMALL + ' ' + t.cart_order_tg_btn +
      '</button>' +
      '</div>';
  }
}

function buildOrderLines() {
  return cart.map(function(item) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    if (!p) return '';
    var name      = p.name[currentLang];
    var colorName = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].name[currentLang] : '';
    var size      = item.size ? toLatinNumbers(item.size) : '';
    var parts     = ['• ' + name];
    if (colorName) parts.push(colorName);
    if (size)      parts.push(size);
    parts.push('x' + item.qty);
    return parts.join(' | ');
  }).filter(Boolean);
}

function sendCartOrder() {
  saveOrderToHistory();
  var msg = 'سلام، میخوام این محصولات رو سفارش بدم:\n' + buildOrderLines().join('\n');
  window.open('https://wa.me/' + CONTACT.whatsapp + '?text=' + encodeURIComponent(msg), '_blank');
}

function sendCartOrderTelegram() {
  saveOrderToHistory();
  var msg = 'سلام، میخوام این محصولات رو سفارش بدم:\n' + buildOrderLines().join('\n');
  window.open('https://t.me/' + CONTACT.telegram + '?text=' + encodeURIComponent(msg), '_blank');
}

// ─── Preorder Functions ───────────────────────────────────────────────────────
function registerPreorder() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  if (!cart.length) return;

  var t = TRANSLATIONS[currentLang];
  var missingEmail  = !user.email;
  var missingMobile = !user.mobile;
  if (missingEmail || missingMobile) {
    var msg = missingEmail && missingMobile
      ? (t.order_need_email_mobile || 'برای ثبت سفارش باید ایمیل و موبایل در پروفایل ثبت شده باشد')
      : missingEmail
        ? (t.order_need_email  || 'برای ثبت سفارش باید ایمیل در پروفایل ثبت شده باشد')
        : (t.order_need_mobile || 'برای ثبت سفارش باید موبایل در پروفایل ثبت شده باشد');
    showConfirm(msg, function() {
      openProfileModal();
      showProfileTab('info');
    }, t.go_to_profile || 'رفتن به پروفایل');
    return;
  }

  var token = getSession();
  var items = cart.map(function(item) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    var colorObj = p && item.colorKey ? p.colors.find(function(c) { return c.key === item.colorKey; }) : null;
    return {
      product_id:  item.id,
      color_id:    colorObj ? colorObj.id : null,
      size_label:  item.size || null,
      qty:         item.qty,
      unit_price:  p ? p.price : 0,
    };
  });

  fetch(API_BASE + '/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ items: items, lang: currentLang }),
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      currentPreorder = data.data;
      localStorage.setItem('mf_preorder_id', String(data.data.id));
      cart = [];
      saveCart();
      renderCart();
      updateOrderStatusBtn();
      closeCart();
      showToast(TRANSLATIONS[currentLang].preorder_registered || 'پیش‌سفارش ثبت شد');
      reloadProducts(true);
      openProfileModal();
      showProfileTab('orders');
    } else {
      showToast(data.message || 'خطا در ثبت پیش‌سفارش', 'error');
      if (data.message === 'Session expired') { handleSessionExpired(); }
    }
  }).catch(function() {
    showToast('خطا در اتصال به سرور', 'error');
  });
}

function loadActivePreorder() {
  var storedId = localStorage.getItem('mf_preorder_id');
  if (!storedId) return;
  var token = getSession();
  if (!token) return;

  fetch(API_BASE + '/orders/' + storedId, {
    headers: { 'x-session-token': token },
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success && data.data) {
      var st = data.data.status;
      if (st !== 'delivered' && st !== 'cancelled') {
        currentPreorder = data.data;
        renderCart();
      } else {
        localStorage.removeItem('mf_preorder_id');
        currentPreorder = null;
      }
    } else {
      localStorage.removeItem('mf_preorder_id');
      currentPreorder = null;
    }
    updateOrderStatusBtn();
  }).catch(function() {});
}

function cancelPreorder() {
  var t = TRANSLATIONS[currentLang];
  if (!currentPreorder) return;
  showConfirm(t.cancel_confirm || 'آیا مطمئنید؟', function() {
    _doCancelPreorder();
  });
}
function _doCancelPreorder() {
  var t = TRANSLATIONS[currentLang];
  var token = getSession();

  fetch(API_BASE + '/orders/' + currentPreorder.id, {
    method: 'DELETE',
    headers: { 'x-session-token': token },
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      currentPreorder = null;
      localStorage.removeItem('mf_preorder_id');
      cart = [];
      saveCart();
      renderCart();
      updateOrderStatusBtn();
      showToast(TRANSLATIONS[currentLang].preorder_cancelled || 'پیش‌سفارش لغو شد');
      reloadProducts(true);
    } else {
      showToast(data.message || 'خطا در لغو سفارش', 'error');
      if (data.message === 'Session expired') { handleSessionExpired(); }
    }
  }).catch(function() { showToast('خطا در اتصال به سرور', 'error'); });
}

function handleReceiptFileChange(input) {
  var file = input.files && input.files[0];
  if (!file || !currentPreorder) return;
  var t = TRANSLATIONS[currentLang];
  var okExt  = /\.(jpg|jpeg|png|pdf)$/i.test(file.name);
  var okMime = ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type);
  if (!okExt && !okMime) {
    showToast(t.receipt_invalid_type || 'نوع فایل پشتیبانی نمی‌شود', 'error');
    input.value = '';
    return;
  }
  var maxSize = 10 * 1024 * 1024; // 10 MB
  if (file.size > maxSize) {
    showToast(t.receipt_too_large || 'حجم فایل نباید بیشتر از ۱۰ مگابایت باشد', 'error');
    input.value = '';
    return;
  }
  uploadReceipt(file);
  input.value = '';
}

function uploadReceipt(file) {
  var t = TRANSLATIONS[currentLang];
  var token = getSession();
  var formData = new FormData();
  formData.append('receipt', file);
  var btn = document.querySelector('.receipt-upload-form button');
  if (btn) { btn.disabled = true; btn.textContent = t.uploading || 'در حال ارسال...'; }

  fetch(API_BASE + '/orders/' + currentPreorder.id + '/receipt', {
    method: 'POST',
    headers: { 'x-session-token': token },
    body: formData,
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      currentPreorder = data.data;
      showToast(t.receipt_uploaded || 'رسید ارسال شد');
      renderCart();
    } else {
      var errMsg = data.errorCode === 'invalid_file_type' ? (t.receipt_invalid_type || 'نوع فایل پشتیبانی نمی‌شود')
                 : data.errorCode === 'file_too_large'    ? (t.receipt_too_large || 'حجم فایل بیش از حد مجاز است')
                 : (t.upload_error || 'خطا در ارسال رسید');
      showToast(errMsg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = t.upload_receipt_btn || 'انتخاب و ارسال رسید'; }
    }
  }).catch(function() {
    showToast(t.network_error || 'خطا در اتصال به سرور', 'error');
    if (btn) { btn.disabled = false; }
  });
}

function pollPreorderStatus() {
  if (!currentPreorder) return;
  var token = getSession();
  if (!token) return;

  fetch(API_BASE + '/orders/my', {
    headers: { 'x-session-token': token },
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (!data.success || !data.data) return;
    var found = data.data.find(function(o) { return o.id === currentPreorder.id; });
    if (!found) return;
    if (found.status !== currentPreorder.status) {
      currentPreorder = found;
      updateOrderStatusBtn();
      var ordersTab = document.getElementById('profile-tab-orders');
      if (ordersTab && ordersTab.style.display !== 'none') {
        _renderOrdersList(data.data);
      }
    }
  }).catch(function() {});
}

// ─── Quick Add Popup ──────────────────────────────────────────────────────────
function quickAdd(event, productId) {
  event.stopPropagation();
  window.location.href = '/product.html?id=' + productId + '&lang=' + currentLang;
  return;
  var p = products.find(function(pr) { return pr.id === productId; });
  if (!p) return;

  _qaProduct = p;
  _qaColor   = null;
  _qaSize    = null;

  var t = TRANSLATIONS[currentLang];

  var colorsHtml = '';
  if (p.colors && p.colors.length > 0) {
    colorsHtml =
      '<div class="qa-section">' +
      '<span class="qa-label">' + t.color_label + '</span>' +
      '<div class="qa-colors-row" id="qa-colors-row">' +
      p.colors.map(function(colorObj) {
        var colorKey  = colorObj.key || '';
        var isUnavail = p.unavailableColors && p.unavailableColors.indexOf(colorKey) !== -1;
        var isNoStock = !isUnavail && isColorOutOfStock(p, colorObj.id);
        var cls = 'color-swatch' + (isUnavail ? ' unavailable' : '') + (isNoStock ? ' out-of-stock' : '');
        return (
          '<button class="' + cls + '" data-color-key="' + colorKey + '" data-color-id="' + colorObj.id + '"' +
          ((isUnavail || isNoStock) ? ' data-unavailable="true"' : '') +
          ' style="background:' + colorObj.hex + '"' +
          ' title="' + colorObj.name[currentLang] + '"' +
          ' onclick="qaSelectColor(this)"></button>'
        );
      }).join('') +
      '</div>' +
      '<span class="qa-color-name" id="qa-color-name">' + t.select_color + '</span>' +
      '</div>';
  }

  var sizesHtml = '';
  if (p.sizes && p.sizes.length) {
    sizesHtml =
      '<div class="qa-section">' +
      '<span class="qa-label">' + t.sizes_label + '</span>' +
      '<div class="qa-sizes-row" id="qa-sizes-row">' +
      p.sizes.map(function(s) {
        var isUnavail = p.unavailableSizes && p.unavailableSizes.indexOf(s) !== -1;
        return (
          '<button class="modal-size-chip' + (isUnavail ? ' unavailable' : '') + '" data-size="' + s + '"' +
          (isUnavail ? ' data-unavailable="true"' : '') +
          ' onclick="qaSelectSize(this)">' + localizeNumber(s) + '</button>'
        );
      }).join('') +
      '</div></div>';
  }

  var qaFirstImg = p.images && p.images.length ? p.images[0] : null;
  var qaThumbInner = qaFirstImg
    ? '<img src="' + SERVER_BASE + qaFirstImg.url + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px" onerror="this.style.display=\'none\'">'
    : PLACEHOLDER_SVG;
  var qaThumbStyle = qaFirstImg ? '' : 'style="background:' + p.gradient + '"';

  document.getElementById('quick-add-popup').innerHTML =
    '<div class="qa-header">' +
    '<div class="qa-product-thumb" ' + qaThumbStyle + '>' + qaThumbInner + '</div>' +
    '<div class="qa-header-info">' +
    '<span class="qa-product-name">' + p.name[currentLang] + '</span>' +
    (p.price ? renderPriceHtml(p, 'qa-product-price') : '') +
    '</div>' +
    '<button class="qa-close" onclick="closeQuickAdd()">✕</button>' +
    '</div>' +
    colorsHtml +
    sizesHtml +
    '<div id="qa-stock-badge" class="modal-stock-badge-wrap"></div>' +
    '<button class="qa-confirm-btn" onclick="qaConfirm()">🛒 ' + t.add_to_cart + '</button>';

  document.getElementById('quick-add-overlay').classList.add('open');
  document.getElementById('quick-add-popup').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeQuickAdd() {
  document.getElementById('quick-add-overlay').classList.remove('open');
  document.getElementById('quick-add-popup').classList.remove('open');
  document.body.style.overflow = '';
}

function qaSelectColor(swatch) {
  if (swatch.dataset.unavailable === 'true') return;
  document.getElementById('qa-colors-row').querySelectorAll('.color-swatch').forEach(function(s) {
    s.classList.remove('selected');
  });
  swatch.classList.add('selected');
  _qaColor = swatch.dataset.colorKey;
  _qaSize  = null;
  var row = document.getElementById('qa-sizes-row');
  if (row) row.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });
  var nameEl = document.getElementById('qa-color-name');
  if (nameEl) { nameEl.textContent = COLORS[_qaColor] ? COLORS[_qaColor].name[currentLang] : ''; nameEl.style.color = ''; }
  var colorId = swatch.dataset.colorId ? Number(swatch.dataset.colorId) : null;
  qaUpdateSizeChips(colorId);
  qaUpdateStockBadge();
}

function qaSelectSize(chip) {
  if (chip.dataset.unavailable === 'true' || chip.dataset.outOfStock === 'true') return;
  var row = document.getElementById('qa-sizes-row');
  if (row) row.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });
  chip.classList.add('selected');
  _qaSize = chip.dataset.size;
  qaUpdateStockBadge();
}

function qaUpdateSizeChips(colorId) {
  var p = _qaProduct;
  if (!p || !p.inventory || !p.inventory.length) return;
  var row = document.getElementById('qa-sizes-row');
  if (!row) return;
  row.querySelectorAll('.modal-size-chip').forEach(function(chip) {
    if (chip.dataset.unavailable === 'true') return;
    var qty = getModalInventory(p, colorId, chip.dataset.size);
    if (qty !== null && qty === 0) {
      chip.classList.add('out-of-stock');
      chip.dataset.outOfStock = 'true';
    } else {
      chip.classList.remove('out-of-stock');
      chip.dataset.outOfStock = '';
    }
  });
}

function qaUpdateStockBadge() {
  var wrap = document.getElementById('qa-stock-badge');
  if (!wrap) return;
  var p = _qaProduct;
  var t = TRANSLATIONS[currentLang];
  if (!p || !p.inventory || !p.inventory.length) { wrap.innerHTML = ''; return; }
  var colorObj  = _qaColor ? (p.colors||[]).find(function(c) { return c.key === _qaColor; }) : null;
  var colorId   = colorObj ? colorObj.id : null;
  var needColor = p.colors && p.colors.length > 0;
  var needSize  = p.sizes  && p.sizes.length  > 0;
  if ((needColor && !_qaColor) || (needSize && !_qaSize)) { wrap.innerHTML = ''; return; }
  var qty = getModalInventory(p, needColor ? colorId : null, needSize ? _qaSize : null);
  if (qty === null) { wrap.innerHTML = ''; return; }
  if (qty === 0) {
    wrap.innerHTML = '<span class="stock-badge stock-out">' + (t.stock_out || 'ناموجود') + '</span>';
  } else {
    wrap.innerHTML = '<span class="stock-badge stock-in">' + (t.stock_count || 'موجودی') + ': ' + qty + ' ' + (t.stock_unit || 'عدد') + '</span>';
  }
}

function qaConfirm() {
  var p = _qaProduct;
  var t = TRANSLATIONS[currentLang];
  if (!p) return;

  if (p.colors && p.colors.length > 0 && !_qaColor) {
    var colorRow = document.getElementById('qa-colors-row');
    if (colorRow) {
      colorRow.style.animation = 'none';
      colorRow.offsetHeight;
      colorRow.style.animation = 'shake .35s ease';
    }
    var nameEl = document.getElementById('qa-color-name');
    if (nameEl) nameEl.style.color = '#ef4444';
    return;
  }

  if (p.sizes && p.sizes.length > 0 && !_qaSize) {
    var sizeRow = document.getElementById('qa-sizes-row');
    if (sizeRow) {
      sizeRow.style.animation = 'none';
      sizeRow.offsetHeight;
      sizeRow.style.animation = 'shake .35s ease';
    }
    return;
  }

  addToCart(p.id, _qaColor, _qaSize);

  var btn = document.querySelector('.qa-confirm-btn');
  if (btn) {
    btn.textContent = t.added_to_cart;
    btn.style.background = '#16a34a';
    setTimeout(function() {
      closeQuickAdd();
    }, 800);
  }
}

// ─── Filter state → URL hash ──────────────────────────────────────────────────
function saveFilterToHash() {
  var params = new URLSearchParams();
  if (currentCategory    && currentCategory    !== 'all') params.set('cat', currentCategory);
  if (currentGender      && currentGender      !== 'all') params.set('gender', currentGender);
  if (currentSubcategory && currentSubcategory !== '')    params.set('sub', currentSubcategory);
  var str = params.toString();
  history.replaceState(null, '', str ? '#' + str : window.location.pathname);
}

function restoreFilterFromHash() {
  var hash = window.location.hash.replace(/^#/, '');
  if (!hash || hash.includes('reset_token')) return;
  var params = new URLSearchParams(hash);
  var cat    = params.get('cat')    || 'all';
  var gender = params.get('gender') || 'all';
  var sub    = params.get('sub')    || null;
  currentCategory    = cat;
  currentGender      = gender;
  currentSubcategory = sub;
}

// ─── Shared Filter Handler ────────────────────────────────────────────────────
function handleFilterClick(el, scrollToProducts) {
  var cat    = el.dataset.filter || 'all';
  var gender = el.dataset.gender || 'all';
  var sub    = el.dataset.sub    || '';
  if (window.IS_PROFILE_PAGE) {
    var qp = '/?_cat=' + encodeURIComponent(cat);
    if (sub) qp += '&_sub=' + encodeURIComponent(sub);
    if (gender !== 'all') qp += '&_gender=' + encodeURIComponent(gender);
    window.location.href = qp;
    return;
  }
  currentCategory    = cat;
  currentGender      = gender;
  currentSubcategory = sub || null;
  currentColors      = [];
  currentSizes       = [];
  saveFilterToHash();

  // active state روی همه filter elements (sidebar + nav)
  var allFilterEls = document.querySelectorAll(
    '.sidebar-item[data-filter], .sidebar-sub-item, .nav-link[data-filter], .nav-drop-item, .mega-cat-title, .mega-sub-item, .mobile-menu a[data-filter]'
  );
  allFilterEls.forEach(function(item) {
    var match =
      (item.dataset.filter || 'all') === currentCategory &&
      (item.dataset.gender || 'all') === currentGender &&
      (item.dataset.sub    || '')    === (currentSubcategory || '');
    item.classList.toggle('active', match);
  });

  renderGrid();

  if (scrollToProducts) {
    setTimeout(function() {
      document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}

// ─── Sidebar Build (dynamic from API) ────────────────────────────────────────
function buildSidebar(categories) {
  var menu = document.getElementById('sidebar-menu');
  if (!menu) return;

  var t   = TRANSLATIONS[currentLang];
  var lbl = function(obj) {
    return currentLang === 'en' ? obj.label_en : currentLang === 'tr' ? obj.label_tr : obj.label_fa;
  };

  var html = '<a class="sidebar-item active" href="#" data-filter="all" data-gender="all" data-sub="" data-i18n="menu_all">' + (t.menu_all || 'همه محصولات') + '</a>';

  categories.forEach(function(cat) {
    var subs     = cat.subcategories || [];
    var catLabel = lbl(cat);

    if (subs.length) {
      html += '<div class="sidebar-group">';
      html += '<a class="sidebar-item has-sub" href="#" data-filter="' + cat.key + '" data-gender="all" data-sub="">';
      html += '<span>' + catLabel + '</span><span class="sidebar-chevron">‹</span>';
      html += '</a>';
      html += '<div class="sidebar-dropdown">';
      subs.forEach(function(sub) {
        html += '<a class="sidebar-sub-item" href="#" data-filter="' + cat.key + '" data-gender="all" data-sub="' + sub.key + '">' + lbl(sub) + '</a>';
      });
      html += '</div></div>';
    } else {
      html += '<a class="sidebar-item" href="#" data-filter="' + cat.key + '" data-gender="all" data-sub="">' + catLabel + '</a>';
    }
  });

  menu.innerHTML = html;
  initSidebar();
}

// ─── Sidebar Navigation ───────────────────────────────────────────────────────
function initSidebar() {
  document.querySelectorAll('.sidebar-item.has-sub').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      var group = item.closest('.sidebar-group');
      var isOpen = group.classList.contains('open');
      document.querySelectorAll('.sidebar-group.open').forEach(function(g) {
        g.classList.remove('open');
      });
      if (!isOpen) group.classList.add('open');
      handleFilterClick(item, false);
    });
  });

  document.querySelectorAll('.sidebar-item:not(.has-sub), .sidebar-sub-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      handleFilterClick(item, window.innerWidth < 900);
    });
  });
}

// ─── Mega Menu (All Products) ─────────────────────────────────────────────────
function buildMegaMenu(categories) {
  var mega = document.getElementById('nav-mega-all');
  if (!mega) return;

  var lbl = function(obj) {
    return currentLang === 'en' ? obj.label_en : currentLang === 'tr' ? obj.label_tr : obj.label_fa;
  };

  var isProfile = !!window.IS_PROFILE_PAGE;
  var html = '';
  categories.forEach(function(cat) {
    var catHref = isProfile
      ? ('/?_cat=' + encodeURIComponent(cat.key))
      : '#products';
    html += '<div class="mega-col" data-cat="' + cat.key + '">';
    html += '<a class="mega-cat-title" href="' + catHref + '" data-filter="' + cat.key + '" data-gender="all" data-sub="">' + lbl(cat) + '</a>';
    (cat.subcategories || []).forEach(function(sub) {
      var subHref = isProfile
        ? ('/?_cat=' + encodeURIComponent(cat.key) + '&_sub=' + encodeURIComponent(sub.key))
        : '#products';
      html += '<a class="mega-sub-item" href="' + subHref + '" data-filter="' + cat.key + '" data-gender="all" data-sub="' + sub.key + '">' + lbl(sub) + '</a>';
    });
    html += '</div>';
  });

  mega.innerHTML = html;

  if (!isProfile) {
    mega.addEventListener('click', function(e) {
      var item = e.target.closest('.mega-cat-title, .mega-sub-item');
      if (!item) return;
      e.preventDefault();
      handleFilterClick(item, true);
    });
  }
}

// ─── Header Nav Dropdowns ─────────────────────────────────────────────────────
function initNavDropdowns() {
  document.querySelectorAll('.nav-link[data-filter], .nav-drop-item, .mega-cat-title, .mega-sub-item, .mobile-menu a[data-filter]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      handleFilterClick(item, true);
      document.getElementById('mobile-menu').classList.remove('open');
    });
  });
}

// ─── Product Rendering ────────────────────────────────────────────────────────
function buildWhatsAppLink(productName) {
  var msg = encodeURIComponent('سلام، میخوام ' + productName + ' سفارش بدم');
  return 'https://wa.me/' + CONTACT.whatsapp + '?text=' + msg;
}

function renderCardSizesColors(p) {
  var t = TRANSLATIONS[currentLang];

  // ردیف سایز — همیشه جا داره، حتی اگه سایز نداشته باشه
  var sizesRow = '';
  if (p.sizes && p.sizes.length > 0) {
    sizesRow =
      '<div class="card-meta-row">' +
      '<span class="card-meta-label">' + t.sizes_label + '</span>' +
      '<div class="sizes-row">' +
      p.sizes.map(function(s) {
        return '<span class="size-chip">' + localizeNumber(s) + '</span>';
      }).join('') +
      '</div></div>';
  } else {
    sizesRow = '<div class="card-meta-row card-meta-row--ph"></div>';
  }

  // ردیف رنگ — همیشه جا داره
  var colorsRow = '';
  if (p.colors && p.colors.length > 0) {
    var dots = p.colors.slice(0, 6).map(function(c) {
      var ck = c.key || Object.keys(COLORS).find(function(k) { return COLORS[k] === c; }) || '';
      var isUnavail = p.unavailableColors && p.unavailableColors.indexOf(ck) !== -1;
      return '<span class="card-color-dot' + (isUnavail ? ' unavailable' : '') + '" style="background:' + c.hex + '" title="' + c.name[currentLang] + '"></span>';
    }).join('');
    var extra = p.colors.length > 6 ? '<span class="card-color-more">+' + (p.colors.length - 6) + '</span>' : '';
    colorsRow =
      '<div class="card-meta-row">' +
      '<span class="card-meta-label">' + t.color_label + '</span>' +
      '<div class="card-colors">' + dots + extra + '</div>' +
      '</div>';
  } else {
    colorsRow = '<div class="card-meta-row card-meta-row--ph"></div>';
  }

  return '<div class="card-meta-rows">' + sizesRow + colorsRow + '</div>';
}

function renderProduct(p) {
  var t    = TRANSLATIONS[currentLang];
  var name = p.name[currentLang];
  var desc = p.description[currentLang];
  var cat  = t['cat_' + p.category] || p.category;
  var tag  = p.tag ? '<div class="product-tag">' + (t['tag_' + p.tag] || p.tag) + '</div>' : '';

  var genderBadge = '';
  if (p.gender === 'female') {
    genderBadge = '<span class="gender-badge gender-female">' + t.gender_female + '</span>';
  } else if (p.gender === 'male') {
    genderBadge = '<span class="gender-badge gender-male">' + t.gender_male + '</span>';
  }

  var user  = getCurrentUser();
  var isFav = user && user.favorites && user.favorites.indexOf(p.id) !== -1;

  var firstImg = p.images && p.images.length ? p.images[0] : null;
  var imgInner = firstImg
    ? '<img src="' + SERVER_BASE + firstImg.url + '" alt="' + name + '" class="product-real-img" onerror="this.style.display=\'none\'">'
    : PLACEHOLDER_SVG;
  var imgStyle = firstImg ? '' : 'style="background:' + p.gradient + '"';

  var cameraTag = p.has_customer_photos
    ? '<span class="product-camera-badge" title="' + (t.cphoto_customer_photos || 'عکس‌های خریداران') + '">📷</span>'
    : '';

  return (
    '<div class="product-card" data-category="' + p.category + '" onclick="openModal(' + p.id + ')">' +
    '  <div class="product-image" ' + imgStyle + '>' +
    imgInner +
    '    <button class="fav-btn' + (isFav ? ' fav-active' : '') + '" onclick="toggleFavorite(event,' + p.id + ')" title="علاقه‌مندی">♥</button>' +
    tag +
    '  </div>' +
    '  <div class="product-body">' +
    '    <div class="card-badges">' +
    '      <span class="category-badge" style="' + catBadgeStyle(p.category) + '">' + cat + '</span>' +
    genderBadge +
    cameraTag +
    '    </div>' +
    '    <h3 class="product-name">' + name + '</h3>' +
    (p.code ? '    <div class="product-code-badge"><span class="product-code-label">' + (t.product_code_label || 'کد محصول') + ':</span> ' + p.code + '</div>' : '') +
    '    <p class="product-desc">' + desc + '</p>' +
    renderCardSizesColors(p) +
    renderPriceHtml(p, 'product-price') +
    '    <div class="product-delivery">⏱ ' + localizeNumber(p.delivery_days) + ' ' + t.delivery_unit + '</div>' +
    '    <div class="product-actions">' +
    '      <button class="buy-btn cart-add-btn" onclick="quickAdd(event,' + p.id + ')">' +
    '        🛒 ' + t.add_to_cart +
    '      </button>' +
    '    </div>' +
    '  </div>' +
    '</div>'
  );
}

function animateCards(grid) {
  grid.querySelectorAll('.product-card').forEach(function(card, i) {
    card.style.opacity   = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(function() {
      card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      card.style.opacity    = '1';
      card.style.transform  = 'translateY(0)';
    }, i * 55);
  });
}

var SVG_SEARCH = '<circle cx="27" cy="27" r="16"/><line x1="38" y1="38" x2="56" y2="56"/><line x1="20" y1="27" x2="34" y2="27"/><line x1="27" y1="20" x2="27" y2="34"/>';
var SVG_FILTER = '<line x1="4" y1="12" x2="60" y2="12"/><line x1="12" y1="32" x2="52" y2="32"/><line x1="22" y1="52" x2="42" y2="52"/>';
var SVG_CART   = '<path d="M8 8h6l10 30h26l6-20H20"/><circle cx="26" cy="52" r="4" fill="currentColor" stroke="none"/><circle cx="44" cy="52" r="4" fill="currentColor" stroke="none"/>';
var SVG_HEART  = '<path d="M32 52S8 36 8 20a14 14 0 0124-9.9A14 14 0 0156 20c0 16-24 32-24 32z"/>';

function gridEmpty(t) {
  if (currentSearch) {
    return '<div class="grid-empty-wrap">'
         + emptyView(SVG_SEARCH,
             t.search_no_result || 'محصولی یافت نشد',
             '"' + currentSearch + '"',
             null, null)
         + '</div>';
  }
  var hasFilters = currentColors.length > 0 || currentSizes.length > 0;
  if (hasFilters) {
    return '<div class="grid-empty-wrap">'
         + emptyView(SVG_FILTER,
             t.empty_filter_title  || 'نتیجه‌ای یافت نشد',
             t.empty_filter_hint   || 'فیلترهای انتخابی با هیچ محصولی مطابقت ندارد',
             t.filter_clear        || '× پاک کردن فیلترها',
             'clearFilters()')
         + '</div>';
  }
  return '<div class="grid-empty-wrap">'
       + emptyView(SVG_SEARCH,
           t.no_products          || 'محصولی یافت نشد',
           t.empty_cat_hint       || 'در این دسته‌بندی محصولی ثبت نشده است',
           null, null)
       + '</div>';
}

function emptyView(svgPath, title, hint, btnLabel, btnOnclick) {
  var html = '<div class="empty-view">'
           + '<svg class="empty-view-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + svgPath + '</svg>'
           + '<p class="empty-view-title">' + title + '</p>';
  if (hint)      html += '<p class="empty-view-hint">' + hint + '</p>';
  if (btnLabel)  html += '<button class="empty-view-btn" onclick="' + btnOnclick + '">' + btnLabel + '</button>';
  html += '</div>';
  return html;
}

function getSubcatLabel(sub) {
  return currentLang === 'en' ? sub.label_en : currentLang === 'tr' ? sub.label_tr : sub.label_fa;
}

function catHasProducts(catKey, genderFilter) {
  return products.some(function(p) {
    var inCat = p.category === catKey || (p.extra_categories || []).some(function(ec) { return ec.category === catKey; });
    if (!inCat) return false;
    if (genderFilter && genderFilter !== 'all') {
      if (p.gender !== genderFilter && p.gender !== 'unisex') return false;
    }
    return p.stock > 0;
  });
}

function subcatHasProducts(subKey, genderFilter) {
  if (!subKey) return true;
  return products.some(function(p) {
    var inSub = p.subcategory === subKey || (p.extra_categories || []).some(function(ec) { return ec.subcategory === subKey; });
    if (!inSub) return false;
    if (genderFilter && genderFilter !== 'all') {
      if (p.gender !== genderFilter && p.gender !== 'unisex') return false;
    }
    return p.stock > 0;
  });
}

function updateNavVisibility() {
  document.querySelectorAll('.nav-drop-item[data-sub]').forEach(function(el) {
    el.style.display = '';
  });
  document.querySelectorAll('.nav-drop-group').forEach(function(group) {
    group.style.display = '';
  });
}

function applySort(list) {
  var sorted = list.slice();
  if (currentSort === 'price_asc')  sorted.sort(function(a, b) { return a.price - b.price; });
  else if (currentSort === 'price_desc') sorted.sort(function(a, b) { return b.price - a.price; });
  else if (currentSort === 'most_sold')  sorted.sort(function(a, b) { return (b.sales || 0) - (a.sales || 0); });
  else sorted.sort(function(a, b) { return b.id - a.id; }); // newest
  return sorted;
}

function renderFilterBar(baseList) {
  var bar = document.getElementById('filter-bar');
  if (!bar) return;
  var t = TRANSLATIONS[currentLang];

  var colorMap = {};
  baseList.forEach(function(p) {
    (p.colors || []).forEach(function(c) { if (c.key && !colorMap[c.key]) colorMap[c.key] = c; });
  });
  var sizeSet = {};
  baseList.forEach(function(p) { (p.sizes || []).forEach(function(s) { sizeSet[s] = true; }); });

  var hasAvailFilters = Object.keys(colorMap).length > 0 || Object.keys(sizeSet).length > 0;
  var activeCount = currentColors.length + currentSizes.length;

  var html = '<div class="filter-bar-inner">';

  if (hasAvailFilters) {
    html += '<button class="filter-toggle-btn' + (activeCount > 0 ? ' has-active' : '') + '" onclick="openFilterPanel()">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>'
          + '<span>' + (t.filter_btn || 'فیلتر') + '</span>';
    if (activeCount > 0) html += '<span class="filter-active-badge">' + activeCount + '</span>';
    html += '</button>';
  }

  var searchPh = t.search_placeholder || 'جستجو...';
  html += '<div class="filter-search-wrap">'
        + '<span class="filter-search-icon">🔍</span>'
        + '<input type="text" class="filter-search-input" id="site-search-input"'
        + ' placeholder="' + searchPh.replace(/"/g, '&quot;') + '"'
        + ' value="' + currentSearch.replace(/"/g, '&quot;') + '"'
        + ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'
        + ' readonly onfocus="this.removeAttribute(\'readonly\')"'
        + ' oninput="siteSearch(this.value)"'
        + '/>'
        + '</div>';

  html += '<div class="filter-sort-group">';
  html += '<span class="filter-label">' + (t.sort_label || 'مرتب‌سازی') + '</span>';
  [
    { key: 'newest',     label: t.sort_newest     || 'جدیدترین' },
    { key: 'price_asc',  label: t.sort_price_asc  || 'قیمت: کم به زیاد' },
    { key: 'price_desc', label: t.sort_price_desc || 'قیمت: زیاد به کم' },
    { key: 'most_sold',  label: t.sort_most_sold  || 'پرفروش‌ترین' },
  ].forEach(function(s) {
    html += '<button class="sort-chip' + (currentSort === s.key ? ' active' : '') + '" '
          + 'onclick="setSort(\'' + s.key + '\')">' + s.label + '</button>';
  });
  html += '</div>';

  html += '</div>';
  bar.innerHTML = html;
}

function renderFilterDrawerBody(baseList) {
  var body   = document.getElementById('filter-drawer-body');
  var footer = document.getElementById('filter-drawer-footer');
  if (!body) return;
  var t = TRANSLATIONS[currentLang];

  var colorMap = {};
  baseList.forEach(function(p) {
    (p.colors || []).forEach(function(c) { if (c.key && !colorMap[c.key]) colorMap[c.key] = c; });
  });
  var availColors = Object.values(colorMap);

  var sizeSet = {};
  baseList.forEach(function(p) { (p.sizes || []).forEach(function(s) { sizeSet[s] = true; }); });
  var availSizes = Object.keys(sizeSet).sort();

  var html = '';

  if (availColors.length) {
    html += '<div class="fd-section">';
    html += '<div class="fd-section-title">' + (t.filter_color || 'رنگ') + '</div>';
    html += '<div class="fd-colors-grid">';
    availColors.forEach(function(c) {
      var checked = currentColors.indexOf(c.key) !== -1;
      var name = (c.name && c.name[currentLang]) || (c.name && c.name.fa) || c.key;
      html += '<label class="fd-color-cell' + (checked ? ' checked' : '') + '">'
            + '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="toggleColorFilter(\'' + c.key.replace(/'/g, "\\'") + '\')">'
            + '<span class="fd-color-dot" style="background:' + c.hex + '"></span>'
            + '<span class="fd-color-name">' + name + '</span>'
            + '</label>';
    });
    html += '</div></div>';
  }

  if (availSizes.length) {
    html += '<div class="fd-section">';
    html += '<div class="fd-section-title">' + (t.filter_size || 'سایز') + '</div>';
    html += '<div class="fd-sizes-grid">';
    availSizes.forEach(function(s) {
      var checked = currentSizes.indexOf(s) !== -1;
      html += '<label class="fd-size-tile' + (checked ? ' checked' : '') + '">'
            + '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="toggleSizeFilter(\'' + s.replace(/'/g, "\\'") + '\')">'
            + '<span>' + s + '</span>'
            + '</label>';
    });
    html += '</div></div>';
  }

  body.innerHTML = html;

  if (footer) {
    var activeCount = currentColors.length + currentSizes.length;
    footer.innerHTML = activeCount > 0
      ? '<button class="fd-clear-btn" onclick="clearFilters()">' + (t.filter_clear || '× پاک کردن') + '</button>'
        + '<button class="fd-close-btn" onclick="closeFilterPanel()">' + (t.filter_close || 'بستن') + '</button>'
      : '<button class="fd-close-btn fd-close-full" onclick="closeFilterPanel()">' + (t.filter_close || 'بستن') + '</button>';
  }
}

function openFilterPanel() {
  var overlay = document.getElementById('filter-overlay');
  var drawer  = document.getElementById('filter-drawer');
  if (overlay) overlay.classList.add('open');
  if (drawer)  drawer.classList.add('open');
  renderFilterDrawerBody(_filterBaseList);
}

function closeFilterPanel() {
  var overlay = document.getElementById('filter-overlay');
  var drawer  = document.getElementById('filter-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer)  drawer.classList.remove('open');
}

function toggleColorFilter(key) {
  var idx = currentColors.indexOf(key);
  if (idx === -1) currentColors.push(key);
  else currentColors.splice(idx, 1);
  renderGrid();
}
function toggleSizeFilter(label) {
  var idx = currentSizes.indexOf(label);
  if (idx === -1) currentSizes.push(label);
  else currentSizes.splice(idx, 1);
  renderGrid();
}
function setSort(sort) {
  currentSort = sort;
  renderGrid();
}
function clearFilters() {
  currentColors = [];
  currentSizes  = [];
  renderGrid();
}

function siteSearch(val) {
  currentSearch = (val || '').trim();
  renderGrid(true);
}

function renderGrid(skipFilterBar) {
  var grid = document.getElementById('products-grid');
  var t    = TRANSLATIONS[currentLang];

  var baseList = products.filter(function(p) {
    if (currentCategory !== 'all') {
      var inCat = p.category === currentCategory ||
        (p.extra_categories || []).some(function(ec) { return ec.category === currentCategory; });
      if (!inCat) return false;
    }
    if (currentGender !== 'all' && p.gender && p.gender !== currentGender) return false;
    return true;
  });

  _filterBaseList = baseList;
  if (!skipFilterBar) {
    renderFilterBar(baseList);
    var drawer = document.getElementById('filter-drawer');
    if (drawer && drawer.classList.contains('open')) renderFilterDrawerBody(baseList);
  }

  var filteredList = baseList.filter(function(p) {
    if (currentColors.length && !p.colors.some(function(c) { return currentColors.indexOf(c.key) !== -1; })) return false;
    if (currentSizes.length  && !p.sizes.some(function(s)  { return currentSizes.indexOf(s)  !== -1; })) return false;
    if (currentSearch) {
      var q = currentSearch.toLowerCase();
      var n = p.name || {};
      var d = p.description || {};
      var inName = (n.fa && n.fa.toLowerCase().indexOf(q) !== -1) ||
                   (n.en && n.en.toLowerCase().indexOf(q) !== -1) ||
                   (n.tr && n.tr.toLowerCase().indexOf(q) !== -1);
      var inDesc = (d.fa && d.fa.toLowerCase().indexOf(q) !== -1) ||
                   (d.en && d.en.toLowerCase().indexOf(q) !== -1) ||
                   (d.tr && d.tr.toLowerCase().indexOf(q) !== -1);
      var inCode = p.code && p.code.toLowerCase().indexOf(q) !== -1;
      if (!inName && !inDesc && !inCode) return false;
    }
    return true;
  });

  filteredList = applySort(filteredList);

  // Specific subcategory or all-categories → flat grid
  if (currentSubcategory || currentCategory === 'all') {
    var list = currentSubcategory
      ? filteredList.filter(function(p) {
          return p.subcategory === currentSubcategory ||
            (p.extra_categories || []).some(function(ec) { return ec.subcategory === currentSubcategory; });
        })
      : filteredList;
    grid.innerHTML = list.length
      ? list.map(renderProduct).join('')
      : gridEmpty(t);
    animateCards(grid);
    return;
  }

  // Category selected, no subcategory → group by subcategory
  var catObj = cachedCategories.find(function(c) { return c.key === currentCategory; });
  var subs   = catObj
    ? (catObj.subcategories || [])
    : (SUBCATEGORIES[currentCategory] || []).filter(function(s) { return s.key; });

  if (!subs.length) {
    grid.innerHTML = filteredList.length
      ? filteredList.map(renderProduct).join('')
      : gridEmpty(t);
    animateCards(grid);
    return;
  }

  var html = '';
  subs.forEach(function(sub) {
    var subKey   = sub.key;
    var subLabel = getSubcatLabel(sub);
    var subProds = filteredList.filter(function(p) {
      return p.subcategory === subKey ||
        (p.extra_categories || []).some(function(ec) { return ec.subcategory === subKey; });
    });

    if (!subProds.length) return;

    html += '<div class="subcat-section">';
    html += '<div class="subcat-header">'
          + '<span class="subcat-header-title">' + subLabel + '</span>'
          + '<span class="subcat-header-count">' + subProds.length + '</span>'
          + '</div>';
    html += '<div class="subcat-grid">' + subProds.map(renderProduct).join('') + '</div>';
    html += '</div>';
  });

  grid.innerHTML = html || gridEmpty(t);
  animateCards(grid);
}


// ─── Language Switching ───────────────────────────────────────────────────────
function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang_v2', lang);

  var t   = TRANSLATIONS[lang];
  var doc = document.documentElement;

  doc.setAttribute('dir',  t.dir);
  doc.setAttribute('lang', t.lang_attr);
  document.body.setAttribute('dir', t.dir);

  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) el.textContent = t[key];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-ph');
    if (t[key] !== undefined) el.placeholder = t[key];
  });
  // Rebuild scrolling announcement marquee
  var annTrack = document.getElementById('announcement-track');
  if (annTrack && t.announcement) {
    var annItems = t.announcement.split('|').map(function(s) { return s.trim(); }).filter(Boolean);
    var annHtml = annItems.map(function(item) {
      return '<span class="ann-item">' + item + '</span><span class="ann-sep">✦</span>';
    }).join('');
    annTrack.innerHTML = annHtml + annHtml;
  }
  clearAuthErrors();
  updateAuthUI();
  // اگه profile modal باز بود محتوای تب فعلی رو دوباره رندر کن
  if (document.getElementById('profile-modal').classList.contains('open')) {
    var activeTab = document.querySelector('.profile-page-nav-item.active');
    if (activeTab) showProfileTab(activeTab.dataset.tab);
  }
  // اگه fav page باز بود دوباره رندر کن
  var _favPageEl = document.getElementById('fav-page');
  if (_favPageEl && _favPageEl.classList.contains('open')) {
    renderFavPanel();
  }

  // Globe switcher
  var labelEl = document.getElementById('site-lang-label');
  if (labelEl) labelEl.textContent = lang.toUpperCase();
  document.querySelectorAll('.site-lang-opt, .mobile-lang-opt').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  var display = lang === 'fa' ? CONTACT.phoneDisplay : CONTACT.phoneDisplayLatin;
  document.querySelectorAll('.js-phone').forEach(function(el) { el.textContent = display; el.dir = 'ltr'; });

  if (!window.IS_PROFILE_PAGE) {
    if (cachedCategories.length) { buildSidebar(cachedCategories); buildMegaMenu(cachedCategories); }
    renderGrid();
    renderBanner();
  }
  updateCartBadge();
}

function initLangSwitcher() {
  document.querySelectorAll('.site-lang-opt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      applyLang(btn.dataset.lang);
      document.getElementById('site-lang-menu').classList.add('hidden');
    });
  });
  document.querySelectorAll('.mobile-lang-opt').forEach(function(btn) {
    btn.addEventListener('click', function() { applyLang(btn.dataset.lang); });
  });
  document.addEventListener('click', function(e) {
    var wrap = document.getElementById('site-lang-wrap');
    var menu = document.getElementById('site-lang-menu');
    if (menu && wrap && !wrap.contains(e.target)) menu.classList.add('hidden');
  });
}

function toggleSiteLangMenu(e) {
  e.stopPropagation();
  document.getElementById('site-lang-menu').classList.toggle('hidden');
}

// ─── Header Scroll ────────────────────────────────────────────────────────────
function initHeaderScroll() {
  var header = document.getElementById('header');
  var scrollTopBtn = document.getElementById('scroll-top-btn');
  window.addEventListener('scroll', function() {
    header.classList.toggle('scrolled', window.scrollY > 60);
    if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', window.scrollY > 300);
  });
}

// ─── Mobile Menu ──────────────────────────────────────────────────────────────
function toggleMenu() {
  document.getElementById('mobile-menu').classList.toggle('open');
}

// ─── Contact Info ─────────────────────────────────────────────────────────────
function fillContactInfo() {
  document.querySelectorAll('.js-phone').forEach(function(el) {
    el.textContent = CONTACT.phoneDisplay;
    el.dir = 'ltr';
  });
  document.querySelectorAll('.js-phone-link').forEach(function(el) {
    el.href = 'tel:+' + CONTACT.whatsapp;
  });
  document.querySelectorAll('.js-wa-link').forEach(function(el) {
    el.href = 'https://wa.me/' + CONTACT.whatsapp;
  });
  document.querySelectorAll('.js-tg-link').forEach(function(el) {
    el.href = 'https://t.me/' + CONTACT.telegram;
  });
}

// ─── Smooth Scroll ────────────────────────────────────────────────────────────
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('mobile-menu').classList.remove('open');
      }
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function getGradientVariants(gradient) {
  var angles = [135, 45, 200, 270];
  return angles.map(function(deg) {
    return gradient.replace(/\d+deg/g, deg + 'deg');
  });
}

function getModalInventory(p, colorId, sizeLabel) {
  if (!p || !p.inventory || !p.inventory.length) return null;
  var cid = colorId == null ? null : Number(colorId);
  var sl  = sizeLabel || null;
  var entry = p.inventory.find(function(i) {
    return (i.color_id === cid) && (i.size_label === sl || (!i.size_label && !sl));
  });
  return entry ? entry.quantity : null;
}

function isColorOutOfStock(p, colorId) {
  if (!p.inventory || !p.inventory.length) return false;
  var entries = p.inventory.filter(function(i) { return i.color_id === colorId; });
  if (!entries.length) return false;
  return entries.every(function(i) { return i.quantity === 0; });
}

function updateSizeChipsForColor(colorId) {
  var p = window._modalProduct;
  if (!p || !p.inventory || !p.inventory.length) return;
  document.querySelectorAll('.modal-size-chip').forEach(function(chip) {
    var size = chip.dataset.size;
    var qty  = getModalInventory(p, colorId, size);
    if (qty !== null && qty === 0) {
      chip.classList.add('out-of-stock');
      chip.dataset.outOfStock = 'true';
    } else {
      chip.classList.remove('out-of-stock');
      chip.dataset.outOfStock = '';
    }
  });
}

function updateModalStockBadge() {
  var wrap = document.getElementById('modal-stock-badge');
  if (!wrap) return;
  var p         = window._modalProduct;
  var colorKey  = window._modalSelectedColor;
  var size      = window._modalSelectedSize;
  var t         = TRANSLATIONS[currentLang];
  if (!p || !p.inventory || !p.inventory.length) { wrap.innerHTML = ''; return; }
  var colorObj  = colorKey ? (p.colors || []).find(function(c) { return c.key === colorKey; }) : null;
  var colorId   = colorObj ? colorObj.id : null;
  var needColor = p.colors && p.colors.length > 0;
  var needSize  = p.sizes  && p.sizes.length  > 0;
  if ((needColor && !colorKey) || (needSize && !size)) { wrap.innerHTML = ''; return; }
  var qty = getModalInventory(p, needColor ? colorId : null, needSize ? size : null);
  if (qty === null) { wrap.innerHTML = ''; return; }
  if (qty === 0) {
    wrap.innerHTML = '<span class="stock-badge stock-out">' + (t.stock_out || 'ناموجود') + '</span>';
  } else {
    wrap.innerHTML = '<span class="stock-badge stock-in">' + (t.stock_count || 'موجودی') + ': ' + qty + ' ' + (t.stock_unit || 'عدد') + '</span>';
  }
}

function openModal(productId) {
  window.location.href = '/product.html?id=' + productId + '&lang=' + currentLang;
  return;
  var p = products.find(function(pr) { return pr.id === productId; });
  if (!p) return;

  window._modalProduct       = p;
  window._modalSelectedColor = null;
  window._modalSelectedSize  = null;

  var t         = TRANSLATIONS[currentLang];
  var name      = p.name[currentLang];
  var desc      = p.description[currentLang];
  window._modalDescFull = desc || '';
  var cat       = t['cat_' + p.category] || p.category;
  var phoneDisp = currentLang === 'fa' ? CONTACT.phoneDisplay : CONTACT.phoneDisplayLatin;
  var variants   = getGradientVariants(p.gradient);
  var allMedia   = p.media && p.media.length ? p.media : (p.images || []).concat(p.videos || []);
  var hasMedia   = allMedia.length > 0;

  // thumbnail strip — real media if available, else gradient variants
  var thumbsHtml = hasMedia
    ? allMedia.map(function(m, i) {
        if (m.type === 'video') {
          return '<div class="modal-thumb modal-thumb-video' + (i === 0 ? ' active' : '') + '"'
            + ' data-video-src="' + SERVER_BASE + m.url + '"'
            + ' onclick="switchThumb(this)">'
            + '<span class="thumb-play-icon">▶</span>'
            + '</div>';
        }
        return '<div class="modal-thumb' + (i === 0 ? ' active' : '') + '"'
          + ' data-img-src="' + SERVER_BASE + m.url + '"'
          + ' onclick="switchThumb(this)">'
          + '<img src="' + SERVER_BASE + m.url + '">'
          + '</div>';
      }).join('')
    : variants.map(function(g, i) {
        return '<div class="modal-thumb' + (i === 0 ? ' active' : '') + '"'
          + ' style="background:' + g + '"'
          + ' onclick="switchThumb(this)">'
          + PLACEHOLDER_SVG + '</div>';
      }).join('');

  // color swatches
  var colorsHtml = '';
  if (p.colors && p.colors.length > 0) {
    colorsHtml =
      '<div class="modal-colors-section">' +
      '<span class="modal-label">' + t.color_label + '</span>' +
      '<div class="modal-colors-row">' +
      p.colors.map(function(colorObj) {
        var colorKey   = colorObj.key || '';
        var isUnavail  = p.unavailableColors && p.unavailableColors.indexOf(colorKey) !== -1;
        var isNoStock  = !isUnavail && isColorOutOfStock(p, colorObj.id);
        var cls = 'color-swatch' + (isUnavail ? ' unavailable' : '') + (isNoStock ? ' out-of-stock' : '');
        return (
          '<button class="' + cls + '" data-color-key="' + colorKey + '" data-color-id="' + colorObj.id + '"' +
          ((isUnavail || isNoStock) ? ' data-unavailable="true"' : '') +
          ' style="background:' + colorObj.hex + '"' +
          ' title="' + colorObj.name[currentLang] + '"' +
          ' onclick="selectModalColor(this)"></button>'
        );
      }).join('') +
      '</div>' +
      '<span class="color-selected-name" id="color-selected-name">' + t.select_color + '</span>' +
      '</div>';
  }

  // size chips
  var sizesHtml = '';
  if (p.sizes && p.sizes.length) {
    sizesHtml =
      '<div class="modal-sizes-section">' +
      '<div class="modal-sizes-header">' +
      '<span class="modal-label">' + t.sizes_label + '</span>' +
      '<span id="modal-stock-badge" class="modal-stock-badge-wrap"></span>' +
      '</div>' +
      '<div class="modal-sizes-row">' +
      p.sizes.map(function(s) {
        var isUnavail = p.unavailableSizes && p.unavailableSizes.indexOf(s) !== -1;
        return (
          '<button class="modal-size-chip' + (isUnavail ? ' unavailable' : '') + '" data-size="' + s + '"' +
          (isUnavail ? ' data-unavailable="true"' : '') +
          ' onclick="selectModalSize(this)">' +
          localizeNumber(s) + '</button>'
        );
      }).join('') +
      '</div></div>';
  }

  var waHref = buildWhatsAppLink(name);
  var tgHref = 'https://t.me/' + CONTACT.telegram;

  var modalGenderBadge = '';
  if (p.gender === 'female') {
    modalGenderBadge = '<span class="gender-badge gender-female">' + t.gender_female + '</span>';
  } else if (p.gender === 'male') {
    modalGenderBadge = '<span class="gender-badge gender-male">' + t.gender_male + '</span>';
  }

  var firstMedia   = allMedia[0] || null;
  var mainImgInner = firstMedia
    ? (firstMedia.type === 'video'
        ? '<video src="' + SERVER_BASE + firstMedia.url + '" controls></video>'
        : '<img src="' + SERVER_BASE + firstMedia.url + '" onerror="this.style.display=\'none\'">')
    : PLACEHOLDER_SVG;
  var mainImgStyle = firstMedia ? '' : 'style="background:' + variants[0] + '"';

  var WA_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  var TG_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

  document.getElementById('modal-panel').innerHTML =
    '<button class="modal-close" onclick="closeModalBtn()">✕</button>' +
    '<div class="modal-body">' +
    '  <div class="modal-gallery">' +
    '    <div class="modal-img-frame">' +
    '      <div class="modal-main-img" id="modal-main-img" ' + mainImgStyle + '>' +
    mainImgInner +
    '      </div>' +
    (allMedia.length > 1 ?
      '<button class="modal-arrow modal-arrow-prev" onclick="modalArrow(-1)">&#8249;</button>' +
      '<button class="modal-arrow modal-arrow-next" onclick="modalArrow(1)">&#8250;</button>' : '') +
    '    </div>' +
    '    <div class="modal-thumbs" id="modal-thumbs">' + thumbsHtml + '</div>' +
    '    <div id="modal-customer-photos" style="padding:32px 4px 4px"></div>' +
    '  </div>' +
    '  <div class="modal-info">' +
    '    <div class="card-badges">' +
    '      <span class="category-badge" style="' + catBadgeStyle(p.category) + '">' + cat + '</span>' +
    modalGenderBadge +
    '    </div>' +
    '    <h2 class="modal-name">' + name + '</h2>' +
    renderPriceHtml(p, 'modal-price') +
    (p.code ? '    <div class="product-code-badge copyable" onclick="copyProductCode(\'' + p.code + '\')" title="Copy code"><span class="product-code-label">' + (t.product_code_label || 'کد محصول') + ':</span> ' + p.code + '</div>' : '') +
    '    <div class="modal-desc-wrap" id="modal-desc-wrap">' +
    '      <p class="modal-desc" id="modal-desc-text">' + desc.replace(/\n/g,'<br>') + '</p>' +
    '    </div>' +
    colorsHtml +
    sizesHtml +
    '    <div class="modal-buy-section">' +
    '      <button class="modal-add-to-cart" id="modal-add-to-cart" onclick="addToCartFromModal()">🛒 ' + t.add_to_cart + '</button>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  setTimeout(function() {
    var descEl   = document.getElementById('modal-desc-text');
    if (!descEl) return;
    var lh       = parseFloat(getComputedStyle(descEl).lineHeight) || 22;
    var maxH     = Math.round(lh * 4);
    var fullText = window._modalDescFull || '';
    if (descEl.scrollHeight <= maxH + 2) return;
    var moreTxt  = currentLang==='fa' ? ' بیشتر...' : currentLang==='tr' ? ' daha fazla...' : ' more...';
    descEl.textContent  = fullText;
    descEl.style.whiteSpace = 'pre-line';
    descEl.style.maxHeight  = maxH + 'px';
    descEl.style.overflow   = 'hidden';
    var moreSpan = document.createElement('span');
    moreSpan.className   = 'modal-desc-more';
    moreSpan.id          = 'modal-desc-more';
    moreSpan.textContent = moreTxt;
    moreSpan.onclick     = toggleModalDesc;
    descEl.appendChild(moreSpan);
    var tn = descEl.firstChild;
    while (descEl.scrollHeight > maxH + 2 && tn && tn.nodeType === 3 && tn.textContent.length > 1) {
      tn.textContent = tn.textContent.slice(0, -1);
    }
    if (tn && tn.nodeType === 3) tn.textContent = tn.textContent.trimEnd();
  }, 0);

  var photoContainer = document.getElementById('modal-customer-photos');
  if (photoContainer) loadProductPhotos(productId, photoContainer);
}

function toggleModalDesc() {
  var descEl   = document.getElementById('modal-desc-text');
  var descWrap = document.getElementById('modal-desc-wrap');
  if (!descEl) return;
  var fullText = window._modalDescFull || '';
  var lh   = parseFloat(getComputedStyle(descEl).lineHeight) || 22;
  var maxH = Math.round(lh * 4);

  if (!descEl.classList.contains('expanded')) {
    descEl.classList.add('expanded');
    descEl.style.maxHeight  = '';
    descEl.style.overflow   = '';
    descEl.style.whiteSpace = 'pre-line';
    descEl.textContent = fullText;
    var lessSpan = document.createElement('span');
    lessSpan.className   = 'modal-desc-more modal-desc-less';
    lessSpan.id          = 'modal-desc-more';
    lessSpan.textContent = currentLang==='fa'?' کمتر':currentLang==='tr'?' daha az':' less';
    lessSpan.onclick     = toggleModalDesc;
    if (descWrap) descWrap.appendChild(lessSpan);
  } else {
    descEl.classList.remove('expanded');
    var old = document.getElementById('modal-desc-more');
    if (old && old.parentNode === descWrap) old.remove();
    descEl.textContent = fullText;
    descEl.style.whiteSpace = 'pre-line';
    descEl.style.maxHeight  = maxH + 'px';
    descEl.style.overflow   = 'hidden';
    var moreTxt  = currentLang==='fa' ? ' بیشتر...' : currentLang==='tr' ? ' daha fazla...' : ' more...';
    var moreSpan = document.createElement('span');
    moreSpan.className   = 'modal-desc-more';
    moreSpan.id          = 'modal-desc-more';
    moreSpan.textContent = moreTxt;
    moreSpan.onclick     = toggleModalDesc;
    descEl.appendChild(moreSpan);
    var tn = descEl.firstChild;
    while (descEl.scrollHeight > maxH + 2 && tn && tn.nodeType === 3 && tn.textContent.length > 1) {
      tn.textContent = tn.textContent.slice(0, -1);
    }
    if (tn && tn.nodeType === 3) tn.textContent = tn.textContent.trimEnd();
  }
}

function addToCartFromModal() {
  var p = window._modalProduct;
  var t = TRANSLATIONS[currentLang];

  if (p.colors && p.colors.length > 0 && !window._modalSelectedColor) {
    var colorRow = document.querySelector('.modal-colors-row');
    if (colorRow) {
      colorRow.style.animation = 'none';
      colorRow.offsetHeight; // reflow
      colorRow.style.animation = 'shake .35s ease';
    }
    var nameEl = document.getElementById('color-selected-name');
    if (nameEl) nameEl.style.color = '#ef4444';
    return;
  }

  if (p.sizes && p.sizes.length > 0 && !window._modalSelectedSize) {
    var sizeRow = document.querySelector('.modal-sizes-row');
    if (sizeRow) {
      sizeRow.style.animation = 'none';
      sizeRow.offsetHeight;
      sizeRow.style.animation = 'shake .35s ease';
    }
    return;
  }

  addToCart(p.id, window._modalSelectedColor, window._modalSelectedSize);

  var btn = document.getElementById('modal-add-to-cart');
  if (btn) {
    btn.innerHTML = t.added_to_cart;
    btn.style.background = '#16a34a';
    setTimeout(function() {
      btn.innerHTML = '🛒 ' + t.add_to_cart;
      btn.style.background = '';
    }, 1600);
  }
}

function selectModalColor(swatch) {
  if (swatch.dataset.unavailable === 'true') return;
  swatch.closest('.modal-colors-row').querySelectorAll('.color-swatch').forEach(function(s) {
    s.classList.remove('selected');
  });
  swatch.classList.add('selected');
  window._modalSelectedColor = swatch.dataset.colorKey;
  window._modalSelectedSize  = null;
  document.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });

  var colorKey  = swatch.dataset.colorKey;
  var colorId   = swatch.dataset.colorId ? Number(swatch.dataset.colorId) : null;
  var colorName = COLORS[colorKey] ? COLORS[colorKey].name[currentLang] : '';
  var nameEl    = document.getElementById('color-selected-name');
  if (nameEl) { nameEl.textContent = colorName; nameEl.style.color = ''; }

  updateSizeChipsForColor(colorId);
  updateModalStockBadge();
  updateModalWALink();
}

function updateModalWALink() {
  var p = window._modalProduct;
  if (!p) return;
  var name      = p.name[currentLang];
  var colorKey  = window._modalSelectedColor;
  var size      = window._modalSelectedSize;
  var colorName = colorKey && COLORS[colorKey] ? COLORS[colorKey].name[currentLang] : '';
  var sizeDisp  = size ? toLatinNumbers(size) : '';

  var msg = 'سلام، میخوام ' + name;
  if (colorName) msg += ' رنگ ' + colorName;
  if (sizeDisp)  msg += ' سایز ' + sizeDisp;
  msg += ' سفارش بدم';

  var waBtn = document.getElementById('modal-wa-btn');
  if (waBtn) waBtn.href = 'https://wa.me/' + CONTACT.whatsapp + '?text=' + encodeURIComponent(msg);
}

function closeModalBtn() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function modalArrow(dir) {
  var thumbs = document.getElementById('modal-thumbs');
  if (!thumbs) return;
  var all    = Array.from(thumbs.querySelectorAll('.modal-thumb'));
  var active = thumbs.querySelector('.modal-thumb.active');
  var idx    = all.indexOf(active);
  var next   = (idx + dir + all.length) % all.length;
  switchThumb(all[next]);
}

function switchThumb(thumb) {
  var thumbs = document.getElementById('modal-thumbs');
  thumbs.querySelectorAll('.modal-thumb').forEach(function(t) { t.classList.remove('active'); });
  thumb.classList.add('active');
  var mainImg = document.getElementById('modal-main-img');
  var imgSrc  = thumb.dataset.imgSrc;
  var vidSrc  = thumb.dataset.videoSrc;
  if (vidSrc) {
    mainImg.style.background = '';
    mainImg.innerHTML = '<video src="' + vidSrc + '" controls autoplay></video>';
  } else if (imgSrc) {
    mainImg.style.background = '';
    mainImg.innerHTML = '<img src="' + imgSrc + '">';
  } else {
    mainImg.style.background = thumb.style.background;
    var p = window._modalProduct;
    if (p) mainImg.innerHTML = PLACEHOLDER_SVG;
  }
}

function selectModalSize(chip) {
  if (chip.dataset.unavailable === 'true' || chip.dataset.outOfStock === 'true') return;
  var row = chip.parentElement;
  row.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });
  chip.classList.add('selected');
  window._modalSelectedSize = chip.dataset.size;
  updateModalStockBadge();
  updateModalWALink();
}

function initModal() {
  document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeModalBtn();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeModalBtn();
      closeCart();
      closeFavPanel();
      closeAuthModal();
      closeProfileModal();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH & USER SYSTEM (API-based)
// ═══════════════════════════════════════════════════════════════════════════════

function getUsers()       { return []; } // stub — no local user list; doForgot/doReset pending backend support
function getSession()     { return localStorage.getItem('mf_session') || null; }
function setSession(tok)  { tok ? localStorage.setItem('mf_session', tok) : localStorage.removeItem('mf_session'); }

function handleSessionExpired() {
  if (!getSession()) return;
  setSession(null);
  localStorage.removeItem('mf_current_user');
  updateAuthUI();
  setTimeout(function() { openAuthModal('login'); }, 200);
}

(function() {
  var _fetch = window.fetch.bind(window);
  window.fetch = function(url, opts) {
    return _fetch(url, opts).then(function(res) {
      if (res.status === 401 && typeof url === 'string' && url.indexOf(API_BASE) === 0) {
        res.clone().json().then(function(d) {
          if (d.message === 'Session expired' || d.message === 'No session token') {
            handleSessionExpired();
          }
        }).catch(function() {});
      }
      return res;
    });
  };
})();

function getCurrentUser() {
  var token = getSession();
  if (!token) return null;
  var u = localStorage.getItem('mf_current_user');
  return u ? JSON.parse(u) : null;
}
function updateUser(user) {
  localStorage.setItem('mf_current_user', JSON.stringify(user));
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
function hashPass(pwd) { return btoa(unescape(encodeURIComponent(pwd))); }

// ─── Validation ───────────────────────────────────────────────────────────────
function validateEmail(e)    { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
function validateMobile(m)   { return /^[+0-9][\d\s\-]{5,17}$/.test((m || '').trim()) && (m.replace(/[^\d]/g, '').length >= 7); }
function validatePassword(p) { return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p); }

// ─── Auth UI helpers ──────────────────────────────────────────────────────────
var _forgotId = '';

function togglePassVis(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

function openAuthModal(view) {
  showAuthView(view || 'login');
  document.getElementById('auth-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function openLegalModal(type) {
  var t = TRANSLATIONS[currentLang] || TRANSLATIONS.fa;
  var dir = t.dir || 'rtl';
  var html = '';

  if (type === 'company') {
    html = '<h2>' + t.company_title + '</h2>' +
      '<table class="legal-info-table">' +
      '<tr><td>' + t.company_name_label + '</td><td>' + t.company_name_val + '</td></tr>' +
      '<tr><td>' + t.company_addr_label + '</td><td>' + t.company_addr_val + '</td></tr>' +
      '<tr><td>' + t.company_phone_label + '</td><td dir="ltr">+90 539 218 4323</td></tr>' +
      '<tr><td>' + t.company_email_label + '</td><td dir="ltr">' + t.company_email_val + '</td></tr>' +
      '</table>';
  } else if (type === 'terms') {
    html = '<h2>' + t.terms_title + '</h2>' +
      [1,2,3,4,5].map(function(i) {
        return '<div class="legal-section"><h3>' + t['terms_' + i + '_title'] + '</h3><p>' + t['terms_' + i + '_body'] + '</p></div>';
      }).join('');
  } else if (type === 'privacy') {
    html = '<h2>' + t.privacy_title + '</h2>' +
      [1,2,3,4,5].map(function(i) {
        return '<div class="legal-section"><h3>' + t['privacy_' + i + '_title'] + '</h3><p>' + t['privacy_' + i + '_body'] + '</p></div>';
      }).join('');
  } else if (type === 'return') {
    html = '<h2>' + t.policy_title + '</h2>' +
      '<div class="legal-section"><h3>' + t.policy_rule1_title + '</h3><p>' + t.policy_rule1_desc + '</p></div>' +
      '<div class="legal-section"><h3>' + t.policy_rule2_title + '</h3><p>' + t.policy_rule2_desc + '</p></div>' +
      '<div class="legal-section"><h3>' + t.policy_rule3_title + '</h3><p>' + t.policy_rule3_desc + '</p></div>';
  }

  var box = document.getElementById('legal-modal-content');
  box.innerHTML = html;
  box.setAttribute('dir', dir);
  document.getElementById('legal-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLegalModal() {
  document.getElementById('legal-modal').style.display = 'none';
  document.body.style.overflow = '';
}
function executePendingCart() {
  if (!_pendingCart) return;
  var pending = _pendingCart;
  _pendingCart = null;
  addToCart(pending.productId, pending.colorKey, pending.size);
}
var _signupData = null;
var _signupResendTimer = null;

function ccToPreferredLang(cc) {
  var c = (cc || '').replace(/\s/g, '');
  if (c === '+98') return 'fa';
  if (c === '+90') return 'tr';
  return 'en';
}

function onSignupCcChange() {
  var cc = (document.getElementById('signup-country-code')?.value || '').trim();
  if (cc && !cc.startsWith('+')) cc = '+' + cc;
  var sel = document.getElementById('signup-lang');
  if (sel) sel.value = ccToPreferredLang(cc);
}

function showAuthView(view) {
  ['login','signup','signup-verify','forgot','reset'].forEach(function(v) {
    var el = document.getElementById('auth-view-' + v);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  clearAuthErrors();
  if (view === 'signup') {
    var ccInput = document.getElementById('signup-country-code');
    if (ccInput && !ccInput.value) {
      ccInput.value = currentLang === 'fa' ? '+98' : '+90';
    }
    var sel = document.getElementById('signup-lang');
    if (sel) sel.value = currentLang === 'fa' ? 'fa' : currentLang === 'tr' ? 'tr' : 'en';
  }
  if (view === 'signup-verify') {
    var sentTo = document.getElementById('signup-verify-sent-to');
    if (sentTo && _signupData) sentTo.textContent = _signupData.email;
    var codeInput = document.getElementById('signup-verify-code');
    if (codeInput) { codeInput.value = ''; setTimeout(function() { codeInput.focus(); }, 100); }
  }
}

function startResendCountdown() {
  clearInterval(_signupResendTimer);
  var btn       = document.getElementById('signup-resend-btn');
  var countdown = document.getElementById('signup-resend-countdown');
  var secs = 120;
  if (btn)      { btn.style.opacity = '0.35'; btn.style.pointerEvents = 'none'; }
  if (countdown) countdown.textContent = ' (' + secs + 's)';
  _signupResendTimer = setInterval(function() {
    secs--;
    if (secs <= 0) {
      clearInterval(_signupResendTimer);
      if (btn)       { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
      if (countdown)  countdown.textContent = '';
    } else {
      if (countdown) countdown.textContent = ' (' + secs + 's)';
    }
  }, 1000);
}

function resendSignupCode() {
  if (!_signupData) return;
  var btn = document.getElementById('signup-resend-btn');
  if (btn) { btn.style.opacity = '0.35'; btn.style.pointerEvents = 'none'; }
  fetch(API_BASE + '/customers/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: _signupData.email })
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) startResendCountdown();
  }).catch(function() {});
}
function clearAuthErrors() {
  document.querySelectorAll('.auth-field-error, .auth-field-success').forEach(function(el) {
    el.textContent = '';
  });
}
function setAuthError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function doLogin() {
  var t          = TRANSLATIONS[currentLang];
  var identifier = (document.getElementById('login-identifier').value || '').trim();
  var password   =  document.getElementById('login-password').value || '';
  clearAuthErrors();
  if (!identifier) { setAuthError('login-id-err',   t.err_id_req);   return; }
  if (!password)   { setAuthError('login-pass-err', t.err_pass_req); return; }
  fetch(API_BASE + '/customers/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier, password: password })
  }).then(function(res) {
    return res.json().then(function(data) { return { status: res.status, data: data }; });
  }).then(function(r) {
    if (r.status === 200 && r.data.success) {
      setSession(r.data.token);
      var customer = r.data.customer;
      customer.addresses = Array.isArray(customer.addresses)
        ? customer.addresses.map(function(a) {
            return { id: a.id, name: a.recipient, phone: a.phone, city: a.city, postal: a.postal_code || '', detail: a.detail, is_default: a.is_default };
          })
        : [];
      customer.favorites = [];
      customer.orders    = [];
      // sync avatar: server → localStorage, or localStorage → server
      if (customer.avatar) {
        localStorage.setItem('mf_avatar_' + customer.id, customer.avatar);
      } else {
        var localAvatar = localStorage.getItem('mf_avatar_' + customer.id);
        if (localAvatar) {
          customer.avatar = localAvatar;
          fetch(API_BASE + '/customers/avatar', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-session-token': r.data.token },
            body: JSON.stringify({ avatar: localAvatar }),
          }).catch(function() {});
        }
      }
      localStorage.setItem('mf_current_user', JSON.stringify(customer));
      closeAuthModal();
      updateAuthUI();
      renderGrid();
      loadCartFromServer();
      loadFavoritesFromServer();
      executePendingCart();
    } else if (r.status === 429) {
      setAuthError('login-pass-err', t.err_too_many_attempts || 'Too many attempts, try again later');
    } else {
      setAuthError('login-id-err', t.err_login_invalid);
    }
  }).catch(function() {
    setAuthError('login-pass-err', t.err_wrong_pass);
  });
}

// ─── Signup step 1: validate fields, send verification code, go to step 2 ─────
function doSignupStep1() {
  var t         = TRANSLATIONS[currentLang];
  var fullName  = (document.getElementById('signup-name')?.value         || '').trim();
  var email     = (document.getElementById('signup-email')?.value        || '').trim().toLowerCase();
  var password  =  document.getElementById('signup-password')?.value     || '';
  var confirm   =  document.getElementById('signup-confirm')?.value      || '';
  var cc        = (document.getElementById('signup-country-code')?.value || '').trim().replace(/\s/g, '');
  var mobileRaw = (document.getElementById('signup-mobile')?.value       || '').replace(/[\s\-]/g, '');
  var birthDate =  document.getElementById('signup-birth-date')?.value   || '';
  var prefLang  =  document.getElementById('signup-lang')?.value         || currentLang;
  clearAuthErrors();

  if (!email)                      { setAuthError('signup-email-err',   t.err_email_req || t.err_id_req); return; }
  if (!validateEmail(email))       { setAuthError('signup-email-err',   t.err_email_inv);                  return; }
  if (!validatePassword(password)) { setAuthError('signup-pass-err',    t.err_pass_inv);                   return; }
  if (password !== confirm)        { setAuthError('signup-confirm-err', t.err_pass_mismatch);               return; }
  if (!mobileRaw)                  { setAuthError('signup-mobile-err',  t.err_mobile_req || t.err_id_req); return; }
  if (cc && !cc.startsWith('+')) cc = '+' + cc;
  if (!cc) cc = currentLang === 'fa' ? '+98' : '+90';
  var mobile = cc + mobileRaw.replace(/^0+/, '');
  if (!/^\+[0-9]{7,15}$/.test(mobile)) { setAuthError('signup-mobile-err', t.err_mobile_intl_inv || t.err_mobile_inv); return; }

  _signupData = { fullName: fullName, email: email, password: password, mobile: mobile, birthDate: birthDate, prefLang: prefLang };

  var btn = document.querySelector('#auth-view-signup .auth-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  fetch(API_BASE + '/customers/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, lang: prefLang }),
  }).then(function(res) { return res.json().then(function(d) { return { status: res.status, data: d }; }); })
  .then(function(r) {
    if (btn) { btn.disabled = false; btn.textContent = t.auth_btn_signup || 'Continue'; }
    if (r.data.success) {
      showAuthView('signup-verify');
      startResendCountdown();
    } else if (r.status === 409) {
      setAuthError('signup-email-err', t.err_email_taken || t.err_user_exists);
    } else {
      setAuthError('signup-email-err', r.data.message || t.err_email_inv);
    }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = t.auth_btn_signup || 'Continue'; }
    setAuthError('signup-email-err', t.err_email_inv);
  });
}

// ─── Signup step 2: verify code and register ──────────────────────────────────
function doSignup() {
  if (!_signupData) { showAuthView('signup'); return; }
  var t    = TRANSLATIONS[currentLang];
  var code = (document.getElementById('signup-verify-code')?.value || '').trim();
  clearAuthErrors();
  if (!code) { setAuthError('signup-code-err', t.err_code_req); return; }

  var body = {
    email:             _signupData.email,
    verification_code: code,
    password:          _signupData.password,
    mobile:            _signupData.mobile,
    preferred_lang:    _signupData.prefLang,
  };
  if (_signupData.fullName)  body.full_name  = _signupData.fullName;
  if (_signupData.birthDate) body.birth_date = _signupData.birthDate;

  fetch(API_BASE + '/customers/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(res) {
    return res.json().then(function(data) { return { status: res.status, data: data }; });
  }).then(function(r) {
    if (r.status === 201 && r.data.success) {
      clearInterval(_signupResendTimer);
      _signupData = null;
      var customer = r.data.data;
      customer.addresses = [];
      customer.favorites = [];
      customer.orders    = [];
      setSession(r.data.token || customer.id);
      localStorage.setItem('mf_current_user', JSON.stringify(customer));
      closeAuthModal();
      updateAuthUI();
      renderGrid();
      executePendingCart();
      loadFavoritesFromServer();
    } else if (r.data.message === 'invalid_code') {
      setAuthError('signup-code-err', t.err_code_inv);
    } else if (r.status === 409) {
      setAuthError('signup-code-err', t.err_user_exists);
    } else {
      setAuthError('signup-code-err', r.data.message || t.err_code_inv);
    }
  }).catch(function() {
    setAuthError('signup-code-err', t.err_code_inv);
  });
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────
function doForgot() {
  var t          = TRANSLATIONS[currentLang];
  var identifier = (document.getElementById('forgot-identifier').value || '').trim();
  clearAuthErrors();
  if (!identifier) { setAuthError('forgot-id-err', t.err_id_req); return; }

  var btn = document.querySelector('#auth-view-forgot .auth-submit-btn');
  if (btn) btn.disabled = true;

  fetch(API_BASE + '/customers/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier, lang: currentLang })
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (btn) btn.disabled = false;
    if (!data.success) { setAuthError('forgot-id-err', t.err_not_found); return; }
    var errEl = document.getElementById('forgot-id-err');
    if (errEl) {
      errEl.className = 'auth-field-success';
      errEl.textContent = data.sent ? t.msg_link_sent : t.msg_link_manual;
    }
  }).catch(function() {
    if (btn) btn.disabled = false;
    setAuthError('forgot-id-err', t.err_not_found);
  });
}

var _resetToken = '';

function doReset() {
  var t        = TRANSLATIONS[currentLang];
  var password = document.getElementById('reset-password').value || '';
  var confirm  = document.getElementById('reset-confirm').value  || '';
  clearAuthErrors();
  if (!validatePassword(password)) { setAuthError('reset-pass-err',    t.err_pass_inv);     return; }
  if (password !== confirm)        { setAuthError('reset-confirm-err', t.err_pass_mismatch); return; }
  if (!_resetToken)                { setAuthError('reset-pass-err',    t.err_token_invalid); return; }

  var btn = document.querySelector('#auth-view-reset .auth-submit-btn');
  if (btn) btn.disabled = true;

  fetch(API_BASE + '/customers/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: _resetToken, password: password })
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (btn) btn.disabled = false;
    if (data.success) {
      var msg = document.getElementById('reset-success-msg');
      if (msg) { msg.textContent = t.msg_reset_ok; }
      _resetToken = '';
      // clear token from URL
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(function() { showAuthView('login'); }, 2000);
    } else {
      setAuthError('reset-pass-err', t.err_token_invalid);
    }
  }).catch(function() {
    if (btn) btn.disabled = false;
    setAuthError('reset-pass-err', t.err_token_invalid);
  });
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function doLogout() {
  var token = getSession();
  if (token) {
    fetch(API_BASE + '/customers/logout', {
      method: 'POST',
      headers: { 'x-session-token': token }
    }).catch(function() {});
  }
  setSession(null);
  localStorage.removeItem('mf_current_user');
  cart = [];
  localStorage.removeItem('cart');
  updateCartBadge();
  closeProfileModal();
  updateAuthUI();
  updateFavBadge();
  renderGrid();
}

// ─── Auth Header Button ───────────────────────────────────────────────────────
function handleAuthBtnClick() {
  if (getCurrentUser()) window.location = '/profile.html';
  else openAuthModal('login');
}

function openFavoritesPanel() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  var panel = document.getElementById('fav-page');
  if (panel.classList.contains('open')) { closeFavPanel(); return; }
  renderFavPanel();
  panel.classList.add('open');
}
function closeFavPanel() {
  document.getElementById('fav-page').classList.remove('open');
}
function renderFavPanel() {
  var t         = TRANSLATIONS[currentLang];
  var user      = getCurrentUser();
  var container = document.getElementById('fav-panel-body');
  var countEl   = document.getElementById('fav-page-count');
  if (!user || !user.favorites || !user.favorites.length) {
    if (countEl) countEl.textContent = '';
    container.innerHTML = emptyView(SVG_HEART,
      t.profile_no_favs || 'علاقه‌مندی ندارید',
      null, null, null);
    return;
  }
  var favProds = products.filter(function(p) { return user.favorites.indexOf(p.id) !== -1; });
  if (countEl) countEl.textContent = localizeNumber(String(favProds.length)) + ' ' + t.cart_item_unit;
  container.innerHTML =
    '<div class="fav-page-grid">' +
    favProds.map(function(p) {
      var name = p.name[currentLang];
      return (
        '<div class="fav-panel-item">' +
        '<div class="fav-panel-thumb" style="background:' + p.gradient + '" onclick="closeFavPanel();openModal(' + p.id + ')">' +
        (p.images && p.images.length ? '<img src="' + SERVER_BASE + p.images[0].url + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">' : PLACEHOLDER_SVG) +
        '</div>' +
        '<div class="fav-panel-info" onclick="closeFavPanel();openModal(' + p.id + ')">' +
        '<span class="fav-panel-name">' + name + '</span>' +
        (p.code ? '<span class="fav-panel-code">' + p.code + '</span>' : '') +
        (p.price
          ? (p.discounted_price && p.discounted_price < p.price
              ? '<div class="fav-panel-price-row"><span class="fav-panel-price-original">' + formatPrice(p.price) + '</span><span class="fav-panel-price">' + formatPrice(p.discounted_price) + '</span></div>'
              : '<div class="fav-panel-price-row"><span class="fav-panel-price">' + formatPrice(p.price) + '</span></div>')
          : '') +
        '</div>' +
        '<button class="fav-panel-remove" onclick="removeFavFromPanel(event,' + p.id + ')" title="' + t.remove_fav + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>' +
        '</button>' +
        '</div>'
      );
    }).join('') +
    '</div>';
}
function removeFavFromPanel(event, productId) {
  event.stopPropagation();
  var user = getCurrentUser(); if (!user) return;
  var idx = user.favorites.indexOf(productId);
  if (idx !== -1) user.favorites.splice(idx, 1);
  updateUser(user);
  updateFavBadge();
  renderFavPanel();
  renderGrid();
  syncFavoriteToServer(productId, false);
}

function removeFavFromProfile(event, productId) {
  event.stopPropagation();
  var user = getCurrentUser(); if (!user) return;
  var idx = user.favorites ? user.favorites.indexOf(productId) : -1;
  if (idx !== -1) user.favorites.splice(idx, 1);
  localStorage.setItem('mf_current_user', JSON.stringify(user));
  updateFavBadge();
  renderFavoritesTab();
  renderGrid();
  syncFavoriteToServer(productId, false);
}

function updateFavBadge() {
  var badge = document.getElementById('fav-header-badge');
  var btn   = document.getElementById('fav-header-btn');
  if (!badge) return;
  var user  = getCurrentUser();
  var count = user && user.favorites ? user.favorites.length : 0;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
    if (btn) btn.classList.add('has-favs');
  } else {
    badge.style.display = 'none';
    if (btn) btn.classList.remove('has-favs');
  }
}

function makeInitialsAvatar(name, size, fontSize) {
  var parts    = (name || '').trim().split(/\s+/);
  var initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0] || '?')[0].toUpperCase();
  var colors = ['#4a7fd4','#e05c7a','#2eaa72','#f0842c','#9b6bcf','#1a9da0'];
  var idx    = (name || '').split('').reduce(function(s, c) { return s + c.charCodeAt(0); }, 0) % colors.length;
  var bg     = colors[idx];
  var s      = size   || 28;
  var fs     = fontSize || 12;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="' + (s/2) + '" cy="' + (s/2) + '" r="' + (s/2) + '" fill="' + bg + '"/>' +
    '<text x="' + (s/2) + '" y="' + (s/2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + fs + '" font-weight="700" fill="#fff" font-family="inherit">' + initials + '</text>' +
    '</svg>';
}

function updateAuthUI() {
  var user = getCurrentUser();
  var btn  = document.getElementById('auth-header-btn');
  if (!btn) return;
  if (user) {
    var displayName = user.full_name || user.name || '';
    var firstName   = displayName.split(' ')[0] || displayName;
    var avatarSrc   = user.id ? (localStorage.getItem('mf_avatar_' + user.id) || '') : '';
    if (avatarSrc) {
      btn.innerHTML = '<img class="auth-header-avatar" src="' + avatarSrc + '" alt=""><span class="auth-btn-text"> ' + firstName + '</span>';
    } else {
      btn.innerHTML = makeInitialsAvatar(displayName, 28, 11) + '<span class="auth-btn-text"> ' + firstName + '</span>';
    }
  } else {
    btn.innerHTML = '👤<span class="auth-btn-text"> ' + (TRANSLATIONS[currentLang].auth_header_btn_text || (currentLang === 'en' ? 'Login' : currentLang === 'tr' ? 'Giriş' : 'ورود')) + '</span>';
  }
}

// ─── Profile Modal ────────────────────────────────────────────────────────────
function openProfileModal() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  document.getElementById('profile-modal').classList.add('open');
  if (!window.IS_PROFILE_PAGE) document.body.style.overflow = 'hidden';
  renderProfileHeader();
  showProfileTab('info');
  // Sync with DB — fetch fresh profile and update localStorage
  var token = getSession();
  if (token) {
    fetch(API_BASE + '/customers/profile', {
      headers: { 'x-session-token': token }
    }).then(function(res) { return res.json(); }).then(function(data) {
      if (data.success && data.data) {
        var u = data.data;
        // map DB address format → frontend format
        if (Array.isArray(u.addresses)) {
          u.addresses = u.addresses.map(function(a) {
            return { id: a.id, name: a.recipient, phone: a.phone, city: a.city, postal: a.postal_code || '', detail: a.detail, is_default: a.is_default };
          });
        }
        u.favorites = Array.isArray(u.favorites) ? u.favorites : (getCurrentUser().favorites || []);
        u.orders    = getCurrentUser().orders    || [];
        // sync server avatar to localStorage
        if (u.avatar) {
          localStorage.setItem('mf_avatar_' + u.id, u.avatar);
        }
        updateUser(u);
        updateFavBadge();
        renderGrid();
        renderProfileHeader();
        renderInfoTab();
        renderAddresses();
        updateAuthUI();
      }
    }).catch(function() {});
  }
}

function renderProfileHeader() {
  var user = getCurrentUser();
  if (!user) return;
  var nameEl    = document.getElementById('profile-user-name');
  var contactEl = document.getElementById('profile-user-contact');
  var avatarEl  = document.getElementById('profile-avatar-circle');
  if (nameEl)    nameEl.textContent    = user.full_name || user.name || '';
  if (contactEl) contactEl.textContent = user.email || user.mobile || '';
  if (avatarEl) {
    var src = localStorage.getItem('mf_avatar_' + user.id) || '';
    avatarEl.innerHTML = src
      ? '<img src="' + src + '" alt="">'
      : makeInitialsAvatar(user.full_name || user.name || '', 82, 32);
  }
}
function closeProfileModal() {
  if (window.IS_PROFILE_PAGE) { window.location = '/'; return; }
  document.getElementById('profile-modal').classList.remove('open');
  document.body.style.overflow = '';
}
function showProfileTab(tab) {
  ['info','addresses','orders','favorites'].forEach(function(t) {
    var c = document.getElementById('profile-tab-' + t);
    var b = document.querySelector('.profile-page-nav-item[data-tab="' + t + '"]');
    if (c) c.style.display = t === tab ? 'block' : 'none';
    if (b) b.classList.toggle('active', t === tab);
  });
  if (window.IS_PROFILE_PAGE) {
    history.replaceState({}, '', '/profile.html?tab=' + tab);
  }
  if (tab === 'info')      renderInfoTab();
  if (tab === 'addresses') renderAddresses();
  if (tab === 'orders')    renderOrders();
  if (tab === 'favorites') renderFavoritesTab();
}

// ─── Loyalty Card ─────────────────────────────────────────────────────────────
function renderLoyaltyCard(completedOrders) {
  var n = completedOrders || 0;
  var justCompleted = n > 0 && n % 6 === 0;
  var filled = justCompleted ? 6 : (n % 6);
  var cycleNum = justCompleted ? Math.floor(n / 6) : (Math.floor(n / 6) + 1);
  var prize1Unlocked = filled >= 3;
  var prize2Unlocked = filled >= 6;
  var L = currentLang;

  var cycleTxt = L === 'fa' ? ('دوره ' + toFaDigit(cycleNum)) : (L === 'tr' ? ('Devir ' + cycleNum) : ('Cycle ' + cycleNum));
  var brandTxt = 'SHILISTA CLUB';
  var titleTxt = L === 'fa' ? 'باشگاه وفاداری' : (L === 'tr' ? 'Sadakat Kulübü' : 'Loyalty Club');
  var p1Lbl = L === 'fa' ? 'کد تخفیف' : (L === 'tr' ? 'İndirim Kodu' : 'Discount Code');
  var p2Lbl = L === 'fa' ? 'جایزه ویژه' : (L === 'tr' ? 'Özel Ödül' : 'Special Prize');
  var claimTxt = L === 'fa' ? '🎉 دریافت!' : (L === 'tr' ? '🎉 Al!' : '🎉 Claim!');

  function tip1() {
    if (prize1Unlocked) return L === 'fa' ? '✨ کد تخفیف آماده‌ست!' : (L === 'tr' ? '✨ İndirim kodu hazır!' : '✨ Discount code ready!');
    var rem = 3 - filled;
    return L === 'fa' ? (toFaDigit(rem) + ' خرید مانده') : (L === 'tr' ? rem + ' alışveriş kaldı' : rem + ' purchase' + (rem > 1 ? 's' : '') + ' to go');
  }
  function tip2() {
    if (prize2Unlocked) return L === 'fa' ? '🏆 جایزه ثبت شد — سفارشات رو چک کن!' : (L === 'tr' ? '🏆 Ödül kaydedildi — siparişleri kontrol et!' : '🏆 Prize registered — check your orders!');
    var rem = 6 - filled;
    return L === 'fa' ? (toFaDigit(rem) + ' خرید مانده تا جایزه ویژه 🎁') : (L === 'tr' ? rem + ' alışveriş kaldı 🎁' : rem + ' left until your gift 🎁');
  }
  function footerTxt() {
    if (n === 0) return L === 'fa' ? 'اولین خریدت رو ثبت کن و شروع کن!' : (L === 'tr' ? 'İlk alışverişini yap ve başla!' : 'Make your first purchase and start!');
    if (prize2Unlocked) return L === 'fa' ? 'هر ۶ خرید = جوایز جدید! 🎊' : (L === 'tr' ? 'Her 6 alışveriş = yeni ödüller! 🎊' : 'Every 6 purchases = new prizes! 🎊');
    var next = prize1Unlocked ? (6 - filled) : (3 - filled);
    var nextLbl = prize1Unlocked
      ? (L === 'fa' ? 'جایزه ویژه' : L === 'tr' ? 'özel ödül' : 'special prize')
      : (L === 'fa' ? 'کد تخفیف' : L === 'tr' ? 'indirim kodu' : 'your discount code');
    return L === 'fa'
      ? 'فقط <strong>' + toFaDigit(next) + ' خرید</strong> تا ' + nextLbl
      : (L === 'tr' ? '<strong>' + next + ' alışveriş</strong> daha ' + nextLbl + ' için' : 'Just <strong>' + next + ' purchase' + (next > 1 ? 's' : '') + '</strong> until ' + nextLbl);
  }

  function star(state) {
    var fill   = state === 'filled' ? '#FFD34E' : 'none';
    var stroke = state === 'filled' ? '#FFA500' : state === 'next' ? 'rgba(255,92,0,.75)' : 'rgba(255,255,255,.18)';
    return '<svg viewBox="0 0 24 24" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round">' +
      '<polygon points="12,2.5 14.8,9 22,9.8 16.8,14.6 18.4,21.5 12,17.8 5.6,21.5 7.2,14.6 2,9.8 9.2,9"/>' +
      '</svg>';
  }

  function stamp(i) {
    var state = i < filled ? 'filled' : (i === filled && !prize2Unlocked ? 'next' : 'empty');
    return '<div class="lc-stamp lc-' + state + '">' + star(state) + '</div>';
  }

  var dots = '<div class="lc-dot-gap"><span></span><span></span><span></span></div>';

  function prizeBox(unlocked, lblTxt, tipTxt, icon, onclickFn, unlockedLbl) {
    var state     = unlocked ? 'lc-unlocked' : 'lc-locked';
    var q         = unlocked ? '' : '<span class="lc-prize-q">?</span>';
    var defaultUnlockedLbl = onclickFn ? claimTxt : (L === 'fa' ? '📦 در پیگیری' : (L === 'tr' ? '📦 Takipte' : '📦 Tracking'));
    var lbl       = unlocked ? (unlockedLbl || defaultUnlockedLbl) : lblTxt;
    var clickAttr = (unlocked && onclickFn) ? ' onclick="' + onclickFn + '" style="cursor:pointer"' : '';
    return '<div class="lc-prize ' + state + '"' + clickAttr + '>' +
      '<div class="lc-prize-box"><span class="lc-prize-icon">' + icon + '</span>' + q + '</div>' +
      '<div class="lc-prize-lbl">' + lbl + '</div>' +
      '<div class="lc-tip">' + tipTxt + '</div>' +
    '</div>';
  }

  return '<div class="lc-card">' +
    '<div class="lc-header">' +
      '<div><div class="lc-brand">' + brandTxt + '</div><div class="lc-title">' + titleTxt + '</div></div>' +
    '</div>' +
    '<div class="lc-row">' +
      stamp(0) + dots + stamp(1) + dots + stamp(2) + dots +
      prizeBox(prize1Unlocked, p1Lbl, tip1(), '🎁', 'showLoyaltyReward()') +
    '</div>' +
    '<div class="lc-divider"></div>' +
    '<div class="lc-row">' +
      stamp(3) + dots + stamp(4) + dots + stamp(5) + dots +
      prizeBox(prize2Unlocked, p2Lbl, tip2(), '🏆', prize2Unlocked ? 'showPrize2Info()' : null, L === 'fa' ? '📦 در پیگیری' : (L === 'tr' ? '📦 Takipte' : '📦 Tracking')) +
    '</div>' +
    '<div class="lc-footer">' + footerTxt() + '</div>' +
  '</div>';
}

function toFaDigit(n) {
  return String(n).replace(/\d/g, function(d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; });
}

function claimPrize() {
  var token = getSession();
  var L = currentLang;
  fetch(API_BASE + '/customers/claim-prize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
  })
  .then(function(r) { return r.json().then(function(d) { return { status: r.status, data: d }; }); })
  .then(function(r) {
    if (r.status === 409) {
      var msg = L === 'fa' ? 'جایزه این دوره قبلاً دریافت شده' : (L === 'tr' ? 'Bu dönem ödülü zaten alındı' : 'Prize already claimed for this cycle');
      showToast(msg, 'error'); return;
    }
    if (!r.data.success) {
      showToast(L === 'fa' ? 'خطا در دریافت جایزه' : 'Could not claim prize', 'error'); return;
    }
    var title = L === 'fa' ? '🏆 جایزه شما ثبت شد!' : (L === 'tr' ? '🏆 Ödülünüz kaydedildi!' : '🏆 Prize Registered!');
    var msg   = L === 'fa'
      ? 'به زودی شما هدیه‌ای از طرف ما دریافت خواهید کرد که به آدرس پیش‌فرض شما ارسال می‌شود.'
      : (L === 'tr'
        ? 'Yakında varsayılan adresinize tarafımızdan bir hediye gönderilecektir.'
        : 'You will soon receive a gift from us, which will be sent to your default address.');
    var overlay = document.createElement('div');
    overlay.className = 'lp-overlay';
    overlay.innerHTML =
      '<div class="lp-card">' +
        '<button class="lp-close" onclick="this.closest(\'.lp-overlay\').remove()">&#x2715;</button>' +
        '<div class="lp-icon">🏆</div>' +
        '<div class="lp-title">' + title + '</div>' +
        '<div class="lp-desc" style="text-align:center;line-height:1.8">' + msg + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  })
  .catch(function() { showToast(L === 'fa' ? 'خطا در اتصال به سرور' : 'Network error', 'error'); });
}

function showLoyaltyReward() {
  var token = getSession();
  var L = currentLang;
  fetch(API_BASE + '/coupons/reward', { headers: { 'x-session-token': token || '' } })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success) {
        showToast(L === 'fa' ? 'خطا در دریافت کد تخفیف' : 'Could not load reward code', 'error');
        return;
      }
      var data = d.data;
      var discTxt = data.type === 'percent'
        ? (L === 'fa' ? toFaDigit(data.value) + '٪ تخفیف' : (L === 'tr' ? '%' + data.value + ' indirim' : data.value + '% discount'))
        : (L === 'fa' ? toFaDigit(data.value.toLocaleString()) + ' تومان تخفیف' : (L === 'tr' ? data.value.toLocaleString() + ' TL indirim' : data.value.toLocaleString() + ' off'));
      var titleTxt  = L === 'fa' ? 'جایزه شما آماده‌ست!' : (L === 'tr' ? 'Ödülünüz hazır!' : 'Your Prize is Ready!');
      var descTxt   = L === 'fa' ? 'کد تخفیف اختصاصی شما:' : (L === 'tr' ? 'Özel indirim kodunuz:' : 'Your exclusive discount code:');
      var copyHint  = L === 'fa' ? 'برای کپی کلیک کنید' : (L === 'tr' ? 'Kopyalamak için tıklayın' : 'Click to copy');
      var discLbl   = L === 'fa' ? 'ارزش: ' + discTxt : (L === 'tr' ? 'Değer: ' + discTxt : 'Value: ' + discTxt);

      var overlay = document.createElement('div');
      overlay.className = 'lp-overlay';
      overlay.innerHTML =
        '<div class="lp-card">' +
          '<button class="lp-close" onclick="this.closest(\'.lp-overlay\').remove()">&#x2715;</button>' +
          '<div class="lp-icon">🎁</div>' +
          '<div class="lp-title">' + titleTxt + '</div>' +
          '<div class="lp-desc">' + descTxt + '</div>' +
          '<div class="lp-code-box" id="lp-code-click">' +
            '<div class="lp-code">' + data.code + '</div>' +
            '<div class="lp-copy-hint">' + copyHint + '</div>' +
          '</div>' +
          '<div class="lp-discount-val">' + discLbl + '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      document.getElementById('lp-code-click').addEventListener('click', function() {
        navigator.clipboard.writeText(data.code).then(function() {
          showToast(L === 'fa' ? 'کد کپی شد!' : (L === 'tr' ? 'Kod kopyalandı!' : 'Code copied!'));
        });
      });
    })
    .catch(function() { showToast(L === 'fa' ? 'خطا در اتصال به سرور' : 'Network error', 'error'); });
}

function showPrize2Info() {
  var L = currentLang;
  var title = L === 'fa' ? '🏆 جایزه ویژه شیلیستا' : (L === 'tr' ? '🏆 Shilista Özel Ödülü' : '🏆 Shilista Special Prize');
  var msg   = L === 'fa'
    ? 'شما موفق به کسب هدیه ویژه شیلیستا شدید!\n\nهدیه به زودی به آدرس پیش‌فرض شما ارسال می‌شود.\n\nوضعیت ارسال را از طریق لیست سفارشات پیگیری کنید.'
    : (L === 'tr'
      ? 'Shilista özel ödülünüzü kazandınız!\n\nHediyeniz yakında varsayılan adresinize gönderilecek.\n\nKargo durumunu sipariş listenizden takip edebilirsiniz.'
      : 'You have earned the Shilista special prize!\n\nYour gift will be sent to your default address soon.\n\nTrack the shipping status from your orders list.');
  var ordersBtnTxt = L === 'fa' ? '📦 مشاهده سفارشات' : (L === 'tr' ? '📦 Siparişleri Gör' : '📦 View Orders');
  var overlay = document.createElement('div');
  overlay.className = 'lp-overlay';
  overlay.innerHTML =
    '<div class="lp-card">' +
      '<button class="lp-close" onclick="this.closest(\'.lp-overlay\').remove()">&#x2715;</button>' +
      '<div class="lp-icon">🏆</div>' +
      '<div class="lp-title">' + title + '</div>' +
      '<div class="lp-desc" style="text-align:center;line-height:1.9;white-space:pre-line">' + msg + '</div>' +
      '<button onclick="this.closest(\'.lp-overlay\').remove();showProfileTab(\'orders\')" style="margin-top:18px;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:11px 28px;font-size:14px;font-weight:700;cursor:pointer">' + ordersBtnTxt + '</button>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ─── Info Tab ─────────────────────────────────────────────────────────────────
function renderInfoTab() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  var container = document.getElementById('profile-tab-info');
  if (!user || !container) return;

  var src         = localStorage.getItem('mf_avatar_' + user.id) || '';
  var displayName = user.full_name || user.name || '';

  var emailField, mobileField;
  // fallback: if registered_by missing, lock email when email exists, lock mobile only if mobile exists but no email
  var emailLocked  = user.registered_by ? user.registered_by === 'e' : !!user.email;
  var mobileLocked = user.registered_by ? user.registered_by === 'm' : (!user.email && !!user.mobile);

  if (emailLocked) {
    emailField =
      '<input type="text" value="' + (user.email || '').replace(/"/g,'&quot;') + '" disabled style="opacity:.75;cursor:default;">' +
      '<span class="form-hint" style="color:var(--primary);font-weight:600;">🔒 ' + t.profile_info_locked + '</span>';
  } else {
    emailField =
      '<input id="info-email-input" type="text" value="' + (user.email || '').replace(/"/g,'&quot;') + '" placeholder="' + t.profile_info_ph_email + '">' +
      '<span class="auth-field-error" id="info-email-err"></span>';
  }

  if (mobileLocked) {
    mobileField =
      '<input type="text" value="' + (user.mobile || '') + '" disabled style="opacity:.75;cursor:default;">' +
      '<span class="form-hint" style="color:var(--primary);font-weight:600;">🔒 ' + t.profile_info_locked + '</span>';
  } else {
    mobileField =
      '<input id="info-mobile-input" type="text" value="' + (user.mobile || '') + '" placeholder="' + t.profile_info_ph_mobile + '">' +
      '<span class="auth-field-error" id="info-mobile-err"></span>';
  }

  var customerId = user.id ? ('#' + String(user.id).padStart(6, '0')) : '';
  var regByLabel = user.registered_by === 'e'
    ? (currentLang === 'fa' ? 'ایمیل' : currentLang === 'tr' ? 'E-posta' : 'Email')
    : (currentLang === 'fa' ? 'موبایل' : currentLang === 'tr' ? 'Telefon' : 'Mobile');

  container.innerHTML =
    // Top — Loyalty card
    renderLoyaltyCard(user.completed_orders) +

    // Below — Profile info
    '<div style="margin-top:20px">' +

    // Customer ID badge
    (customerId
      ? '<div style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:10px 16px;margin-bottom:16px">' +
        '<span style="font-size:12px;color:#888">' + (currentLang === 'fa' ? 'شناسه مشتری' : currentLang === 'tr' ? 'Müşteri ID' : 'Customer ID') + '</span>' +
        '<span style="font-family:monospace;font-size:18px;font-weight:800;color:var(--primary);letter-spacing:1px">' + customerId + '</span>' +
        '<span style="margin-inline-start:auto;font-size:11px;color:#aaa">' + (currentLang === 'fa' ? 'نوع: ' : 'Via: ') + regByLabel + '</span>' +
        '</div>'
      : '') +

    // Avatar
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
    '<div class="info-avatar-ring">' +
    (src
      ? '<img src="' + src + '" alt="">'
      : makeInitialsAvatar(displayName, 68, 26)) +
    '</div>' +
    '<button class="info-avatar-upload-btn" onclick="triggerAvatarUpload()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
    (src ? t.profile_info_avatar_edit : t.profile_info_avatar_add) +
    '</button>' +
    '<button class="info-avatar-remove-btn' + (src ? '' : ' info-avatar-remove-btn--disabled') + '" onclick="removeAvatar()" ' + (src ? '' : 'disabled') + '>' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
    t.profile_info_avatar_remove +
    '</button>' +
    '</div>' +

    // Fields — 2-column grid
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">' +

    '<div class="form-field">' +
    '<label>' + t.profile_info_name_label + '</label>' +
    '<input id="info-name-input" type="text" value="' + displayName.replace(/"/g,'&quot;') + '">' +
    '<span class="auth-field-error" id="info-name-err"></span>' +
    '</div>' +

    '<div class="form-field">' +
    '<label>' + t.profile_info_email_label + '</label>' +
    emailField +
    '</div>' +

    '<div class="form-field">' +
    '<label>' + t.profile_info_mobile_label + '</label>' +
    mobileField +
    '</div>' +

    '<div class="form-field">' +
    '<label>' + (currentLang === 'fa' ? 'زبان ترجیحی' : currentLang === 'tr' ? 'Tercih Edilen Dil' : 'Preferred Language') + '</label>' +
    '<select id="info-lang-select">' +
    '<option value="fa"' + (user.preferred_lang === 'fa' ? ' selected' : '') + '>فارسی</option>' +
    '<option value="tr"' + (user.preferred_lang === 'tr' ? ' selected' : '') + '>Türkçe</option>' +
    '<option value="en"' + (user.preferred_lang === 'en' ? ' selected' : '') + '>English</option>' +
    '</select>' +
    '</div>' +

    '<div class="form-field">' +
    '<label>' + t.profile_info_birth_label + '</label>' +
    (user.birth_date
      ? '<div style="padding:8px 0;font-family:monospace;letter-spacing:.5px;color:#555;direction:ltr">' + user.birth_date.split('T')[0] + '</div>'
      : '<input id="info-birth-input" type="date" dir="ltr" value="" style="font-family:monospace;letter-spacing:.5px">') +
    '</div>' +

    '<div class="form-field">' +
    '<label>' + t.profile_info_gender_label + '</label>' +
    '<select id="info-gender-select">' +
    '<option value=""' + (!user.gender ? ' selected' : '') + '>' + t.profile_info_gender_none + '</option>' +
    '<option value="male"' + (user.gender === 'male' ? ' selected' : '') + '>' + t.profile_info_gender_male + '</option>' +
    '<option value="female"' + (user.gender === 'female' ? ' selected' : '') + '>' + t.profile_info_gender_female + '</option>' +
    '<option value="other"' + (user.gender === 'other' ? ' selected' : '') + '>' + t.profile_info_gender_other + '</option>' +
    '</select>' +
    '</div>' +

    '</div>' +

    '<span class="auth-field-success" id="info-save-success"></span>' +
    '<button id="info-save-btn" class="auth-submit-btn" onclick="saveInfoAll()">' + t.profile_info_save + '</button>' +
    '</div>'; // end profile info
}

function triggerAvatarUpload() {
  var inp = document.getElementById('avatar-file-input');
  if (inp) inp.click();
}

function handleAvatarChange(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var SIZE = 200;
      var canvas = document.createElement('canvas');
      canvas.width  = SIZE;
      canvas.height = SIZE;
      var ctx = canvas.getContext('2d');
      var s = Math.min(img.width, img.height);
      var sx = (img.width  - s) / 2;
      var sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      var resized = canvas.toDataURL('image/jpeg', 0.85);
      var user = getCurrentUser();
      if (!user) return;
      localStorage.setItem('mf_avatar_' + user.id, resized);
      user.avatar = resized;
      updateUser(user);
      renderProfileHeader();
      renderInfoTab();
      updateAuthUI();
      // sync to server
      var token = getSession();
      if (token) {
        fetch(API_BASE + '/customers/avatar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-session-token': token },
          body: JSON.stringify({ avatar: resized }),
        }).catch(function() {});
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function removeAvatar() {
  var user = getCurrentUser();
  if (!user) return;
  localStorage.removeItem('mf_avatar_' + user.id);
  user.avatar = null;
  updateUser(user);
  renderProfileHeader();
  renderInfoTab();
  updateAuthUI();
  var token = getSession();
  if (token) {
    fetch(API_BASE + '/customers/avatar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({ avatar: null }),
    }).catch(function() {});
  }
}

function saveInfoAll() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  if (!user) return;

  var nameInp   = document.getElementById('info-name-input');
  var emailInp  = document.getElementById('info-email-input');
  var mobileInp = document.getElementById('info-mobile-input');
  var birthInp   = document.getElementById('info-birth-input');
  var langSel    = document.getElementById('info-lang-select');
  var genderSel  = document.getElementById('info-gender-select');
  var nameErr   = document.getElementById('info-name-err');
  var emailErr  = document.getElementById('info-email-err');
  var mobileErr = document.getElementById('info-mobile-err');
  var successEl = document.getElementById('info-save-success');

  // clear errors
  [nameErr, emailErr, mobileErr].forEach(function(e) { if (e) e.textContent = ''; });
  if (successEl) successEl.textContent = '';

  var nameVal   = nameInp   ? nameInp.value.trim()   : (user.full_name || user.name || '');
  var emailVal  = emailInp  ? emailInp.value.trim()  : '';
  var mobileVal = mobileInp ? mobileInp.value.trim() : '';
  var birthVal  = birthInp  ? birthInp.value         : '';
  var langVal   = langSel   ? langSel.value          : '';
  var genderVal = genderSel ? genderSel.value        : null;

  var valid = true;
  if (!nameVal) {
    if (nameErr) nameErr.textContent = t.err_name_req;
    valid = false;
  }
  if (emailVal && !validateEmail(emailVal)) {
    if (emailErr) emailErr.textContent = t.err_email_inv;
    valid = false;
  }
  if (mobileVal && !validateMobile(mobileVal)) {
    if (mobileErr) mobileErr.textContent = t.err_mobile_inv;
    valid = false;
  }
  if (!valid) return;

  var body = { full_name: nameVal };
  if (langVal && langVal !== user.preferred_lang) body.preferred_lang = langVal;
  if (user.registered_by !== 'e' && emailVal  && emailVal  !== user.email)  body.email  = emailVal;
  if (user.registered_by !== 'm') {
    if (mobileVal && mobileVal !== user.mobile) body.mobile = mobileVal;
    else if (!mobileVal && user.mobile) body.mobile = null;
  }
  var currentBirth = user.birth_date ? user.birth_date.split('T')[0] : '';
  if (!user.birth_date && birthVal !== currentBirth) body.birth_date = birthVal || null;
  if (genderSel && genderVal !== (user.gender || '')) body.gender = genderVal || null;

  var btn = document.getElementById('info-save-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.7'; }

  fetch(API_BASE + '/customers/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getSession() },
    body: JSON.stringify(body)
  }).then(function(res) {
    return res.json().then(function(data) { return { status: res.status, data: data }; });
  }).then(function(r) {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    if (r.status === 200 && r.data.success) {
      var u = getCurrentUser();
      u.full_name      = r.data.data.full_name;
      u.email          = r.data.data.email;
      u.mobile         = r.data.data.mobile;
      u.birth_date     = r.data.data.birth_date || null;
      u.gender         = r.data.data.gender || null;
      if (r.data.data.preferred_lang) u.preferred_lang = r.data.data.preferred_lang;
      if (r.data.data.registered_by) u.registered_by  = r.data.data.registered_by;
      updateUser(u);
      renderProfileHeader();
      updateAuthUI();
      if (r.data.data.email || r.data.data.mobile) renderInfoTab();
      showToast(t.profile_info_saved);
      if (btn) {
        btn.textContent = t.profile_info_saved;
        btn.style.background = '#16a34a';
        setTimeout(function() {
          if (btn) {
            btn.textContent = t.profile_info_save;
            btn.style.background = '';
          }
        }, 2200);
      }
    } else if (r.status === 409) {
      var msg409 = (r.data && r.data.message) || '';
      if (msg409.toLowerCase().includes('mobile')) {
        if (mobileErr) mobileErr.textContent = t.err_contact_taken;
      } else if (msg409.toLowerCase().includes('email')) {
        if (emailErr) emailErr.textContent = t.err_contact_taken;
      } else {
        if (emailErr)  emailErr.textContent  = t.err_contact_taken;
        if (mobileErr) mobileErr.textContent = t.err_contact_taken;
      }
    } else if (r.status === 401) {
      if (nameErr) nameErr.textContent = t.err_not_found;
    } else {
      if (nameErr) nameErr.textContent = (r.data && r.data.message) || t.err_name_req;
    }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    if (nameErr) nameErr.textContent = 'خطا در اتصال به سرور';
  });
}

// ─── Addresses ────────────────────────────────────────────────────────────────
var _editingAddrIdx = -1;

function renderAddresses() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser(); if (!user) return;
  var container = document.getElementById('profile-tab-addresses');
  var addrs = user.addresses || [];
  addrs.sort(function(a, b) { return (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0); });
  updateUser(user);
  container.innerHTML =
    (addrs.length > 0 ? '<button class="add-address-btn" id="add-address-btn" onclick="toggleAddressForm(-1)">' + t.profile_add_addr + '</button>' : '') +
    (addrs.length === 0 ?
      '<div class="empty-banner empty-banner--addr">' +
      '<div class="empty-banner-bg"></div>' +
      '<div class="empty-banner-body">' +
      '<svg class="empty-banner-svg" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="26" r="12" stroke="currentColor" stroke-width="3.5"/><path d="M32 64C32 64 8 44 8 26a24 24 0 0148 0c0 18-24 38-24 38z" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><circle cx="32" cy="26" r="5" fill="currentColor"/></svg>' +
      '<p class="empty-banner-title">' + t.profile_no_addr + '</p>' +
      '<button class="empty-banner-btn" onclick="toggleAddressForm(-1)">' + t.profile_add_addr + '</button>' +
      '</div></div>' :
      addrs.map(function(a, i) {
        return (
          '<div class="address-card' + (a.is_default ? ' address-card--default' : '') + '" id="addr-card-' + i + '">' +
          '<div class="address-info">' +
          '<strong>' + a.name + '</strong>' +
          (a.is_default ? '<span class="addr-default-badge">' + (t.addr_default_label || 'پیش‌فرض') + '</span>' : '') +
          '<span>' + a.phone + '</span>' +
          '<span>' + a.city + ' — ' + a.detail + '</span>' +
          (a.postal ? '<span>' + t.addr_postal_label + ': ' + a.postal + '</span>' : '') +
          '</div>' +
          '<div class="address-actions">' +
          '<button class="addr-default-btn' + (a.is_default ? ' addr-default-btn--active' : '') + '" onclick="setDefaultAddress(' + i + ')" ' + (a.is_default ? 'disabled' : '') + ' title="' + (t.addr_set_default || 'پیش‌فرض') + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="' + (a.is_default ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
          '</button>' +
          '<button class="address-edit-btn" onclick="editAddress(' + i + ')" title="' + t.addr_edit_title + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="address-remove-btn" onclick="removeAddress(' + i + ')" title="' + t.addr_delete_btn + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>' +
          '</div>' +
          '</div>'
        );
      }).join('')
    ) +
    '<div id="address-form" style="display:none">' +
    '<h4 class="addr-form-title" id="addr-form-title">' + t.profile_add_addr + '</h4>' +
    '<div class="address-form-grid">' +
    '<div class="form-field"><label>' + t.addr_name_label + '</label><input id="addr-name" placeholder="' + t.addr_name_ph + '"><span class="auth-field-error" id="addr-name-err"></span></div>' +
    '<div class="form-field"><label>' + t.addr_phone_label + '</label><input id="addr-phone" placeholder="' + t.addr_phone_ph + '"><span class="auth-field-error" id="addr-phone-err"></span></div>' +
    '<div class="form-field"><label>' + t.addr_city_label + '</label><input id="addr-city" placeholder="' + t.addr_city_ph + '"><span class="auth-field-error" id="addr-city-err"></span></div>' +
    '<div class="form-field"><label>' + t.addr_postal_label + ' <span style="font-weight:400;color:var(--text-muted)">' + t.addr_postal_opt + '</span></label><input id="addr-postal" placeholder="' + t.addr_postal_ph + '"></div>' +
    '</div>' +
    '<div class="form-field"><label>' + t.addr_detail_label + '</label><textarea id="addr-detail" placeholder="' + t.addr_detail_ph + '"></textarea><span class="auth-field-error" id="addr-detail-err"></span></div>' +
    '<div class="addr-form-actions">' +
    '<button class="auth-submit-btn" id="addr-save-btn" onclick="saveAddress()">' + t.addr_save_btn + '</button>' +
    '<button class="addr-cancel-btn" onclick="toggleAddressForm(-2)">' + t.addr_cancel_btn + '</button>' +
    '</div>' +
    '</div>';
  _editingAddrIdx = -1;
}

function toggleAddressForm(idx) {
  var f    = document.getElementById('address-form');
  var btn  = document.getElementById('add-address-btn');
  var title = document.getElementById('addr-form-title');
  var saveBtn = document.getElementById('addr-save-btn');
  if (!f) return;
  // idx === -2 means cancel
  if (idx === -2 || (f.style.display !== 'none' && idx === -1)) {
    f.style.display = 'none';
    if (btn) btn.style.display = '';
    _editingAddrIdx = -1;
    return;
  }
  _editingAddrIdx = idx >= 0 ? idx : -1;
  var t = TRANSLATIONS[currentLang];
  var isEdit = _editingAddrIdx >= 0;
  if (title)   title.textContent   = isEdit ? t.addr_edit_title  : t.profile_add_addr;
  if (saveBtn) saveBtn.textContent = isEdit ? t.addr_update_btn  : t.addr_save_btn;
  // fill form if editing
  if (isEdit) {
    var user  = getCurrentUser(); if (!user) return;
    var a     = user.addresses[_editingAddrIdx];
    if (!a) return;
    document.getElementById('addr-name').value   = a.name   || '';
    document.getElementById('addr-phone').value  = a.phone  || '';
    document.getElementById('addr-city').value   = a.city   || '';
    document.getElementById('addr-postal').value = a.postal || '';
    document.getElementById('addr-detail').value = a.detail || '';
    // scroll to form
    f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    ['addr-name','addr-phone','addr-city','addr-postal','addr-detail'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
  }
  f.style.display = 'block';
  if (btn) btn.style.display = 'none';
}

function editAddress(i) {
  toggleAddressForm(i);
}

function saveAddress() {
  var name   = (document.getElementById('addr-name')   || {value:''}).value.trim();
  var phone  = (document.getElementById('addr-phone')  || {value:''}).value.trim();
  var city   = (document.getElementById('addr-city')   || {value:''}).value.trim();
  var postal = (document.getElementById('addr-postal') || {value:''}).value.trim();
  var detail = (document.getElementById('addr-detail') || {value:''}).value.trim();
  ['addr-name-err','addr-phone-err','addr-city-err','addr-detail-err'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = '';
  });
  var t2 = TRANSLATIONS[currentLang];
  var valid = true;
  if (!name)                      { setAuthError('addr-name-err',   t2.err_addr_name);               valid = false; }
  if (!phone)                     { setAuthError('addr-phone-err',  t2.err_addr_phone);              valid = false; }
  else if (!validateMobile(phone)){ setAuthError('addr-phone-err',  t2.err_mobile_inv); valid = false; }
  if (!city)                      { setAuthError('addr-city-err',   t2.err_addr_city);               valid = false; }
  if (!detail)                    { setAuthError('addr-detail-err', t2.err_addr_detail);             valid = false; }
  if (!valid) return;

  var user = getCurrentUser();
  var saveBtn = document.getElementById('addr-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '.7'; }

  var isEdit  = _editingAddrIdx >= 0;
  var addrId  = isEdit && user.addresses[_editingAddrIdx] ? user.addresses[_editingAddrIdx].id : null;
  var url     = addrId ? API_BASE + '/customers/addresses/' + addrId : API_BASE + '/customers/addresses';
  var method  = addrId ? 'PATCH' : 'POST';

  fetch(url, {
    method:  method,
    headers: { 'Content-Type': 'application/json', 'x-session-token': getSession() },
    body:    JSON.stringify({ recipient: name, phone: phone, city: city, postal_code: postal || null, detail: detail }),
  }).then(function(res) { return res.json().then(function(d) { return { status: res.status, data: d }; }); })
  .then(function(r) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; }
    if ((r.status === 200 || r.status === 201) && r.data.success) {
      var addr = r.data.data;
      var entry = { id: addr.id, name: addr.recipient, phone: addr.phone, city: addr.city, postal: addr.postal_code || '', detail: addr.detail };
      if (isEdit) { user.addresses[_editingAddrIdx] = entry; }
      else        { user.addresses = user.addresses || []; user.addresses.push(entry); }
      updateUser(user);
      showToast(t2.addr_save_btn || (currentLang === 'fa' ? 'آدرس ذخیره شد' : 'Address saved'));
      renderAddresses();
    } else {
      setAuthError('addr-detail-err', (r.data && r.data.message) || 'خطا');
    }
  }).catch(function() {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; }
    setAuthError('addr-detail-err', 'خطا در اتصال به سرور');
  });
}

function removeAddress(i) {
  var user   = getCurrentUser();
  var addr   = user.addresses[i];
  var addrId = addr && addr.id;
  if (addrId) {
    fetch(API_BASE + '/customers/addresses/' + addrId, {
      method:  'DELETE',
      headers: { 'x-session-token': getSession() },
    }).then(function() {
      user.addresses.splice(i, 1);
      updateUser(user);
      renderAddresses();
    }).catch(function() {});
  } else {
    user.addresses.splice(i, 1);
    updateUser(user);
    renderAddresses();
  }
}

function setDefaultAddress(i) {
  var user   = getCurrentUser();
  var addr   = user.addresses[i];
  var addrId = addr && addr.id;
  if (!addrId) return;
  fetch(API_BASE + '/customers/addresses/' + addrId, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getSession() },
    body:    JSON.stringify({ is_default: true }),
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      user.addresses.forEach(function(a) { a.is_default = false; });
      user.addresses[i].is_default = true;
      updateUser(user);
      renderAddresses();
    }
  }).catch(function() {});
}

// ─── Orders ───────────────────────────────────────────────────────────────────
function saveOrderToHistory() {
  var user = getCurrentUser(); if (!user) return;
  var order = {
    id:    genId(),
    date:  new Date().toISOString(),
    items: cart.map(function(item) {
      var p = products.find(function(pr) { return pr.id === item.id; });
      if (!p) return null;
      return { productId: p.id, colorKey: item.colorKey, size: item.size, qty: item.qty };
    }).filter(Boolean)
  };
  user.orders.unshift(order);
  if (user.orders.length > 50) user.orders = user.orders.slice(0, 50);
  updateUser(user);
}
function renderOrders() {
  var t   = TRANSLATIONS[currentLang];
  var user = getCurrentUser(); if (!user) return;
  var container = document.getElementById('profile-tab-orders');
  if (!container) return;

  // Show loading state then fetch API preorders
  var token = getSession();
  if (token) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:#888">' + (t.preorder_status || 'در حال بارگذاری...') + '</div>';
    fetch(API_BASE + '/orders/my', {
      headers: { 'x-session-token': token },
    }).then(function(res) { return res.json(); }).then(function(data) {
      if (!data.success && (data.message === 'Session expired' || data.message === 'No session token')) {
        doLogout(); openAuthModal('login'); return;
      }
      _renderOrdersList(data.success ? data.data : []);
    }).catch(function() { _renderOrdersList([]); });
  } else {
    _renderOrdersList([]);
  }
}

var _cachedApiOrders      = [];
var _profileExpandedId    = null;
var _ordersActiveOnly     = false;
var _pendingScrollOrderId = null;
var ACTIVE_ORDER_STATUSES = ['preorder','payment_needed','approval_needed','preparing','delivery'];

function openActiveOrder() {
  if (!currentPreorder) return;
  var id = currentPreorder.id;
  _profileExpandedId    = id;
  _pendingScrollOrderId = id;
  if (!window.IS_PROFILE_PAGE) {
    openProfileModal();
  }
  showProfileTab('orders');
}

function toggleOrdersActiveFilter() {
  _ordersActiveOnly = !_ordersActiveOnly;
  _renderOrdersList(_cachedApiOrders);
}

function _renderOrdersList(apiOrders) {
  _cachedApiOrders = apiOrders;
  var t   = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  var container = document.getElementById('profile-tab-orders');
  if (!container) return;
  var localOrders = user ? (user.orders || []) : [];
  var dateLocale = currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-US';
  var nameKey = currentLang === 'fa' ? 'name_fa' : currentLang === 'tr' ? 'name_tr' : 'name_en';

  var filteredApiOrders = _ordersActiveOnly
    ? apiOrders.filter(function(o) { return ACTIVE_ORDER_STATUSES.includes(o.status); })
    : apiOrders;

  var ORDER_COLORS = {
    confirmed:'#FF5C00', shipped:'#8b5cf6',
    preorder:'#3b82f6', payment_needed:'#f59e0b', approval_needed:'#eab308',
    preparing:'#22c55e', delivery:'#8b5cf6', delivered:'#16a34a', cancelled:'#9ca3af', rejected:'#dc2626',
  };
  var ORDER_LABELS = {
    confirmed:        t.prize_confirmed     || 'Confirmed',
    shipped:          t.prize_shipped       || 'Shipped',
    preorder:        t.preorder_registered || 'پیش‌سفارش',
    payment_needed:  t.payment_info_title  || 'در انتظار پرداخت',
    approval_needed: t.receipt_uploaded    || 'در انتظار تأیید',
    preparing:       t.preparing_msg       || 'در حال آماده‌سازی',
    delivery:        t.status_delivery      || 'ارسال شده',
    delivered:       t.order_delivered     || 'تحویل شده',
    cancelled:       t.status_cancelled    || 'لغو شده',
    rejected:        t.status_rejected     || 'رد شده',
  };

  var apiHtml = filteredApiOrders.map(function(order) {
    var st    = order.status;
    var badgeColor = ORDER_COLORS[st] || '#6b7280';
    var badgeLabel = ORDER_LABELS[st] || st;

    // Override badge if active return exists
    var activeRet = order.order_returns && order.order_returns[0];
    if (activeRet && !['expired', 'completed'].includes(activeRet.status)) {
      var retBadgeMap = {
        requested:          { label: t.ret_status_requested  || 'در انتظار ارسال مرجوعی', color: '#f59e0b' },
        shipped:            { label: t.ret_status_shipped     || 'مرجوعی ارسال شد',        color: '#3b82f6' },
        received:           { label: t.ret_status_received    || 'مرجوعی دریافت شد',       color: '#8b5cf6' },
        refund_sent:        { label: t.ret_status_refund_sent || 'استرداد وجه',              color: '#10b981' },
        refund_rejected:    { label: t.ret_status_rejected    || 'بازگشت رد شد',            color: '#ef4444' },
      };
      var rb = retBadgeMap[activeRet.status];
      if (rb) { badgeColor = rb.color; badgeLabel = '↩ ' + rb.label; }
    }
    var dateStr = new Date(order.created_at).toLocaleDateString(dateLocale);
    var isExpanded = (_profileExpandedId === order.id);

    var itemsHtml = (order.order_items || []).map(function(oi) {
      var pname = oi.products ? (oi.products[nameKey] || oi.products.name_fa || '') : '';
      var pcode = oi.products && oi.products.code ? oi.products.code : '';
      var colorDot = oi.colors && oi.colors.hex
        ? '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + oi.colors.hex + ';border:1px solid #ddd;margin-inline-end:4px;vertical-align:middle"></span>'
        : '';
      var colorName = oi.colors
        ? (currentLang === 'fa' ? oi.colors.name_fa : currentLang === 'tr' ? oi.colors.name_tr : oi.colors.name_en) || ''
        : '';
      var linePrice = oi.unit_price ? formatPrice(Number(oi.unit_price) * oi.qty) : '';
      return '<div class="order-item-row">' +
        '<span>' + colorDot + pname +
          (pcode ? '<span onclick="copyProductCode(\'' + pcode + '\')" title="Copy" style="font-size:11px;color:#9ca3af;font-family:monospace;margin-right:4px;cursor:pointer"> [' + pcode + ']</span>' : '') +
          (colorName ? '<span style="font-size:11px;color:#9ca3af;margin-right:4px"> · ' + colorName + '</span>' : '') +
        '</span>' +
        (oi.size_label ? '<span>' + oi.size_label + '</span>' : '') +
        '<span>× ' + oi.qty + '</span>' +
        (linePrice ? '<span style="font-weight:600;font-size:12px;color:#374151">' + linePrice + '</span>' : '') +
        '</div>';
    }).join('');

    // ─── Detail area (shown when expanded) ──────────────────────────────────
    var detailHtml = '';
    if (isExpanded) {
      detailHtml += '<div class="order-detail-area">';

      // ─── Address ─────────────────────────────────────────────────────────────
      var addr = order.addresses;
      if (addr) {
        detailHtml += '<div class="order-addr-block">' +
          '<div class="order-addr-block-label">' + (t.order_addr_label || 'آدرس تحویل') + '</div>' +
          '<div class="order-addr-block-body">' +
            '<span>' + (addr.recipient || '') + ' · ' + (addr.phone || '') + '</span>' +
            '<span>' + (addr.city || '') + (addr.province ? ' — ' + addr.province : '') + '</span>' +
            '<span>' + (addr.detail || '') + (addr.postal_code ? ' (' + addr.postal_code + ')' : '') + '</span>' +
          '</div>' +
        '</div>';
      }

      // ─── Note ────────────────────────────────────────────────────────────────
      if (order.note) {
        detailHtml += '<div class="order-note-block">' +
          '<span class="order-note-block-label">' + (t.order_note_label || 'یادداشت') + ': </span>' +
          order.note +
        '</div>';
      }

      // ─── Total ───────────────────────────────────────────────────────────────
      if (order.total_amount) {
        detailHtml += '<div class="order-detail-total">' +
          '<span>' + (t.checkout_total || 'جمع کل') + '</span>' +
          '<strong>' + formatPrice(order.total_amount) + '</strong>' +
        '</div>';
      }

      if (st === 'preorder') {
        detailHtml += '<p class="order-detail-hint">' + (t.preorder_wait_payment || 'منتظر اطلاعات پرداخت باشید') + '</p>';
        detailHtml += '<button class="order-action-btn order-action-cancel" onclick="profileCancelOrder(' + order.id + ')">' + (t.cancel_preorder || 'لغو پیش‌سفارش') + '</button>';
      }

      if (st === 'payment_needed') {
        if (order.payment_rejection_reason) {
          detailHtml += '<div class="order-rejection-box"><strong>' + (t.payment_rejected || 'رد شد') + ':</strong> ' + order.payment_rejection_reason + '</div>';
        }
        if (order.iban) {
          detailHtml += '<div class="order-payment-info-box">' +
            '<div class="order-payment-info-title">' + (t.payment_info_title || 'اطلاعات پرداخت') + '</div>' +
            '<div class="order-payment-row"><span>' + (t.payment_iban || 'شبا') + ':</span><strong style="direction:ltr">' + order.iban + '</strong>' + copyBtn(order.iban) + '</div>' +
            (order.bank_name ? '<div class="order-payment-row"><span>' + (t.payment_bank || 'بانک') + ':</span>' + order.bank_name + '</div>' : '') +
            (order.account_holder ? '<div class="order-payment-row"><span>' + (t.payment_holder || 'صاحب حساب') + ':</span>' + order.account_holder + copyBtn(order.account_holder) + '</div>' : '') +
            '<div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e;line-height:1.5">' +
              (t.payment_ref_note || '⚠️ شماره سفارش را در توضیحات درج کنید:') +
              '<strong style="display:block;font-size:14px;margin-top:4px;letter-spacing:1px">ORD-' + order.id + '</strong>' +
            '</div>' +
            '</div>';
        }
        detailHtml += '<div class="order-upload-area">' +
          '<p style="font-size:13px;font-weight:600;margin-bottom:8px">' + (t.upload_receipt || 'آپلود رسید پرداخت') + '</p>' +
          '<input type="file" id="prof-receipt-' + order.id + '" accept="image/*,.pdf,application/pdf" style="display:none" onchange="profileUploadReceipt(this,' + order.id + ')">' +
          '<button class="order-action-btn order-action-upload" onclick="document.getElementById(\'prof-receipt-' + order.id + '\').click()">' + (t.upload_receipt_btn || 'انتخاب و ارسال رسید') + '</button>' +
          '</div>';
        detailHtml += '<button class="order-action-btn order-action-cancel" onclick="profileCancelOrder(' + order.id + ')">' + (t.cancel_preorder || 'لغو') + '</button>';
      }

      if (st === 'approval_needed') {
        detailHtml += '<p class="order-detail-hint">' + (t.receipt_uploaded || 'رسید ارسال شد، در انتظار تأیید') + '</p>';
        if (order.payment_receipt_url) {
          detailHtml += '<a href="' + SERVER_BASE + order.payment_receipt_url + '" target="_blank" class="order-receipt-link">' + (t.upload_receipt || 'مشاهده رسید ارسالی') + ' ↗</a>';
        }
      }

      if (st === 'preparing') {
        var maxDays = 0;
        (order.order_items || []).forEach(function(oi) {
          var d = oi.products && oi.products.delivery_days ? Number(oi.products.delivery_days) : 5;
          if (d > maxDays) maxDays = d;
        });
        detailHtml += '<p class="order-detail-hint" style="color:#22c55e">' + (t.payment_approved || 'پرداخت تأیید شد') + '!</p>';
        detailHtml += '<p class="order-detail-hint">' + (t.preparing_msg || 'در حال آماده‌سازی') + '</p>';
        if (maxDays) {
          detailHtml += '<p class="order-detail-hint">' + (t.delivery_days_msg || 'زمان تحویل') + ': <strong>' + localizeNumber(String(maxDays)) + ' ' + (t.delivery_unit || 'روز کاری') + '</strong></p>';
        }
      }

      if (st === 'delivery' || st === 'shipped') {
        var shippedStr = order.shipped_at ? new Date(order.shipped_at).toLocaleString(dateLocale) : '-';
        detailHtml += '<div class="order-tracking-box">' +
          (order.carrier_name ? '<div class="order-payment-row"><span>' + (t.carrier_label || 'باربری') + ':</span>' + order.carrier_name + '</div>' : '') +
          (order.tracking_number ? '<div class="order-payment-row"><span>' + (t.tracking_label || 'کد پیگیری') + ':</span><strong style="direction:ltr">' + order.tracking_number + '</strong></div>' : '') +
          (order.tracking_note ? '<div class="order-payment-row"><span>' + (t.tracking_note_label || 'یادداشت کارگو') + ':</span><span style="direction:ltr;word-break:break-all">' + escapeHtml(order.tracking_note) + '</span></div>' : '') +
          '<div class="order-payment-row"><span>' + (t.shipped_at_label || 'تاریخ ارسال') + ':</span><span style="direction:ltr">' + shippedStr + '</span></div>' +
          '</div>';
      }

      if (st === 'delivered') {
        var shippedStr2   = order.shipped_at   ? new Date(order.shipped_at).toLocaleString(dateLocale)   : '-';
        var deliveredStr2 = order.delivered_at ? new Date(order.delivered_at).toLocaleString(dateLocale) : '-';
        detailHtml += '<div class="order-tracking-box">' +
          '<p style="color:#16a34a;font-weight:700;margin:0 0 8px">' + (t.order_delivered || 'تحویل داده شد ✓') + '</p>' +
          (order.carrier_name ? '<div class="order-payment-row"><span>' + (t.carrier_label || 'باربری') + ':</span>' + order.carrier_name + '</div>' : '') +
          (order.tracking_number ? '<div class="order-payment-row"><span>' + (t.tracking_label || 'کد پیگیری') + ':</span><strong style="direction:ltr">' + order.tracking_number + '</strong></div>' : '') +
          (order.tracking_note ? '<div class="order-payment-row"><span>' + (t.tracking_note_label || 'یادداشت کارگو') + ':</span><span style="direction:ltr;word-break:break-all">' + escapeHtml(order.tracking_note) + '</span></div>' : '') +
          '<div class="order-payment-row"><span>' + (t.shipped_at_label || 'تاریخ ارسال') + ':</span><span style="direction:ltr">' + shippedStr2 + '</span></div>' +
          '<div class="order-payment-row"><span>' + (t.delivered_at_label || 'تاریخ تحویل') + ':</span><span style="direction:ltr">' + deliveredStr2 + '</span></div>' +
          '</div>';
        if (!order.is_prize) {
          detailHtml += '<div id="order-return-section-' + order.id + '"><div style="color:#aaa;font-size:12px;text-align:center;padding:6px"></div></div>';
          detailHtml += buildProductPhotoUploadSection(order);
        }
      }

      if (st === 'cancelled') {
        detailHtml += '<p class="order-detail-hint" style="color:#9ca3af">❌ ' + (t.status_cancelled || 'لغو شده') + '</p>';
      }

      if (st === 'rejected') {
        var rejDateStr = order.rejected_at ? new Date(order.rejected_at).toLocaleString(dateLocale) : '';
        detailHtml += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px;margin-top:10px">' +
          '<div style="color:#b91c1c;font-weight:700;margin-bottom:6px">🚫 ' + (t.preorder_rejected_title || 'پیش‌سفارش رد شد') + '</div>' +
          (order.payment_rejection_reason
            ? '<div style="color:#7f1d1d;margin-bottom:6px;white-space:pre-wrap">' +
              '<span style="font-weight:600">' + (t.reject_reason_label || 'دلیل') + ': </span>' +
              order.payment_rejection_reason + '</div>'
            : '') +
          (rejDateStr
            ? '<div style="color:#9ca3af;font-size:12px;direction:ltr;text-align:start">' + rejDateStr + '</div>'
            : '') +
          '</div>';
      }

      // ─── Documents & Timeline ──────────────────────────────────────────────
      var _cTlEvents = [];
      _cTlEvents.push({ label: t.tl_order_created || 'Sabte sefaresh', dt: order.created_at, color: '#6b7280' });
      if (order.rejected_at)  _cTlEvents.push({ label: t.tl_payment_rejected || 'Rad shod', dt: order.rejected_at,  color: '#ef4444' });
      if (order.shipped_at)   _cTlEvents.push({ label: t.tl_order_shipped    || 'Ersal shod', dt: order.shipped_at,   color: '#3b82f6' });
      if (order.delivered_at) _cTlEvents.push({ label: t.tl_order_delivered  || 'Taslim shod', dt: order.delivered_at, color: '#16a34a' });
      var _cHasReceipt   = !!order.payment_receipt_url && st !== 'approval_needed';
      var _cShowTimeline = _cTlEvents.length > 1;
      if (_cHasReceipt || _cShowTimeline) {
        detailHtml += '<div style="margin-top:14px;border-top:1.5px dashed #e5d8d0;padding-top:12px">';
        if (_cHasReceipt) {
          detailHtml += '<div style="font-size:12px;font-weight:700;color:#888;margin-bottom:8px">📎 ' + (t.docs_section_title || 'Madarak') + '</div>' +
            '<a href="' + SERVER_BASE + order.payment_receipt_url + '" target="_blank" ' +
              'style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:#f0f9ff;border:1px solid #bae6fd;color:#0284c7;font-size:12px;font-weight:600;text-decoration:none;margin-bottom:12px">' +
              '💳 ' + (t.docs_payment_receipt || 'Resid Pardakht') + ' ↗' +
            '</a>';
        }
        if (_cShowTimeline) {
          detailHtml += '<div style="font-size:12px;font-weight:700;color:#888;margin-bottom:6px;margin-top:' + (_cHasReceipt ? '4px' : '0') + '">' +
            '🕐 ' + (t.tl_section_title || 'Timeline') + '</div>' +
            '<div style="display:flex;flex-direction:column;gap:4px">';
          _cTlEvents.forEach(function(ev) {
            detailHtml += '<div style="display:flex;gap:8px;font-size:12px;align-items:baseline">' +
              '<span style="color:' + ev.color + ';font-weight:600;min-width:90px">' + ev.label + '</span>' +
              '<span style="direction:ltr;color:#555">' + new Date(ev.dt).toLocaleString(dateLocale) + '</span>' +
            '</div>';
          });
          detailHtml += '</div>';
        }
        detailHtml += '</div>';
      }

      // Messages section — not shown for prize orders
      if (!order.is_prize) {
        detailHtml += '<div class="order-messages-section" id="order-msgs-' + order.id + '">' +
          '<div class="order-msgs-title">' + (t.msg_section_title || 'پیام‌ها') + '</div>' +
          '<div class="order-msgs-list" id="order-msgs-list-' + order.id + '"><div style="color:#aaa;font-size:12px;text-align:center;padding:10px">' + (t.msg_empty || 'پیامی وجود ندارد') + '</div></div>' +
          '<div class="order-msgs-compose">' +
            '<textarea id="order-msg-input-' + order.id + '" class="order-msg-input" placeholder="' + (t.msg_placeholder || 'پیام خود را بنویسید...') + '" rows="2"></textarea>' +
            '<button class="order-msg-send-btn" onclick="customerSendOrderMessage(' + order.id + ')">' + (t.msg_send || 'ارسال') + '</button>' +
          '</div>' +
        '</div>';
      }

      detailHtml += '</div>';
    }

    var orderTotal = order.total_amount ? formatPrice(order.total_amount) : '';
    return '<div class="order-card" id="porder-' + order.id + '">' +
      '<div class="order-header order-header--clickable" onclick="toggleProfileOrder(' + order.id + ')">' +
      '<span class="order-id">ORD-' + order.id + '</span>' +
      '<span style="background:' + badgeColor + '20;color:' + badgeColor + ';border:1px solid ' + badgeColor + '40;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">' + badgeLabel + '</span>' +
      (orderTotal ? '<span class="order-total-badge">' + orderTotal + '</span>' : '') +
      '<span class="order-date">' + dateStr + '</span>' +
      '<span class="order-toggle-arrow">' + (isExpanded ? '▲' : '▼') + '</span>' +
      '</div>' +
      itemsHtml +
      detailHtml +
      '</div>';
  }).join('');

  var localHtml = localOrders.map(function(order) {
    var dateStr = order.date;
    try {
      var d = new Date(order.date);
      if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString(dateLocale);
    } catch(e) {}
    return '<div class="order-card">' +
      '<div class="order-header">' +
      '<span class="order-id">ORD-' + order.id + '</span>' +
      '<span style="background:#e5e7eb;color:#6b7280;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">WA/TG</span>' +
      '<span class="order-date">' + dateStr + '</span>' +
      '</div>' +
      order.items.map(function(item) {
        var prod      = item.productId ? products.find(function(pr) { return pr.id === item.productId; }) : null;
        var name      = prod ? prod.name[currentLang] : (item.name || '');
        var colorName = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].name[currentLang] : '';
        return '<div class="order-item-row">' +
          '<span>• ' + name + '</span>' +
          (colorName ? '<span>' + colorName + '</span>' : '') +
          (item.size  ? '<span>' + (t.order_size_lbl || '') + item.size + '</span>' : '') +
          '<span>× ' + item.qty + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  }).join('');

  var filterBar = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 14px;background:var(--card,#fff);border-radius:12px;border:1px solid #e5e7eb">' +
    '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:#374151;user-select:none">' +
    '<input type="checkbox" id="orders-active-filter" ' + (_ordersActiveOnly ? 'checked' : '') + ' onchange="toggleOrdersActiveFilter()" style="width:16px;height:16px;cursor:pointer;accent-color:#3b82f6">' +
    (t.orders_active_only || 'فقط سفارش‌های فعال') +
    '</label>' +
    '</div>';

  var combined = apiHtml + localHtml;
  if (!combined && _ordersActiveOnly) {
    container.innerHTML = filterBar +
      '<p style="text-align:center;padding:24px;color:#9ca3af;font-size:14px">' + (t.orders_no_active || 'سفارش فعالی وجود ندارد') + '</p>';
    return;
  }
  if (!combined) {
    container.innerHTML =
      '<div class="empty-banner empty-banner--orders">' +
      '<div class="empty-banner-bg"></div>' +
      '<div class="empty-banner-body">' +
      '<svg class="empty-banner-svg" viewBox="0 0 64 64" fill="none"><path d="M8 8h6l8 32h28l6-22H20" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="28" cy="54" r="4" fill="currentColor"/><circle cx="46" cy="54" r="4" fill="currentColor"/></svg>' +
      '<p class="empty-banner-title">' + t.profile_no_orders + '</p>' +
      '<button class="empty-banner-btn" onclick="closeProfileModal()">' + (t.nav_all || (currentLang==="fa"?"مشاهده محصولات":"Browse Products")) + '</button>' +
      '</div></div>';
    return;
  }
  container.innerHTML = filterBar + combined;

  if (_pendingScrollOrderId) {
    var sid = _pendingScrollOrderId;
    _pendingScrollOrderId = null;
    setTimeout(function() {
      var el = document.getElementById('porder-' + sid);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('order-card--highlighted');
        setTimeout(function() { el.classList.remove('order-card--highlighted'); }, 2000);
      }
    }, 80);
  }
}

function toggleProfileOrder(orderId) {
  _profileExpandedId = (_profileExpandedId === orderId) ? null : orderId;
  _renderOrdersList(_cachedApiOrders);
  if (_profileExpandedId === orderId) {
    var ord = (_cachedApiOrders || []).find(function(o) { return o.id === orderId; });
    if (ord && !ord.is_prize) loadOrderMessages(orderId);
    if (ord && !ord.is_prize && ord.status === 'delivered') loadOrderReturn(orderId, ord);
  }
}

function profileCancelOrder(orderId) {
  var t = TRANSLATIONS[currentLang];
  showConfirm(t.cancel_confirm || 'آیا مطمئنید؟', function() {
    _doProfileCancelOrder(orderId);
  });
}
function _doProfileCancelOrder(orderId) {
  var t = TRANSLATIONS[currentLang];
  var token = getSession();
  fetch(API_BASE + '/orders/' + orderId, {
    method: 'DELETE',
    headers: { 'x-session-token': token },
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      if (currentPreorder && currentPreorder.id === orderId) {
        currentPreorder = null;
        localStorage.removeItem('mf_preorder_id');
        renderCart();
        updateOrderStatusBtn();
      }
      showToast(t.preorder_cancelled || 'پیش‌سفارش لغو شد');
      reloadProducts(true);
      _profileExpandedId = null;
      renderOrders();
    } else {
      showToast(data.message || 'خطا', 'error');
      if (data.message === 'Session expired') { handleSessionExpired(); }
    }
  }).catch(function() { showToast('خطا در اتصال', 'error'); });
}

function profileUploadReceipt(input, orderId) {
  var file = input.files && input.files[0];
  if (!file) return;
  var t = TRANSLATIONS[currentLang];
  var okExt  = /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|pdf)$/i.test(file.name);
  var okMime = /^image\//.test(file.type) || file.type === 'application/pdf' || file.type === '';
  if (!okExt && !okMime) {
    showToast(t.receipt_invalid_type || 'نوع فایل پشتیبانی نمی‌شود', 'error');
    input.value = '';
    return;
  }
  var token = getSession();
  var btn = document.querySelector('#prof-receipt-' + orderId + ' ~ button') ||
            input.parentElement.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  var formData = new FormData();
  formData.append('receipt', file);
  fetch(API_BASE + '/orders/' + orderId + '/receipt', {
    method: 'POST',
    headers: { 'x-session-token': token },
    body: formData,
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      if (currentPreorder && currentPreorder.id === orderId) {
        currentPreorder = data.data;
        renderCart();
        updateOrderStatusBtn();
      }
      showToast(t.receipt_uploaded || 'رسید ارسال شد');
      renderOrders();
    } else {
      var errMsg = data.errorCode === 'invalid_file_type' ? (t.receipt_invalid_type || 'نوع فایل پشتیبانی نمی‌شود')
                 : data.errorCode === 'file_too_large'    ? (t.receipt_too_large || 'حجم فایل بیش از حد مجاز است')
                 : (t.upload_error || 'خطا در ارسال رسید');
      showToast(errMsg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = t.upload_receipt_btn || 'ارسال رسید'; }
    }
  }).catch(function() {
    showToast(t.network_error || 'خطا در اتصال', 'error');
    if (btn) { btn.disabled = false; }
  });
  input.value = '';
}

// ─── Order Messages ───────────────────────────────────────────────────────────
function loadOrderMessages(orderId) {
  var token = getSession(); if (!token) return;
  fetch(API_BASE + '/orders/' + orderId + '/messages', { headers: { 'x-session-token': token } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) renderOrderMessages(orderId, data.data);
    }).catch(function() {});
}

function renderOrderMessages(orderId, messages) {
  var listEl = document.getElementById('order-msgs-list-' + orderId);
  if (!listEl) return;
  var t = TRANSLATIONS[currentLang];
  if (!messages || !messages.length) {
    listEl.innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;padding:10px">' + (t.msg_empty || 'پیامی وجود ندارد') + '</div>';
    return;
  }
  var statusLabels = {
    preorder: t.preorder_status || 'Preorder', payment_needed: t.preorder_wait_payment || 'Payment Needed',
    approval_needed: t.receipt_uploaded || 'Approval Needed', preparing: t.preparing_msg || 'Preparing',
    delivery: t.status_delivery || 'Shipped', delivered: t.order_delivered || 'Delivered',
    cancelled: t.status_cancelled || 'Cancelled', rejected: t.status_rejected || 'Rejected',
  };
  listEl.innerHTML = messages.map(function(msg) {
    var isAdmin = msg.sender === 'admin';
    var senderLabel = isAdmin ? (t.msg_support || 'Support') : (t.msg_you || 'You');
    var statusLabel = statusLabels[msg.order_status] || msg.order_status;
    var dateStr = new Date(msg.created_at).toLocaleString(currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
    return '<div class="order-msg-row ' + (isAdmin ? 'order-msg-admin' : 'order-msg-customer') + '">' +
      '<div class="order-msg-bubble">' +
        '<div class="order-msg-meta"><span class="order-msg-sender">' + senderLabel + '</span><span class="order-msg-time">' + dateStr + '</span></div>' +
        '<div class="order-msg-text">' + msg.message.replace(/\n/g, '<br>') + '</div>' +
        '<div class="order-msg-status">' + (t.msg_sent_at_status || 'At stage:') + ' ' + statusLabel + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function customerSendOrderMessage(orderId) {
  var token = getSession(); if (!token) { openAuthModal('login'); return; }
  var input = document.getElementById('order-msg-input-' + orderId);
  var text = (input ? input.value : '').trim();
  if (!text) return;
  fetch(API_BASE + '/orders/' + orderId + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ message: text }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      if (input) input.value = '';
      loadOrderMessages(orderId);
    } else {
      showToast(data.message || 'خطا', 'error');
    }
  }).catch(function() { showToast('خطا در اتصال', 'error'); });
}

// ─── Order Returns ────────────────────────────────────────────────────────────
var _returnPolicyAgreed = {};

function addWorkingDaysJS(date, days) {
  var d = new Date(date); var added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function loadOrderReturn(orderId, order) {
  var token = getSession(); if (!token) return;
  var sect = document.getElementById('order-return-section-' + orderId);
  if (!sect) return;
  fetch(API_BASE + '/orders/' + orderId + '/returns', { headers: { 'x-session-token': token } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      renderOrderReturn(orderId, order, data.success ? data.data : null);
    }).catch(function() {});
}

function renderOrderReturn(orderId, order, ret) {
  var sect = document.getElementById('order-return-section-' + orderId);
  if (!sect) return;
  var t = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  var dateLocale = currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-GB';

  // Check if return window still open (5 working days after delivery)
  var deliveredAt = order.delivered_at ? new Date(order.delivered_at) : null;
  var windowDeadline = deliveredAt ? addWorkingDaysJS(deliveredAt, 5) : null;
  var windowOpen = windowDeadline && new Date() <= windowDeadline;

  var html = '<div class="order-return-section">';
  html += '<div class="order-return-title">↩ ' + (t.return_policy_title || 'مرجوعی') + '</div>';

  if (!ret || ret.status === 'expired') {
    // Show buttons if window is open
    if (windowOpen && (!ret || ret.status === 'expired')) {
      if (!_returnPolicyAgreed[orderId]) {
        html += '<div class="return-policy-box">' +
          '<div class="return-policy-text">' + (t.return_policy_text || '') + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
            '<button class="return-action-btn return-btn-primary" onclick="_returnPolicyAgreed[' + orderId + ']=true;renderOrderReturn(' + orderId + ',_cachedApiOrders.find(function(o){return o.id===' + orderId + ';}),' + (ret ? JSON.stringify(ret) : 'null') + ')">' + (t.return_confirm_policy || 'موافقم') + '</button>' +
          '</div>' +
        '</div>';
      } else {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
          '<button class="return-action-btn return-btn-primary" onclick="confirmRequestReturn(' + orderId + ')">' + (t.return_request_btn || 'درخواست مرجوعی') + '</button>' +
        '</div>';
      }
    } else if (!windowOpen) {
      if (ret && ret.status === 'expired') {
        html += '<div style="color:#9ca3af;font-size:12px;margin-top:6px">⏱ ' + (t.ret_status_expired || 'منقضی') + ' — ' + (t.ret_window_closed || '') + '</div>';
      } else {
        html += '<div style="color:#9ca3af;font-size:12px;margin-top:6px">⏱ ' + (t.ret_window_closed || 'مهلت مرجوعی پایان یافته') + '</div>';
      }
    }
  } else {
    // Active return — show status timeline + actions
    var statusColors = { requested:'#f59e0b', shipped:'#3b82f6', received:'#8b5cf6', refund_sent:'#10b981', completed:'#16a34a', expired:'#9ca3af', refund_rejected:'#ef4444', defective_reported:'#f59e0b' };
    var statusLabels = {
      requested: t.ret_status_requested, shipped: t.ret_status_shipped, received: t.ret_status_received,
      refund_sent: t.ret_status_refund_sent, completed: t.ret_status_completed, expired: t.ret_status_expired,
      refund_rejected: t.ret_status_rejected, defective_reported: t.ret_status_defective,
    };
    var sc = statusColors[ret.status] || '#aaa';
    html += '<div class="return-policy-box">';
    // Return code
    if (ret.return_code) {
      html += '<div style="background:#fff8f5;border:2px dashed var(--primary);border-radius:10px;padding:12px 16px;margin-bottom:12px;text-align:center">' +
        '<div style="font-size:11px;color:#888;margin-bottom:4px">' + (t.return_code_label || 'کد مرجوعی') + '</div>' +
        '<div style="font-size:22px;font-weight:800;letter-spacing:3px;color:var(--primary)">' + ret.return_code + '</div>' +
        (user ? '<div style="font-size:11px;color:#555;margin-top:6px">' + (t.return_code_instr || '') + '</div>' +
                '<div style="font-size:12px;color:#333;margin-top:4px"><strong>' + (user.full_name || '') + '</strong> · <span dir="ltr">' + (user.mobile || '') + '</span></div>'
              : '') +
      '</div>';
    }
    // Status badge
    html += '<div style="display:inline-flex;align-items:center;gap:6px;background:' + sc + '20;color:' + sc + ';border:1px solid ' + sc + '60;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;margin-bottom:10px">' +
      '● ' + (statusLabels[ret.status] || ret.status) + '</div>';
    // Timeline timestamps
    var times = [];
    if (ret.requested_at)  times.push([t.ret_requested_at || 'درخواست', ret.requested_at]);
    if (ret.shipped_at)    times.push([t.ret_shipped_at || 'ارسال', ret.shipped_at]);
    if (ret.received_at)   times.push([t.ret_received_at || 'دریافت', ret.received_at]);
    if (ret.rejected_at)   times.push([t.ret_rejected_at || 'رد درخواست', ret.rejected_at]);
    if (ret.refund_sent_at) times.push([t.ret_refund_sent_at || 'واریز', ret.refund_sent_at]);
    if (ret.completed_at)  times.push([t.ret_completed_at || 'تکمیل', ret.completed_at]);
    if (times.length) {
      html += '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px">';
      times.forEach(function(tp) {
        html += '<div class="order-payment-row"><span>' + tp[0] + ':</span><span style="direction:ltr">' + new Date(tp[1]).toLocaleString(dateLocale) + '</span></div>';
      });
      html += '</div>';
    }
    // Rejection box
    if (ret.status === 'refund_rejected' && ret.rejection_reason) {
      var reasonMap = { defective: t.ret_reason_defective || 'معیوب', damaged: t.ret_reason_damaged || 'آسیب‌دیده', used: t.ret_reason_used || 'استفاده شده' };
      html += '<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="color:#b91c1c;font-size:13px;font-weight:700;margin-bottom:6px">🚫 ' + (t.ret_status_rejected || 'بازگشت رد شد') + '</div>' +
        '<div style="font-size:13px;margin-bottom:4px"><strong>' + (t.ret_rejection_reason || 'دلیل') + ':</strong> ' + (reasonMap[ret.rejection_reason] || ret.rejection_reason) + '</div>' +
        (ret.rejection_note ? '<div style="font-size:12px;color:#555;white-space:pre-wrap;margin-bottom:4px">' + ret.rejection_note.replace(/</g,'&lt;') + '</div>' : '') +
        (ret.rejection_photo_url ? '<a href="' + SERVER_BASE + ret.rejection_photo_url + '" target="_blank" style="font-size:12px;color:#ef4444">📷 ' + (t.ret_rejection_photo || 'عکس محصول') + ' ↗</a>' : '') +
      '</div>';
    }
    // Carrier info
    if (ret.carrier_name) {
      html += '<div class="order-payment-row"><span>' + (t.return_carrier_label || 'باربری') + ':</span>' + ret.carrier_name + '</div>';
    }
    if (ret.carrier_tracking) {
      html += '<div class="order-payment-row"><span>' + (t.return_tracking_label || 'کد رهگیری') + ':</span><strong style="direction:ltr">' + ret.carrier_tracking + '</strong></div>';
    }
    if (ret.shipping_receipt_url) {
      html += '<a href="' + SERVER_BASE + ret.shipping_receipt_url + '" target="_blank" style="display:inline-block;font-size:12px;color:var(--primary);margin-bottom:8px">📄 ' + (t.return_receipt_label || 'رسید ارسال') + ' ↗</a>';
    }
    if (ret.refund_receipt_url) {
      html += '<a href="' + SERVER_BASE + ret.refund_receipt_url + '" target="_blank" style="display:inline-block;font-size:12px;color:#16a34a;margin-bottom:8px">🧾 ' + (t.ret_status_refund_sent || 'رسید واریز') + ' ↗</a>';
    }
    // Deadline
    if (ret.status === 'requested' && ret.deadline_at) {
      var dlStr = new Date(ret.deadline_at).toLocaleString(dateLocale);
      html += '<div style="font-size:12px;color:#f59e0b;margin-bottom:8px">⏱ ' + (t.return_deadline_label || 'مهلت:') + ' ' + dlStr + '</div>';
    }
    // Action: upload shipping receipt
    if (ret.status === 'requested') {
      html += '<div style="margin-top:8px">' +
        '<input type="text" id="ret-carrier-' + ret.id + '" placeholder="' + (t.return_carrier_label || '') + '" class="order-msg-input" style="width:100%;box-sizing:border-box;margin-bottom:6px">' +
        '<input type="text" id="ret-tracking-' + ret.id + '" placeholder="' + (t.return_tracking_label || 'کد رهگیری مرسوله') + '" class="order-msg-input" style="width:100%;box-sizing:border-box;margin-bottom:6px;direction:ltr">' +
        '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">' + (t.return_receipt_label || '') + '</label>' +
        '<input type="file" id="ret-receipt-file-' + ret.id + '" accept="image/*,.pdf" style="display:none" onchange="submitReturnShipping(' + ret.id + ',' + orderId + ')">' +
        '<button class="return-action-btn return-btn-primary" onclick="document.getElementById(\'ret-receipt-file-' + ret.id + '\').click()">' + (t.return_upload_btn || 'ثبت ارسال') + '</button>' +
      '</div>';
    }
    // Action: IBAN form (shipped or received) — readonly if already saved
    if (['shipped', 'received'].includes(ret.status)) {
      html += '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e5d8d0">' +
        '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:6px">💳 ' + (t.return_iban_label || '') + '</div>';
      if (ret.refund_iban) {
        html += '<div class="order-payment-row" style="direction:ltr;margin-bottom:4px"><span>IBAN:</span><strong>' + ret.refund_iban + '</strong>' + copyBtn(ret.refund_iban) + '</div>' +
          '<div class="order-payment-row" style="margin-bottom:0"><span>' + (t.return_holder_label || '') + ':</span>' + ret.refund_holder + copyBtn(ret.refund_holder) + '</div>' +
          '<div style="font-size:11px;color:#16a34a;margin-top:6px">✓ ' + (t.ret_iban_saved || 'ذخیره شد') + '</div>';
      } else {
        html += '<input type="text" id="ret-iban-' + ret.id + '" placeholder="TR000000000000000000000000" class="order-msg-input" style="width:100%;box-sizing:border-box;margin-bottom:6px;direction:ltr" oninput="formatIbanInput(this)" maxlength="26">' +
          '<input type="text" id="ret-holder-' + ret.id + '" placeholder="' + (t.return_holder_label || '') + '" class="order-msg-input" style="width:100%;box-sizing:border-box;margin-bottom:6px">' +
          '<button class="return-action-btn return-btn-primary" onclick="submitReturnIban(' + ret.id + ',' + orderId + ')">' + (t.return_iban_save_btn || 'ذخیره') + '</button>';
      }
      html += '</div>';
    }
    // Action: confirm refund
    if (ret.status === 'refund_sent') {
      html += '<button class="return-action-btn return-btn-success" style="margin-top:10px" onclick="confirmReturnRefund(' + ret.id + ',' + orderId + ')">' + (t.return_confirm_refund || 'تأیید دریافت وجه') + '</button>';
    }
    html += '</div>';
  }

  html += '</div>';
  sect.innerHTML = html;
}

function confirmRequestReturn(orderId) {
  var token = getSession(); if (!token) { openAuthModal('login'); return; }
  fetch(API_BASE + '/orders/' + orderId + '/returns', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': token },
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      var ord = (_cachedApiOrders || []).find(function(o) { return o.id === orderId; });
      renderOrderReturn(orderId, ord, data.data);
    } else {
      showToast(data.message || 'خطا', 'error');
    }
  }).catch(function() { showToast('خطا', 'error'); });
}

function submitReturnShipping(returnId, orderId) {
  var token = getSession(); if (!token) { openAuthModal('login'); return; }
  var carrierEl  = document.getElementById('ret-carrier-' + returnId);
  var trackingEl = document.getElementById('ret-tracking-' + returnId);
  var fileEl     = document.getElementById('ret-receipt-file-' + returnId);
  var carrier  = carrierEl  ? carrierEl.value.trim()  : '';
  var tracking = trackingEl ? trackingEl.value.trim() : '';
  if (!carrier) { showToast(TRANSLATIONS[currentLang].return_carrier_label || 'نام باربری الزامی است', 'error'); return; }
  if (!fileEl || !fileEl.files[0]) return;
  var fd = new FormData();
  fd.append('carrier_name', carrier);
  if (tracking) fd.append('carrier_tracking', tracking);
  fd.append('receipt', fileEl.files[0]);
  fetch(API_BASE + '/orders/returns/' + returnId + '/shipping', {
    method: 'POST', headers: { 'x-session-token': token }, body: fd,
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      var ord = (_cachedApiOrders || []).find(function(o) { return o.id === orderId; });
      renderOrderReturn(orderId, ord, data.data);
    } else {
      showToast(data.message || 'خطا', 'error');
    }
  }).catch(function() { showToast('خطا', 'error'); });
}

// ─── Customer product photos ──────────────────────────────────────────────────
var _uploadedPhotos = {}; // orderId_productId => true

function buildProductPhotoUploadSection(order) {
  var t = TRANSLATIONS[currentLang] || TRANSLATIONS['fa'];
  var items = order.order_items || [];
  if (!items.length) return '';
  var nameKey = currentLang === 'fa' ? 'name_fa' : currentLang === 'tr' ? 'name_tr' : 'name_en';
  var rows = items.map(function(oi) {
    var pid   = oi.product_id || (oi.products && oi.products.id);
    var pname = oi.products ? (oi.products[nameKey] || oi.products.name_fa || '') : '';
    var key   = order.id + '_' + pid;
    var already = _uploadedPhotos[key];
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">' +
      '<span style="font-size:13px;color:#374151">' + pname + '</span>' +
      (already
        ? '<span style="font-size:12px;color:#16a34a">✓ ' + (t.cphoto_uploaded || 'ثبت شد') + '</span>'
        : '<label style="cursor:pointer;background:var(--primary);color:#fff;font-size:12px;padding:4px 10px;border-radius:6px">' +
            (t.cphoto_btn || '📷 آپلود') +
            '<input type="file" accept="image/*" style="display:none" onchange="submitProductPhoto(this,' + order.id + ',' + pid + ')">' +
          '</label>'
      ) +
    '</div>';
  }).join('');
  return '<div style="margin-top:12px;padding:12px 14px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">' +
    '<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:4px">📷 ' + (t.cphoto_section || 'عکس واقعی محصول') + '</div>' +
    '<div style="font-size:12px;color:#9ca3af;margin-bottom:10px">' + (t.cphoto_hint || '') + '</div>' +
    rows +
  '</div>';
}

function submitProductPhoto(inputEl, orderId, productId) {
  var t     = TRANSLATIONS[currentLang] || TRANSLATIONS['fa'];
  var token = getSession();
  if (!token) { openAuthModal('login'); return; }
  var file = inputEl.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('photo', file);
  fd.append('product_id', productId);
  fetch(API_BASE + '/orders/' + orderId + '/product-photos', {
    method: 'POST', headers: { 'x-session-token': token }, body: fd,
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      _uploadedPhotos[orderId + '_' + productId] = true;
      showToast(t.cphoto_uploaded || 'ثبت شد');
      var label = inputEl.closest('label');
      if (label) {
        var span = document.createElement('span');
        span.style.cssText = 'font-size:12px;color:#16a34a';
        span.textContent = '✓ ' + (t.cphoto_uploaded || 'ثبت شد');
        label.parentNode.replaceChild(span, label);
      }
    } else if (data.message === 'already_uploaded') {
      showToast(t.cphoto_already || 'قبلاً آپلود کرده‌اید', 'error');
    } else {
      showToast(data.message || 'خطا', 'error');
    }
  }).catch(function() { showToast('خطا', 'error'); });
}

function loadProductPhotos(productId, containerEl) {
  fetch(API_BASE + '/products/' + productId + '/customer-photos')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success || !data.data.length) { containerEl.remove(); return; }
      var t = TRANSLATIONS[currentLang] || TRANSLATIONS['fa'];
      var html = '<div style="margin-top:16px">' +
        '<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">📷 ' + (t.cphoto_customer_photos || 'عکس‌های خریداران') + ' (' + data.data.length + ')</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        data.data.map(function(p) {
          return '<a href="' + SERVER_BASE + p.photo_url + '" target="_blank" style="display:block;flex-shrink:0">' +
            '<img src="' + SERVER_BASE + p.photo_url + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">' +
          '</a>';
        }).join('') +
        '</div></div>';
      containerEl.innerHTML = html;
    }).catch(function() { containerEl.remove(); });
}

function copyVal(val) {
  navigator.clipboard.writeText(val).then(function() {
    showToast(TRANSLATIONS[currentLang].copied || 'Copied!');
  }).catch(function() {
    var ta = document.createElement('textarea');
    ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(TRANSLATIONS[currentLang].copied || 'Copied!');
  });
}
function copyBtn(val) {
  var safe = val.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return '<button onclick="copyVal(\'' + safe + '\')" title="Copy" style="background:none;border:none;cursor:pointer;padding:2px 5px;color:#aaa;font-size:13px;vertical-align:middle;line-height:1" onmouseover="this.style.color=\'#f97316\'" onmouseout="this.style.color=\'#aaa\'">⧉</button>';
}

function formatIbanInput(el) {
  var v = el.value.toUpperCase();
  var result = '';
  if (v.length > 0) result += (v[0] === 'T' ? 'T' : '');
  if (v.length > 1) result += (v[1] === 'R' ? 'R' : '');
  result += v.slice(result.length).replace(/\D/g, '');
  el.value = result.slice(0, 26);
}

function submitReturnIban(returnId, orderId) {
  var token = getSession(); if (!token) { openAuthModal('login'); return; }
  var iban   = (document.getElementById('ret-iban-' + returnId) || {}).value || '';
  var holder = (document.getElementById('ret-holder-' + returnId) || {}).value || '';
  if (!iban.trim() || !holder.trim()) { showToast(TRANSLATIONS[currentLang].return_iban_label || 'اطلاعات ناقص', 'error'); return; }
  if (!/^TR\d{24}$/.test(iban.trim())) { showToast(TRANSLATIONS[currentLang].ret_iban_invalid || 'IBAN invalid', 'error'); return; }
  fetch(API_BASE + '/orders/returns/' + returnId + '/refund-info', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ refund_iban: iban.trim(), refund_holder: holder.trim() }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      showToast(TRANSLATIONS[currentLang].ret_iban_saved || 'ذخیره شد');
      var ord = (_cachedApiOrders || []).find(function(o) { return o.id === orderId; });
      renderOrderReturn(orderId, ord, data.data);
    } else { showToast(data.message || 'خطا', 'error'); }
  }).catch(function() { showToast('خطا', 'error'); });
}

function confirmReturnRefund(returnId, orderId) {
  var token = getSession(); if (!token) { openAuthModal('login'); return; }
  fetch(API_BASE + '/orders/returns/' + returnId + '/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': token },
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      var ord = (_cachedApiOrders || []).find(function(o) { return o.id === orderId; });
      renderOrderReturn(orderId, ord, data.data);
    } else { showToast(data.message || 'خطا', 'error'); }
  }).catch(function() { showToast('خطا', 'error'); });
}

// ─── Favorites ────────────────────────────────────────────────────────────────
function toggleFavorite(event, productId) {
  event.stopPropagation();
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  var favs = user.favorites || [];
  var idx  = favs.indexOf(productId);
  if (idx === -1) favs.push(productId);
  else            favs.splice(idx, 1);
  user.favorites = favs;
  updateUser(user);
  updateFavBadge();
  var btn = event.currentTarget;
  if (btn) btn.classList.toggle('fav-active', idx === -1);
  var profileFavTab = document.getElementById('profile-tab-favorites');
  if (profileFavTab && profileFavTab.style.display !== 'none') renderFavoritesTab();
  syncFavoriteToServer(productId, idx === -1);
}

function syncFavoriteToServer(productId, add) {
  var tok = getSession(); if (!tok) return;
  fetch(API_BASE + '/customers/favorites/' + productId, {
    method: add ? 'POST' : 'DELETE',
    headers: { 'x-session-token': tok },
  }).catch(function() {});
}

// ─── Checkout ─────────────────────────────────────────────────────────────────
var _checkoutAddrId = null;

function openCheckout() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  if (!cart.length) { openCart(); return; }
  closeCart();
  var overlay = document.getElementById('checkout-overlay');
  var header = document.querySelector('.header');
  var headerBottom = header ? header.getBoundingClientRect().bottom : 64;
  var bannerEl = document.getElementById('discount-banner');
  var bannerH = (bannerEl && bannerEl.style.display !== 'none') ? bannerEl.getBoundingClientRect().height : 0;
  overlay.style.top = (headerBottom + bannerH) + 'px';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (location.pathname !== '/checkout') {
    history.pushState({ page: 'checkout' }, '', '/checkout');
  }
  var profilePromise = fetch(API_BASE + '/customers/profile', { headers: { 'x-session-token': getSession() } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.data) {
        var u = data.data;
        if (Array.isArray(u.addresses)) {
          u.addresses = u.addresses.map(function(a) {
            return { id: a.id, name: a.recipient, phone: a.phone, city: a.city, postal: a.postal_code || '', detail: a.detail, is_default: a.is_default };
          });
        }
        var cur = getCurrentUser();
        u.favorites = cur.favorites || [];
        u.orders    = cur.orders    || [];
        updateUser(u);
      }
    })
    .catch(function() {});
  Promise.allSettled([profilePromise]).then(function() {
    renderCheckout();
  });
}

function closeCheckout() {
  document.getElementById('checkout-overlay').classList.remove('open');
  document.body.style.overflow = '';
  _appliedCoupon = null;
  if (location.pathname === '/checkout') history.back();
}

window.addEventListener('popstate', function(e) {
  var overlay = document.getElementById('checkout-overlay');
  if (overlay && overlay.classList.contains('open')) {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    _appliedCoupon = null;
  }
});

// ─── Discount Coupon ──────────────────────────────────────────────────────────
var _appliedCoupon = null;

function applyCoupon() {
  var code  = (document.getElementById('coupon-input')?.value || '').trim().toUpperCase();
  var resEl = document.getElementById('coupon-result');
  if (!code) return;
  var token = getSession();
  if (!token) { openAuthModal('login'); return; }

  var cartTotal = cart.reduce(function(s, item) {
    var p = products.find(function(pr){ return pr.id === item.id; });
    if (!p) return s;
    var u = p.discounted_price && p.discounted_price < p.price ? p.discounted_price : p.price;
    return s + u * item.qty;
  }, 0);

  fetch(API_BASE + '/coupons/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ code: code, cart_total: cartTotal }),
  }).then(function(r){ return r.json(); }).then(function(d) {
    resEl.style.display = '';
    var tr = TRANSLATIONS[currentLang];
    if (d.success) {
      _appliedCoupon = d.data;
      var label = d.data.type === 'percent'
        ? d.data.value + '%'
        : formatPrice(d.data.value);
      resEl.innerHTML = '<span style="color:#2eaa72;font-weight:600">✓ ' + label + ' ' + (tr.coupon_applied || '') + '</span>';
      document.getElementById('checkout-original-row').style.display = '';
      document.getElementById('checkout-original-price').textContent = formatPrice(cartTotal);
      document.getElementById('checkout-discount-row').style.display = '';
      document.getElementById('checkout-discount-price').textContent = '- ' + formatPrice(d.data.discount_amount);
      document.getElementById('checkout-total-price').textContent    = formatPrice(d.data.final_amount);
    } else {
      _appliedCoupon = null;
      var specialMsg = d.message === 'min_orders_required'
        ? (currentLang === 'fa'
            ? 'این کد نیاز به حداقل ' + d.min_orders + ' خرید تحویل‌شده دارد (شما ' + d.current_orders + ' خرید دارید)'
            : currentLang === 'tr'
            ? 'Bu kod en az ' + d.min_orders + ' teslim edilmiş sipariş gerektirir (' + d.current_orders + ' siparişiniz var)'
            : 'This code requires at least ' + d.min_orders + ' delivered orders (you have ' + d.current_orders + ')')
        : d.message === 'first_order_only'
        ? (currentLang === 'fa' ? 'این کد فقط برای اولین خرید قابل استفاده است'
            : currentLang === 'tr' ? 'Bu kod yalnızca ilk siparişte geçerlidir'
            : 'This code is only valid for your first order')
        : null;
      var msgs = { invalid_code: tr.coupon_invalid, not_eligible: tr.coupon_not_eligible, limit_reached: tr.coupon_limit_reached, already_used: tr.coupon_already_used };
      resEl.innerHTML = '<span style="color:#ef4444">' + escapeHtml(specialMsg || msgs[d.message] || d.message || '?') + '</span>';
      document.getElementById('checkout-original-row').style.display = 'none';
      document.getElementById('checkout-discount-row').style.display = 'none';
      var cartT = cart.reduce(function(s,item){ var p=products.find(function(pr){return pr.id===item.id;}); if(!p)return s; var u=p.discounted_price&&p.discounted_price<p.price?p.discounted_price:p.price; return s+u*item.qty; },0);
      document.getElementById('checkout-total-price').textContent = formatPrice(cartT);
    }
  }).catch(function() {
    var tr2 = TRANSLATIONS[currentLang];
    resEl.style.display = '';
    resEl.innerHTML = '<span style="color:#ef4444">' + (tr2.coupon_net_err || '!') + '</span>';
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────
var _bannerClosed = false;

var _bannerData = null;

function loadBanners() {
  if (_bannerClosed) return;
  fetch(API_BASE.replace('/api','') + '/api/banners')
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (!d.success || !d.data.length) return;
      _bannerData = d.data[0];
      renderBanner();
    }).catch(function(){});
}

function renderBanner() {
  if (!_bannerData || _bannerClosed) return;
  var banner = _bannerData;
  var T = TRANSLATIONS[currentLang] || TRANSLATIONS['fa'];
  var text = banner['banner_text_' + currentLang] || banner.banner_text_fa || banner.banner_text_en || '';
  if (!text && !banner.code) return;

  document.getElementById('discount-banner-text').textContent = text;
  document.getElementById('discount-banner-code').textContent = banner.code;
  document.getElementById('discount-banner-copy-tip').textContent = T.banner_copied || '✓';

  var expEl = document.getElementById('discount-banner-exp');
  if (banner.expires_at) {
    var locale = currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-GB';
    var dateStr = new Date(banner.expires_at).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    expEl.textContent = (T.banner_until || 'تا') + ' ' + dateStr;
    expEl.style.display = '';
  } else {
    expEl.textContent = '';
    expEl.style.display = 'none';
  }

  document.getElementById('discount-banner').style.display = '';
}

function copyBannerCode() {
  var code = document.getElementById('discount-banner-code')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(function() {
    var tip = document.getElementById('discount-banner-copy-tip');
    tip.style.opacity = '1';
    setTimeout(function(){ tip.style.opacity = '0'; }, 1500);
  }).catch(function() {});
}

function closeBanner() {
  _bannerClosed = true;
  document.getElementById('discount-banner').style.display = 'none';
}

function _buildCheckoutItemHtml(item, idx) {
  var p = products.find(function(pr) { return pr.id === item.id; });
  if (!p) return '';
  var name      = p.name[currentLang] || p.name.fa;
  var colorObj  = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey] : null;
  var colorName = colorObj ? (colorObj.name[currentLang] || colorObj.name.fa) : '';
  var colorHex  = colorObj ? colorObj.hex : '';
  var metaParts = [];
  if (colorName) metaParts.push('<span class="cart-item-color-dot" style="background:' + colorHex + ';width:8px;height:8px;border-radius:50%;display:inline-block;margin-inline-end:4px"></span>' + colorName);
  if (item.size) metaParts.push(item.size);
  var unitPrice = p.discounted_price && p.discounted_price < p.price ? p.discounted_price : p.price;
  var firstImg  = p.images && p.images.length ? p.images[0] : null;
  var thumb     = firstImg
    ? '<img src="' + SERVER_BASE + firstImg.url + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">'
    : (p.emoji ? '<span style="font-size:26px">' + p.emoji + '</span>' : PLACEHOLDER_SVG);
  return '<div class="checkout-item">' +
    '<div class="checkout-item-thumb" style="background:' + p.gradient + '">' + thumb + '</div>' +
    '<div class="checkout-item-info">' +
      '<span class="checkout-item-name">' + name + '</span>' +
      (p.code ? '<span class="checkout-item-code" onclick="copyProductCode(\'' + p.code + '\')" title="Copy">' + p.code + '</span>' : '') +
      (metaParts.length ? '<span class="checkout-item-meta">' + metaParts.join(' · ') + '</span>' : '') +
      '<div class="co-qty-ctrl">' +
        '<button class="co-qty-btn" onclick="checkoutChangeQty(' + idx + ',-1)">−</button>' +
        '<span class="co-qty-num">' + item.qty + '</span>' +
        '<button class="co-qty-btn" onclick="checkoutChangeQty(' + idx + ',1)">+</button>' +
        '<button class="co-qty-remove" onclick="checkoutRemoveItem(' + idx + ')" title="حذف">×</button>' +
      '</div>' +
    '</div>' +
    '<div class="checkout-item-right">' +
      (p.discounted_price && p.discounted_price < p.price
        ? '<div class="checkout-item-price-orig">' + formatPrice(p.price * item.qty) + '</div><div class="checkout-item-price">' + formatPrice(unitPrice * item.qty) + '</div>'
        : '<div class="checkout-item-price">' + formatPrice(unitPrice * item.qty) + '</div>') +
    '</div>' +
  '</div>';
}

function checkoutChangeQty(idx, delta) {
  if (!cart[idx]) return;
  var newQty = cart[idx].qty + delta;
  if (newQty < 1) { checkoutRemoveItem(idx); return; }
  cart[idx].qty = newQty;
  saveCart();
  _checkoutRefreshItems();
}

function checkoutRemoveItem(idx) {
  if (!cart[idx]) return;
  cart.splice(idx, 1);
  saveCart();
  if (cart.length === 0) { closeCheckout(); return; }
  _checkoutRefreshItems();
}

function _checkoutRefreshItems() {
  _appliedCoupon = null;
  var ci = document.getElementById('coupon-input'); if (ci) ci.value = '';
  var cr = document.getElementById('coupon-result'); if (cr) cr.style.display = 'none';
  var orRow = document.getElementById('checkout-original-row'); if (orRow) orRow.style.display = 'none';
  var disRow = document.getElementById('checkout-discount-row'); if (disRow) disRow.style.display = 'none';

  document.getElementById('checkout-items-list').innerHTML = cart.map(_buildCheckoutItemHtml).join('');

  var total = cart.reduce(function(s, item) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    if (!p) return s;
    var u = p.discounted_price && p.discounted_price < p.price ? p.discounted_price : p.price;
    return s + u * item.qty;
  }, 0);
  document.getElementById('checkout-total-price').textContent = formatPrice(total);
  updateCartBadge();
}

function renderCheckout() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  if (!user) return;

  // ── Items ──────────────────────────────────────────────────────────────────
  document.getElementById('checkout-items-list').innerHTML = cart.map(_buildCheckoutItemHtml).join('');

  // ── Total ──────────────────────────────────────────────────────────────────
  var total = cart.reduce(function(s, item) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    if (!p) return s;
    var u = p.discounted_price && p.discounted_price < p.price ? p.discounted_price : p.price;
    return s + u * item.qty;
  }, 0);
  // reset coupon UI when checkout re-renders
  _appliedCoupon = null;
  var ci = document.getElementById('coupon-input'); if (ci) ci.value = '';
  var cr = document.getElementById('coupon-result'); if (cr) cr.style.display = 'none';
  var orRow = document.getElementById('checkout-original-row'); if (orRow) orRow.style.display = 'none';
  var disRow = document.getElementById('checkout-discount-row'); if (disRow) disRow.style.display = 'none';
  document.getElementById('checkout-total-price').textContent = formatPrice(total);

  // ── Addresses ──────────────────────────────────────────────────────────────
  var addrs = user.addresses || [];
  addrs.sort(function(a, b) { return (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0); });
  if (!_checkoutAddrId) {
    var defAddr = addrs.find(function(a) { return a.is_default; }) || addrs[0];
    if (defAddr) _checkoutAddrId = defAddr.id;
  }
  document.getElementById('checkout-addr-list').innerHTML = addrs.map(function(a) {
    var sel = a.id === _checkoutAddrId;
    return '<div class="checkout-addr-card' + (sel ? ' selected' : '') + '" onclick="selectCheckoutAddr(' + a.id + ')">' +
      '<div class="checkout-addr-radio"><div class="checkout-addr-radio-dot"></div></div>' +
      '<div class="checkout-addr-info">' +
        '<span class="checkout-addr-name">' + a.name + (a.is_default ? '<span class="checkout-addr-default">★</span>' : '') + '</span>' +
        '<span class="checkout-addr-phone">' + a.phone + '</span>' +
        '<span class="checkout-addr-detail">' + a.city + ' — ' + a.detail + (a.postal ? ' (' + a.postal + ')' : '') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('checkout-addr-list').style.display = 'none';
  document.getElementById('checkout-add-addr-btn').style.display = addrs.length ? 'none' : '';
  document.getElementById('checkout-addr-form').style.display = 'none';
  renderCheckoutAddrSelected();

  // ── Note placeholder ───────────────────────────────────────────────────────
  var noteEl = document.getElementById('checkout-note');
  if (noteEl) noteEl.placeholder = t.checkout_note_ph || '';
}

function renderCheckoutAddrSelected() {
  var user = getCurrentUser();
  if (!user) return;
  var t = TRANSLATIONS[currentLang];
  var addrs = user.addresses || [];
  var selAddr = addrs.find(function(a) { return a.id === _checkoutAddrId; });
  var html = '';
  if (selAddr) {
    html = '<div class="checkout-addr-card selected">' +
      '<div class="checkout-addr-radio"><div class="checkout-addr-radio-dot"></div></div>' +
      '<div class="checkout-addr-info">' +
        '<span class="checkout-addr-name">' + selAddr.name + (selAddr.is_default ? '<span class="checkout-addr-default">★</span>' : '') + '</span>' +
        '<span class="checkout-addr-phone">' + selAddr.phone + '</span>' +
        '<span class="checkout-addr-detail">' + selAddr.city + ' — ' + selAddr.detail + (selAddr.postal ? ' (' + selAddr.postal + ')' : '') + '</span>' +
      '</div>' +
    '</div>';
    if (addrs.length > 1) {
      html += '<button class="checkout-change-addr-btn" onclick="openCheckoutAddrList()">' + (t.checkout_change_addr || 'تغییر آدرس') + '</button>';
    }
  } else if (!addrs.length) {
    html = '<div class="checkout-no-addr">' + (t.checkout_no_addr || 'آدرسی ندارید') + '</div>';
  }
  var sel = document.getElementById('checkout-addr-selected');
  if (sel) { sel.innerHTML = html; sel.style.display = ''; }
}

function openCheckoutAddrList() {
  document.getElementById('checkout-addr-selected').style.display = 'none';
  document.getElementById('checkout-addr-list').style.display = 'block';
  document.getElementById('checkout-add-addr-btn').style.display = '';
}

function selectCheckoutAddr(id) {
  _checkoutAddrId = id;
  document.getElementById('checkout-addr-list').style.display = 'none';
  document.getElementById('checkout-add-addr-btn').style.display = 'none';
  renderCheckoutAddrSelected();
}

function checkoutAddAddress() {
  document.getElementById('checkout-addr-form').style.display = 'block';
  document.getElementById('checkout-add-addr-btn').style.display = 'none';
  document.getElementById('checkout-addr-list').style.display = 'none';
  document.getElementById('checkout-addr-selected').style.display = 'none';
  ['co-addr-name','co-addr-phone','co-addr-city','co-addr-postal','co-addr-detail'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
}

function checkoutCancelAddress() {
  document.getElementById('checkout-addr-form').style.display = 'none';
  var user = getCurrentUser();
  var addrs = (user && user.addresses) || [];
  document.getElementById('checkout-add-addr-btn').style.display = addrs.length ? 'none' : '';
  renderCheckoutAddrSelected();
}

function checkoutSaveAddress() {
  var t    = TRANSLATIONS[currentLang];
  var name   = (document.getElementById('co-addr-name').value   || '').trim();
  var phone  = (document.getElementById('co-addr-phone').value  || '').trim();
  var city   = (document.getElementById('co-addr-city').value   || '').trim();
  var postal = (document.getElementById('co-addr-postal').value || '').trim();
  var detail = (document.getElementById('co-addr-detail').value || '').trim();
  var ok = true;
  if (!name)   { document.getElementById('co-addr-name-err').textContent   = t.err_required || 'الزامی است'; ok = false; }
  if (!phone)  { document.getElementById('co-addr-phone-err').textContent  = t.err_required || 'الزامی است'; ok = false; }
  if (!city)   { document.getElementById('co-addr-city-err').textContent   = t.err_required || 'الزامی است'; ok = false; }
  if (!detail) { document.getElementById('co-addr-detail-err').textContent = t.err_required || 'الزامی است'; ok = false; }
  if (!ok) return;
  ['co-addr-name-err','co-addr-phone-err','co-addr-city-err','co-addr-detail-err'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = '';
  });
  var tok = getSession(); if (!tok) return;
  var btn = document.querySelector('#checkout-addr-form .auth-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  fetch(API_BASE + '/customers/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': tok },
    body: JSON.stringify({ recipient: name, phone: phone, city: city, postal_code: postal || null, detail: detail }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      var user = getCurrentUser();
      var entry = { id: data.data.id, name: data.data.recipient, phone: data.data.phone, city: data.data.city, postal: data.data.postal_code || '', detail: data.data.detail, is_default: data.data.is_default };
      user.addresses = user.addresses || [];
      user.addresses.push(entry);
      updateUser(user);
      _checkoutAddrId = entry.id;
      renderCheckout();
    }
  }).catch(function() {}).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = t.addr_save_btn || 'ذخیره'; }
  });
}

function submitCheckout() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  if (!user || !cart.length) return;

  var missingEmail  = !user.email;
  var missingMobile = !user.mobile;
  if (missingEmail || missingMobile) {
    var msg = (missingEmail && missingMobile)
      ? (t.order_need_email_mobile || 'Email va mobile lazem ast')
      : missingEmail
        ? (t.order_need_email  || 'Email lazem ast')
        : (t.order_need_mobile || 'Mobile lazem ast');
    showConfirm(msg, function() {
      closeCheckout();
      openProfileModal();
      showProfileTab('info');
    }, t.go_to_profile || 'Raft be profile');
    return;
  }

  var addrs = user.addresses || [];
  var errEl = document.getElementById('checkout-err');
  errEl.textContent = '';

  if (!_checkoutAddrId) {
    if (addrs.length) {
      showConfirm(t.checkout_select_addr || 'یک آدرس انتخاب کنید', function() {});
    } else {
      showConfirm(t.checkout_need_addr || 'ابتدا یک آدرس تحویل اضافه کنید', function() {
        closeCheckout();
        openProfileModal();
        showProfileTab('addresses');
      }, t.checkout_add_addr_btn || 'افزودن آدرس');
    }
    return;
  }

  var note         = (document.getElementById('checkout-note').value || '').trim();
  var token        = getSession();
  var couponResEl  = document.getElementById('coupon-result');
  var couponInputVal = (document.getElementById('coupon-input')?.value || '').trim().toUpperCase();
  var items = cart.map(function(item) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    var colorObj = p && item.colorKey ? p.colors.find(function(c) { return c.key === item.colorKey; }) : null;
    var unitPrice = p && p.discounted_price && p.discounted_price < p.price ? p.discounted_price : (p ? p.price : 0);
    return {
      product_id: item.id,
      color_id:   colorObj ? colorObj.id : null,
      size_label: item.size || null,
      qty:        item.qty,
      unit_price: unitPrice,
    };
  });

  var btn = document.getElementById('checkout-submit-btn');
  btn.disabled = true;

  // If coupon input has text that hasn't been validated yet, validate first
  var needsCouponValidation = couponInputVal && (!_appliedCoupon || _appliedCoupon.code !== couponInputVal);
  var couponPromise = needsCouponValidation
    ? fetch(API_BASE + '/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body: JSON.stringify({ code: couponInputVal, cart_total: cart.reduce(function(s, item) {
          var p = products.find(function(pr){ return pr.id === item.id; });
          if (!p) return s;
          return s + (p.discounted_price && p.discounted_price < p.price ? p.discounted_price : p.price) * item.qty;
        }, 0) }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (!d.success) {
          var tr2 = TRANSLATIONS[currentLang];
          var specialMsg2 = d.message === 'min_orders_required'
            ? (currentLang === 'fa'
                ? 'این کد نیاز به حداقل ' + d.min_orders + ' خرید تحویل‌شده دارد (شما ' + d.current_orders + ' خرید دارید)'
                : currentLang === 'tr'
                ? 'Bu kod en az ' + d.min_orders + ' teslim edilmiş sipariş gerektirir (' + d.current_orders + ' siparişiniz var)'
                : 'This code requires at least ' + d.min_orders + ' delivered orders (you have ' + d.current_orders + ')')
            : d.message === 'first_order_only'
            ? (currentLang === 'fa' ? 'این کد فقط برای اولین خرید قابل استفاده است'
                : currentLang === 'tr' ? 'Bu kod yalnızca ilk siparişte geçerlidir'
                : 'This code is only valid for your first order')
            : null;
          var msgs = { invalid_code: tr2.coupon_invalid, not_eligible: tr2.coupon_not_eligible, limit_reached: tr2.coupon_limit_reached, already_used: tr2.coupon_already_used };
          if (couponResEl) { couponResEl.style.display = ''; couponResEl.innerHTML = '<span style="color:#ef4444">' + escapeHtml(specialMsg2 || msgs[d.message] || d.message || '?') + '</span>'; }
          btn.disabled = false;
          return false; // stop submission
        }
        _appliedCoupon = d.data;
        return true;
      })
    : Promise.resolve(true);

  couponPromise.then(function(proceed) {
    if (!proceed) return;
    fetch(API_BASE + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({ items: items, note: note, lang: currentLang, address_id: _checkoutAddrId || null, coupon_code: _appliedCoupon ? _appliedCoupon.code : null }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) {
        currentPreorder = data.data;
        localStorage.setItem('mf_preorder_id', String(data.data.id));
        cart = [];
        saveCart();
        updateOrderStatusBtn();
        closeCheckout();
        showToast(t.preorder_registered || 'پیش‌سفارش ثبت شد');
        reloadProducts(true);
        openProfileModal();
        showProfileTab('orders');
      } else if (data.message === 'active_preorder_exists') {
        if (couponResEl) { couponResEl.style.display = ''; couponResEl.innerHTML = '<span style="color:#ef4444">' + escapeHtml(t.active_preorder_exists || data.message) + '</span>'; }
        else { errEl.textContent = t.active_preorder_exists || data.message; }
      } else {
        errEl.textContent = data.message || t.network_error || 'خطا';
      }
    }).catch(function() {
      errEl.textContent = t.network_error || 'خطا در اتصال';
    }).finally(function() {
      btn.disabled = false;
    });
  }).catch(function() {
    errEl.textContent = t.network_error || 'خطا در اتصال';
    btn.disabled = false;
  });
}

function loadFavoritesFromServer() {
  var tok = getSession(); if (!tok) return;
  fetch(API_BASE + '/customers/favorites', {
    headers: { 'x-session-token': tok },
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success) {
      var user = getCurrentUser(); if (!user) return;
      user.favorites = data.data || [];
      updateUser(user);
      updateFavBadge();
      if (!window.IS_PROFILE_PAGE) renderGrid();
    }
  }).catch(function() {});
}
function renderFavoritesTab() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser(); if (!user) return;
  var container = document.getElementById('profile-tab-favorites');
  var favs      = user.favorites || [];
  var favProds  = products.filter(function(p) { return favs.indexOf(p.id) !== -1; });
  if (!favProds.length) {
    container.innerHTML =
      '<div class="empty-banner empty-banner--favs">' +
      '<div class="empty-banner-bg"></div>' +
      '<div class="empty-banner-body">' +
      '<svg class="empty-banner-svg" viewBox="0 0 64 64" fill="none"><path d="M32 54S8 38 8 22a14 14 0 0124-9.9A14 14 0 0156 22c0 16-24 32-24 32z" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg>' +
      '<p class="empty-banner-title">' + t.profile_no_favs + '</p>' +
      '<button class="empty-banner-btn" onclick="closeProfileModal()">' + (t.nav_all || (currentLang==="fa"?"کشف محصولات":"Explore")) + '</button>' +
      '</div></div>';
    return;
  }
  var t = TRANSLATIONS[currentLang];
  container.innerHTML =
    '<div class="fav-grid">' +
    favProds.map(function(p) {
      var thumb = p.images && p.images.length
        ? '<img src="' + SERVER_BASE + p.images[0].url + '" style="width:100%;height:100%;object-fit:cover;border-radius:10px" onerror="this.style.display=\'none\'">'
        : PLACEHOLDER_SVG;
      var hasDiscount = p.discounted_price && p.discounted_price < p.price;
      var priceHtml = p.price
        ? (hasDiscount
            ? '<div class="fav-price-row"><span class="fav-price-original">' + formatPrice(p.price) + '</span><span class="fav-price">' + formatPrice(p.discounted_price) + '</span></div>'
            : '<div class="fav-price-row"><span class="fav-price">' + formatPrice(p.price) + '</span></div>')
        : '';
      return (
        '<div class="fav-card">' +
        '<div class="fav-thumb" style="background:' + p.gradient + ';cursor:pointer" onclick="closeProfileModal();openModal(' + p.id + ')">' + thumb + '</div>' +
        '<div class="fav-card-body">' +
        '<span class="fav-name" onclick="closeProfileModal();openModal(' + p.id + ')" style="cursor:pointer">' + p.name[currentLang] + '</span>' +
        (p.code ? '<span class="fav-code">' + p.code + '</span>' : '') +
        priceHtml +
        '<button class="fav-card-remove" onclick="removeFavFromProfile(event,' + p.id + ')" title="' + (t.remove_fav || 'حذف') + '">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>' +
        '</button>' +
        '</div>' +
        '</div>'
      );
    }).join('') +
    '</div>';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// ─── Auto Sign-Out (30 min idle) ──────────────────────────────────────────────
var _idleTimer = null;
var IDLE_LIMIT = 30 * 60 * 1000; // 30 minutes

function resetIdleTimer() {
  clearTimeout(_idleTimer);
  if (!getCurrentUser()) return;
  _idleTimer = setTimeout(function() {
    if (!getCurrentUser()) return;
    doLogout();
    openAuthModal('login');
  }, IDLE_LIMIT);
}

function initIdleTimer() {
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function(evt) {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

function reloadProducts(forceRender) {
  fetch(API_BASE + '/products')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data.success) return;
      var newProducts = data.data.map(mapApiProduct);
      var snapshot = function(list) {
        return JSON.stringify(list.map(function(p) {
          return { id: p.id, delivery_days: p.delivery_days, stock: p.stock, price: p.price, tag: p.tag,
                   inv: JSON.stringify(p.inventory) };
        }));
      };
      if (forceRender || snapshot(newProducts) !== snapshot(products)) {
        products = newProducts;
        updateNavVisibility();
        renderGrid();
      }
    })
    .catch(function() {});
}

document.addEventListener('DOMContentLoaded', function() {
  // ── Profile page: skip shop init ─────────────────────────────────────────
  if (window.IS_PROFILE_PAGE) {
    initLangSwitcher();
    initNavDropdowns();
    initHeaderScroll();
    applyLang(currentLang);
    updateCartBadge();
    updateAuthUI();
    updateFavBadge();
    loadBanners();
    if (getCurrentUser()) {
      loadCartFromServer();
      loadFavoritesFromServer();
      loadActivePreorder();
      var _pTab = new URLSearchParams(location.search).get('tab') || 'info';
      openProfileModal();
      showProfileTab(_pTab);
      // Fetch products + categories in parallel
      Promise.all([
        fetch(API_BASE + '/products').then(function(r) { return r.json(); }).catch(function() { return null; }),
        fetch(API_BASE + '/categories').then(function(r) { return r.json(); }).catch(function() { return null; }),
      ]).then(function(results) {
        var prodData = results[0];
        var catData  = results[1];
        if (prodData && prodData.success) {
          products = prodData.data.map(mapApiProduct);
          var favTabEl = document.getElementById('profile-tab-favorites');
          if (favTabEl && favTabEl.style.display !== 'none') renderFavoritesTab();
        }
        if (catData && catData.success && catData.data.length) {
          cachedCategories = catData.data;
          buildMegaMenu(cachedCategories);
        }
      });
    } else {
      openAuthModal('login');
    }
    return;
  }
  // ── Shop page init ────────────────────────────────────────────────────────
  fillContactInfo();
  initLangSwitcher();
  initNavDropdowns();
  initHeaderScroll();
  initSmoothScroll();
  initModal();
  applyLang(currentLang);

  // Close fav panel when clicking outside it (lets the clicked action run normally)
  document.addEventListener('click', function(e) {
    var panel = document.getElementById('fav-page');
    if (!panel || !panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    var favBtn = document.getElementById('fav-header-btn');
    if (favBtn && favBtn.contains(e.target)) return;
    closeFavPanel();
  }, true);
  updateCartBadge();
  updateAuthUI();
  loadBanners();
  if (getCurrentUser()) {
    loadFavoritesFromServer();
    loadCartFromServer();
    // sync avatar from server on every page load
    var _initToken = getSession();
    if (_initToken) {
      fetch(API_BASE + '/customers/profile', { headers: { 'x-session-token': _initToken } })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success && d.data && d.data.avatar) {
            localStorage.setItem('mf_avatar_' + d.data.id, d.data.avatar);
            var u = getCurrentUser();
            if (u) { u.avatar = d.data.avatar; updateUser(u); }
            updateAuthUI();
          }
        }).catch(function() {});
    }
  } else {
    cart = [];
    localStorage.removeItem('cart');
    updateCartBadge();
  }
  initIdleTimer();

  // Apply filter passed via URL query params from profile page nav
  var _navQs = new URLSearchParams(window.location.search);
  if (_navQs.has('_cat') || _navQs.has('_sub') || _navQs.has('_gender')) {
    currentCategory    = _navQs.get('_cat')    || 'all';
    currentSubcategory = _navQs.get('_sub')    || null;
    currentGender      = _navQs.get('_gender') || 'all';
    window.history.replaceState({}, '', window.location.pathname);
  } else {
    // fallback: sessionStorage (kept for other navigation paths)
    var _pendingFilter = sessionStorage.getItem('mf_nav_filter');
    if (_pendingFilter) {
      sessionStorage.removeItem('mf_nav_filter');
      try {
        var _f = JSON.parse(_pendingFilter);
        currentCategory    = _f.cat    || 'all';
        currentGender      = _f.gender || 'all';
        currentSubcategory = _f.sub    || null;
      } catch (e) {}
    }
  }

  // Check for password reset token in URL
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  var resetToken = hashParams.get('reset_token');
  if (resetToken) {
    _resetToken = resetToken;
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(function() { openAuthModal('reset'); }, 300);
  } else {
    restoreFilterFromHash();
  }

  // Auto-open cart or checkout when redirected from product page
  var _openParam = new URLSearchParams(window.location.search).get('open');
  var _openFlag  = sessionStorage.getItem('pd_open_checkout');
  if (_openFlag) sessionStorage.removeItem('pd_open_checkout');
  if (_openParam) {
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    if (_openParam === 'checkout') {
      setTimeout(function() { openCheckout(); }, 400);
    } else if (_openParam === 'cart') {
      setTimeout(function() { openCart(); }, 400);
    }
  } else if (_openFlag) {
    // Show overlay shell immediately so main page never flashes
    var _autoOverlay = document.getElementById('checkout-overlay');
    if (_autoOverlay) {
      var _autoHeader = document.querySelector('.header');
      var _autoTop    = _autoHeader ? _autoHeader.getBoundingClientRect().bottom : 64;
      _autoOverlay.style.top      = _autoTop + 'px';
      _autoOverlay.style.transition = 'none';
      _autoOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      history.pushState({ page: 'checkout' }, '', '/checkout');
      setTimeout(function() { _autoOverlay.style.transition = ''; }, 50);
    }
    window._pendingAutoCheckout = true;
  }

  // Save scroll position before unload
  window.addEventListener('beforeunload', function() {
    sessionStorage.setItem('mf_scroll', String(window.scrollY));
  });

  Promise.all([
    fetch(API_BASE + '/categories').then(function(r) { return r.json(); }).catch(function() { return null; }),
    fetch(API_BASE + '/products').then(function(r) { return r.json(); }).catch(function() { return null; }),
  ]).then(function(results) {
    var catData  = results[0];
    var prodData = results[1];

    // Products first so buildSidebar can filter by stock
    if (prodData && prodData.success) {
      products = prodData.data.map(mapApiProduct);
    }

    // Categories → sidebar + mega menu (filtered by stock)
    if (catData && catData.success && catData.data.length) {
      cachedCategories = catData.data;
      buildSidebar(cachedCategories);
      buildMegaMenu(cachedCategories);
    } else {
      initSidebar();
    }

    updateNavVisibility();
    renderGrid();

    // If redirected from product/profile page, open checkout now that products are ready
    if (window._pendingAutoCheckout) {
      window._pendingAutoCheckout = false;
      openCheckout();
    }

    // Restore scroll after render
    var savedScroll = sessionStorage.getItem('mf_scroll');
    if (savedScroll) {
      sessionStorage.removeItem('mf_scroll');
      setTimeout(function() { window.scrollTo({ top: Number(savedScroll), behavior: 'instant' }); }, 80);
    }
  });

  // Re-fetch products when tab becomes visible (e.g. after editing in admin)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      reloadProducts();
      pollPreorderStatus();
    }
  });

  // Also poll every 60 seconds in the background
  setInterval(reloadProducts, 60000);

  // Poll preorder status every 30 seconds
  setInterval(pollPreorderStatus, 30000);

  // Load active preorder if user is logged in
  if (getCurrentUser() && getSession()) {
    loadActivePreorder();
  }
});
