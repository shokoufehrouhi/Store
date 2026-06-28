// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  var wrap = document.getElementById('app-toast');
  if (!wrap) return;
  document.getElementById('app-toast-msg').textContent = msg;
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
var API_BASE           = 'http://localhost:3001/api';
var SERVER_BASE        = 'http://localhost:3001';
var currentLang        = localStorage.getItem('lang') || 'fa';
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

// ─── API Product Mapper ───────────────────────────────────────────────────────
function mapApiProduct(p) {
  var media  = p.product_media || [];
  var images = media.filter(function(m) { return m.type === 'image'; });
  var videos = media.filter(function(m) { return m.type === 'video'; });
  return {
    id:          p.id,
    _fromApi:    true,
    category:    p.categories    ? p.categories.key    : '',
    subcategory: p.subcategories ? p.subcategories.key : null,
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
    price:  Number(p.price)  || 0,
    stock:  p.stock          || 0,
    sales:  Number(p.sales)  || 0,
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

// ─── Cart Persistence ─────────────────────────────────────────────────────────
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartBadge();
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

  // ── Active preorder: show status card instead of items ──────────────────────
  if (currentPreorder && currentPreorder.status !== 'cancelled' && currentPreorder.status !== 'delivered') {
    var order = currentPreorder;
    var st    = order.status;
    var canCancel = (st === 'preorder' || st === 'payment_needed');

    // Status badge HTML
    var statusColors = {
      preorder:        '#3b82f6',
      payment_needed:  '#f59e0b',
      approval_needed: '#eab308',
      preparing:       '#22c55e',
      delivery:        '#8b5cf6',
      delivered:       '#16a34a',
    };
    var statusLabels = {
      preorder:        t.preorder_registered   || 'پیش‌سفارش ثبت شد',
      payment_needed:  t.payment_info_title    || 'اطلاعات پرداخت',
      approval_needed: t.receipt_uploaded      || 'رسید ارسال شد، در انتظار تأیید',
      preparing:       t.preparing_msg         || 'در حال آماده‌سازی',
      delivery:        t.status_delivery        || 'در مسیر ارسال',
      delivered:       t.order_delivered       || 'تحویل داده شد ✓',
    };

    var badgeColor = statusColors[st] || '#6b7280';
    var statusHtml = '<div class="preorder-status-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
      '<span class="order-status-badge" style="background:' + badgeColor + '20;color:' + badgeColor + ';border:1px solid ' + badgeColor + '40;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700">' + (statusLabels[st] || st) + '</span>' +
      '<span style="font-size:12px;color:#888">' + (t.order_id_label || '#') + order.id + '</span>' +
      '</div>';

    // preorder status
    if (st === 'preorder') {
      statusHtml += '<p style="font-size:14px;color:#555;margin-bottom:12px">' + (t.preorder_wait_payment || 'منتظر اطلاعات پرداخت باشید') + '</p>';
    }

    // payment_needed: show bank info + upload form + rejection reason
    if (st === 'payment_needed') {
      if (order.payment_rejection_reason) {
        statusHtml += '<div class="rejection-reason" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:12px;color:#dc2626;font-size:13px">' +
          '<strong>' + (t.payment_rejected || 'پرداخت رد شد') + ':</strong> ' + order.payment_rejection_reason + '</div>';
      }
      statusHtml += '<div class="payment-info-box" style="border-left:4px solid #FF5C00;background:#fff5f0;border-radius:8px;padding:12px 16px;margin-bottom:14px">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:8px">' + (t.payment_info_title || 'اطلاعات پرداخت') + '</div>' +
        (order.iban ? '<div style="font-size:13px;margin-bottom:4px"><span style="color:#888">' + (t.payment_iban || 'شبا') + ': </span><strong style="direction:ltr;display:inline-block">' + order.iban + '</strong></div>' : '') +
        (order.bank_name ? '<div style="font-size:13px;margin-bottom:4px"><span style="color:#888">' + (t.payment_bank || 'بانک') + ': </span>' + order.bank_name + '</div>' : '') +
        (order.account_holder ? '<div style="font-size:13px"><span style="color:#888">' + (t.payment_holder || 'صاحب حساب') + ': </span>' + order.account_holder + '</div>' : '') +
        '</div>' +
        '<div class="receipt-upload-form" style="margin-bottom:12px">' +
        '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + (t.upload_receipt || 'آپلود رسید') + '</div>' +
        '<input type="file" id="receipt-file-input" accept="image/*" style="display:none" onchange="handleReceiptFileChange(this)">' +
        '<button class="cart-order-btn" style="background:#FF5C00;color:#fff;width:100%;margin-bottom:0" onclick="document.getElementById(\'receipt-file-input\').click()">' +
        (t.upload_receipt_btn || 'انتخاب و ارسال رسید') + '</button>' +
        '</div>';
    }

    // approval_needed
    if (st === 'approval_needed') {
      statusHtml += '<p style="font-size:14px;color:#555;margin-bottom:12px">' + (t.receipt_uploaded || 'رسید ارسال شد، در انتظار تأیید...') + '</p>';
      if (order.payment_receipt_url) {
        statusHtml += '<a href="' + SERVER_BASE + order.payment_receipt_url + '" target="_blank" style="font-size:13px;color:#3b82f6;text-decoration:underline;display:block;margin-bottom:10px">مشاهده رسید ارسالی</a>';
      }
    }

    // preparing
    if (st === 'preparing') {
      var maxDays = 0;
      (order.order_items || []).forEach(function(oi) {
        var d = oi.products && oi.products.delivery_days ? Number(oi.products.delivery_days) : 5;
        if (d > maxDays) maxDays = d;
      });
      statusHtml += '<p style="font-size:14px;color:#555;margin-bottom:8px">' + (t.payment_approved || 'پرداخت تأیید شد') + '! ' + (t.preparing_msg || 'سفارش در حال آماده‌سازی') + '.</p>' +
        (maxDays ? '<p style="font-size:13px;color:#888">' + (t.delivery_days_msg || 'زمان تحویل تخمینی') + ': ' + localizeNumber(String(maxDays)) + ' ' + (t.delivery_unit || 'روز کاری') + '</p>' : '');
    }

    // delivery: show carrier/tracking
    if (st === 'delivery') {
      statusHtml += '<div class="tracking-box" style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:12px 16px;margin-bottom:12px">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:8px">سفارش ارسال شد</div>' +
        (order.carrier_name ? '<div style="font-size:13px;margin-bottom:4px"><span style="color:#888">' + (t.carrier_label || 'شرکت پست') + ': </span>' + order.carrier_name + '</div>' : '') +
        (order.tracking_number ? '<div style="font-size:13px"><span style="color:#888">' + (t.tracking_label || 'کد پیگیری') + ': </span><strong style="direction:ltr;display:inline-block">' + order.tracking_number + '</strong></div>' : '') +
        '</div>';
    }

    // delivered
    if (st === 'delivered') {
      statusHtml += '<p style="font-size:15px;color:#16a34a;font-weight:700;margin-bottom:12px">' + (t.order_delivered || 'سفارش تحویل داده شد ✓') + '</p>';
    }

    // cancel button
    if (canCancel) {
      statusHtml += '<button onclick="cancelPreorder()" style="width:100%;padding:10px;border:1.5px solid #ef4444;background:transparent;color:#ef4444;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px">' +
        (t.cancel_preorder || 'لغو پیش‌سفارش') + '</button>';
    }

    statusHtml += '</div>';
    itemsEl.innerHTML = statusHtml;
    footerEl.innerHTML = '<div style="font-size:12px;color:#888;text-align:center;padding:8px">' + (t.preorder_locked || 'سبد خرید قفل شده است') + '</div>';
    return;
  }

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
      (colorName
        ? '<span class="cart-item-meta"><span class="cart-item-color-dot" style="background:' + colorHex + '"></span>' + colorName + '</span>'
        : '') +
      (size ? '<span class="cart-item-meta">' + size + '</span>' : '') +
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

  var totalQty = cart.reduce(function(s, item) { return s + item.qty; }, 0);

  // ── Footer: preorder button (if logged in) or WA/TG buttons ─────────────────
  if (user) {
    footerEl.innerHTML =
      '<div class="cart-total">' + localizeNumber(String(totalQty)) + ' ' + t.cart_item_unit + '</div>' +
      '<div class="cart-order-btns">' +
      '<button class="cart-order-btn" style="background:#FF5C00;color:#fff;width:100%" onclick="registerPreorder()">' +
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
    body: JSON.stringify({ items: items }),
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      currentPreorder = data.data;
      localStorage.setItem('mf_preorder_id', String(data.data.id));
      cart = [];
      saveCart();
      showToast(TRANSLATIONS[currentLang].preorder_registered || 'پیش‌سفارش ثبت شد');
      renderCart();
    } else {
      showToast(data.message || 'خطا در ثبت پیش‌سفارش');
    }
  }).catch(function() {
    showToast('خطا در اتصال به سرور');
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
  }).catch(function() {});
}

function cancelPreorder() {
  var t = TRANSLATIONS[currentLang];
  if (!confirm(t.cancel_confirm || 'آیا مطمئنید؟')) return;
  if (!currentPreorder) return;
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
      showToast(TRANSLATIONS[currentLang].preorder_cancelled || 'پیش‌سفارش لغو شد');
    } else {
      showToast(data.message || 'خطا در لغو سفارش');
    }
  }).catch(function() { showToast('خطا در اتصال به سرور'); });
}

function handleReceiptFileChange(input) {
  var file = input.files && input.files[0];
  if (!file || !currentPreorder) return;
  uploadReceipt(file);
  input.value = '';
}

function uploadReceipt(file) {
  var token = getSession();
  var formData = new FormData();
  formData.append('receipt', file);
  var btn = document.querySelector('.receipt-upload-form button');
  if (btn) { btn.disabled = true; btn.textContent = 'در حال ارسال...'; }

  fetch(API_BASE + '/orders/' + currentPreorder.id + '/receipt', {
    method: 'POST',
    headers: { 'x-session-token': token },
    body: formData,
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.success) {
      currentPreorder = data.data;
      showToast(TRANSLATIONS[currentLang].receipt_uploaded || 'رسید ارسال شد');
      renderCart();
    } else {
      showToast(data.message || 'خطا در ارسال رسید');
      if (btn) { btn.disabled = false; btn.textContent = TRANSLATIONS[currentLang].upload_receipt_btn || 'انتخاب و ارسال رسید'; }
    }
  }).catch(function() {
    showToast('خطا در اتصال به سرور');
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
      renderCart();
    }
  }).catch(function() {});
}

// ─── Quick Add Popup ──────────────────────────────────────────────────────────
function quickAdd(event, productId) {
  event.stopPropagation();
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
        var colorKey  = colorObj.key || Object.keys(COLORS).find(function(k) { return COLORS[k] === colorObj; }) || '';
        var isUnavail = p.unavailableColors && p.unavailableColors.indexOf(colorKey) !== -1;
        return (
          '<button class="color-swatch' + (isUnavail ? ' unavailable' : '') + '" data-color-key="' + colorKey + '"' +
          (isUnavail ? ' data-unavailable="true"' : '') +
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

  document.getElementById('quick-add-popup').innerHTML =
    '<div class="qa-header">' +
    '<div class="qa-product-thumb" style="background:' + p.gradient + '">' + PLACEHOLDER_SVG + '</div>' +
    '<span class="qa-product-name">' + p.name[currentLang] + '</span>' +
    '<button class="qa-close" onclick="closeQuickAdd()">✕</button>' +
    '</div>' +
    colorsHtml +
    sizesHtml +
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
  var nameEl = document.getElementById('qa-color-name');
  if (nameEl) {
    nameEl.textContent = COLORS[_qaColor] ? COLORS[_qaColor].name[currentLang] : '';
    nameEl.style.color = '';
  }
}

function qaSelectSize(chip) {
  if (chip.dataset.unavailable === 'true') return;
  var row = document.getElementById('qa-sizes-row');
  if (row) row.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });
  chip.classList.add('selected');
  _qaSize = chip.dataset.size;
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

// ─── Shared Filter Handler ────────────────────────────────────────────────────
function handleFilterClick(el, scrollToProducts) {
  currentCategory    = el.dataset.filter || 'all';
  currentGender      = el.dataset.gender || 'all';
  currentSubcategory = el.dataset.sub    || null;
  currentColors      = [];
  currentSizes       = [];

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
    var subs        = cat.subcategories || [];
    var catLabel    = lbl(cat);
    var visibleSubs = subs.filter(function(sub) {
      return subcatHasProducts(sub.key, 'all');
    });

    if (visibleSubs.length) {
      html += '<div class="sidebar-group">';
      html += '<a class="sidebar-item has-sub" href="#" data-filter="' + cat.key + '" data-gender="all" data-sub="">';
      html += '<span>' + catLabel + '</span><span class="sidebar-chevron">‹</span>';
      html += '</a>';
      html += '<div class="sidebar-dropdown">';
      visibleSubs.forEach(function(sub) {
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

  var html = '';
  categories.forEach(function(cat) {
    if (!catHasProducts(cat.key, 'all')) return;
    var visibleSubs = (cat.subcategories || []).filter(function(sub) {
      return subcatHasProducts(sub.key, 'all');
    });

    html += '<div class="mega-col" data-cat="' + cat.key + '">';
    html += '<a class="mega-cat-title" href="#products" data-filter="' + cat.key + '" data-gender="all" data-sub="">' + lbl(cat) + '</a>';
    visibleSubs.forEach(function(sub) {
      html += '<a class="mega-sub-item" href="#products" data-filter="' + cat.key + '" data-gender="all" data-sub="' + sub.key + '">' + lbl(sub) + '</a>';
    });
    html += '</div>';
  });

  mega.innerHTML = html;

  mega.addEventListener('click', function(e) {
    var item = e.target.closest('.mega-cat-title, .mega-sub-item');
    if (!item) return;
    e.preventDefault();
    handleFilterClick(item, true);
  });
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

  return (
    '<div class="product-card" data-category="' + p.category + '" onclick="openModal(' + p.id + ')">' +
    '  <div class="product-image" ' + imgStyle + '>' +
    imgInner +
    '    <button class="fav-btn' + (isFav ? ' fav-active' : '') + '" onclick="toggleFavorite(event,' + p.id + ')" title="علاقه‌مندی">♥</button>' +
    tag +
    '  </div>' +
    '  <div class="product-body">' +
    '    <div class="card-badges">' +
    '      <span class="category-badge cat-' + p.category + '">' + cat + '</span>' +
    genderBadge +
    '    </div>' +
    '    <h3 class="product-name">' + name + '</h3>' +
    '    <p class="product-desc">' + desc + '</p>' +
    renderCardSizesColors(p) +
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
    if (p.category !== catKey) return false;
    if (genderFilter && genderFilter !== 'all') {
      if (p.gender !== genderFilter && p.gender !== 'unisex') return false;
    }
    return p.stock > 0;
  });
}

function subcatHasProducts(subKey, genderFilter) {
  if (!subKey) return true;
  return products.some(function(p) {
    if (p.subcategory !== subKey) return false;
    if (genderFilter && genderFilter !== 'all') {
      if (p.gender !== genderFilter && p.gender !== 'unisex') return false;
    }
    return p.stock > 0;
  });
}

function updateNavVisibility() {
  // Hide subcategory items with no stock
  document.querySelectorAll('.nav-drop-item[data-sub]').forEach(function(el) {
    var subKey = el.dataset.sub || '';
    if (!subKey) return;
    var gender = el.dataset.gender || 'all';
    el.style.display = subcatHasProducts(subKey, gender) ? '' : 'none';
  });
  // Hide entire group if category has no stock for that gender
  document.querySelectorAll('.nav-drop-group').forEach(function(group) {
    var catKey = group.dataset.cat || '';
    var gender = group.dataset.gender || 'all';
    group.style.display = catHasProducts(catKey, gender) ? '' : 'none';
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

function renderGrid() {
  var grid = document.getElementById('products-grid');
  var t    = TRANSLATIONS[currentLang];

  var baseList = products.filter(function(p) {
    if (currentCategory !== 'all' && p.category !== currentCategory) return false;
    if (currentGender !== 'all' && p.gender && p.gender !== currentGender) return false;
    return true;
  });

  _filterBaseList = baseList;
  renderFilterBar(baseList);
  var drawer = document.getElementById('filter-drawer');
  if (drawer && drawer.classList.contains('open')) renderFilterDrawerBody(baseList);

  var filteredList = baseList.filter(function(p) {
    if (currentColors.length && !p.colors.some(function(c) { return currentColors.indexOf(c.key) !== -1; })) return false;
    if (currentSizes.length  && !p.sizes.some(function(s)  { return currentSizes.indexOf(s)  !== -1; })) return false;
    return true;
  });

  filteredList = applySort(filteredList);

  // Specific subcategory or all-categories → flat grid
  if (currentSubcategory || currentCategory === 'all') {
    var list = currentSubcategory
      ? filteredList.filter(function(p) { return p.subcategory === currentSubcategory; })
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
    var subProds = filteredList.filter(function(p) { return p.subcategory === subKey; });

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
  localStorage.setItem('lang', lang);

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
  clearAuthErrors();
  updateAuthUI();
  // اگه profile modal باز بود محتوای تب فعلی رو دوباره رندر کن
  if (document.getElementById('profile-modal').classList.contains('open')) {
    var activeTab = document.querySelector('.profile-page-nav-item.active');
    if (activeTab) showProfileTab(activeTab.dataset.tab);
  }
  // اگه fav page باز بود دوباره رندر کن
  if (document.getElementById('fav-page').classList.contains('open')) {
    renderFavPanel();
  }

  // Globe switcher
  var labelEl = document.getElementById('site-lang-label');
  if (labelEl) labelEl.textContent = lang.toUpperCase();
  document.querySelectorAll('.site-lang-opt, .mobile-lang-opt').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  var display = lang === 'fa' ? CONTACT.phoneDisplay : CONTACT.phoneDisplayLatin;
  document.querySelectorAll('.js-phone').forEach(function(el) { el.textContent = display; });

  if (cachedCategories.length) { buildSidebar(cachedCategories); buildMegaMenu(cachedCategories); }

  renderGrid();
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
  window.addEventListener('scroll', function() {
    header.classList.toggle('scrolled', window.scrollY > 60);
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

function openModal(productId) {
  var p = products.find(function(pr) { return pr.id === productId; });
  if (!p) return;

  window._modalProduct       = p;
  window._modalSelectedColor = null;
  window._modalSelectedSize  = null;

  var t         = TRANSLATIONS[currentLang];
  var name      = p.name[currentLang];
  var desc      = p.description[currentLang];
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
        var colorKey  = colorObj.key || Object.keys(COLORS).find(function(k) { return COLORS[k] === colorObj; }) || '';
        var isUnavail = p.unavailableColors && p.unavailableColors.indexOf(colorKey) !== -1;
        return (
          '<button class="color-swatch' + (isUnavail ? ' unavailable' : '') + '" data-color-key="' + colorKey + '"' +
          (isUnavail ? ' data-unavailable="true"' : '') +
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
      '<span class="modal-label">' + t.sizes_label + '</span>' +
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
    '    <div class="modal-main-img" id="modal-main-img" ' + mainImgStyle + '>' +
    mainImgInner +
    '    </div>' +
    '    <div class="modal-thumbs" id="modal-thumbs">' + thumbsHtml + '</div>' +
    '  </div>' +
    '  <div class="modal-info">' +
    '    <div class="card-badges">' +
    '      <span class="category-badge cat-' + p.category + '">' + cat + '</span>' +
    modalGenderBadge +
    '    </div>' +
    '    <h2 class="modal-name">' + name + '</h2>' +
    '    <p class="modal-desc">' + desc + '</p>' +
    colorsHtml +
    sizesHtml +
    '    <div class="modal-buy-section">' +
    '      <button class="modal-add-to-cart" id="modal-add-to-cart" onclick="addToCartFromModal()">🛒 ' + t.add_to_cart + '</button>' +
    '      <div class="modal-divider">' + (currentLang === 'fa' ? 'یا سفارش مستقیم' : currentLang === 'tr' ? 'veya direkt sipariş' : 'or order directly') + '</div>' +
    '      <div class="modal-buy-btns">' +
    '        <a id="modal-wa-btn" href="' + waHref + '" target="_blank" class="modal-btn modal-wa-btn">' + WA_SVG + t.modal_wa_order + '</a>' +
    '        <a id="modal-tg-btn" href="' + tgHref + '" target="_blank" class="modal-btn modal-tg-btn">' + TG_SVG + t.modal_tg_order + '</a>' +
    '      </div>' +
    '      <div class="modal-phone-row">' +
    '        <span class="modal-or-call">' + t.modal_or_call + '</span>' +
    '        <a href="tel:+' + CONTACT.whatsapp + '" class="modal-phone">' + phoneDisp + '</a>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
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

  var colorKey  = swatch.dataset.colorKey;
  var colorName = COLORS[colorKey] ? COLORS[colorKey].name[currentLang] : '';
  var nameEl    = document.getElementById('color-selected-name');
  if (nameEl) {
    nameEl.textContent = colorName;
    nameEl.style.color = '';
  }
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
  if (chip.dataset.unavailable === 'true') return;
  var row = chip.parentElement;
  row.querySelectorAll('.modal-size-chip').forEach(function(c) { c.classList.remove('selected'); });
  chip.classList.add('selected');
  window._modalSelectedSize = chip.dataset.size;
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
function validateMobile(m)   { return /^0[59][0-9]{9}$/.test(m.replace(/[\s\-]/g, '')); }
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
function executePendingCart() {
  if (!_pendingCart) return;
  var pending = _pendingCart;
  _pendingCart = null;
  addToCart(pending.productId, pending.colorKey, pending.size);
}
function showAuthView(view) {
  ['login','signup','forgot','reset'].forEach(function(v) {
    var el = document.getElementById('auth-view-' + v);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  clearAuthErrors();
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
      customer.addresses = customer.addresses || [];
      customer.favorites = customer.favorites || [];
      customer.orders    = customer.orders    || [];
      localStorage.setItem('mf_current_user', JSON.stringify(customer));
      closeAuthModal();
      updateAuthUI();
      renderGrid();
      executePendingCart();
    } else {
      setAuthError('login-id-err', t.err_login_invalid);
    }
  }).catch(function() {
    setAuthError('login-pass-err', t.err_wrong_pass);
  });
}

// ─── Signup ───────────────────────────────────────────────────────────────────
function doSignup() {
  var t          = TRANSLATIONS[currentLang];
  var name       = (document.getElementById('signup-name').value       || '').trim();
  var identifier = (document.getElementById('signup-identifier').value || '').trim();
  var password   =  document.getElementById('signup-password').value   || '';
  var confirm    =  document.getElementById('signup-confirm').value    || '';
  clearAuthErrors();
  if (!name)       { setAuthError('signup-name-err', t.err_name_req); return; }
  if (!identifier) { setAuthError('signup-id-err',   t.err_id_req);   return; }
  var isEmail = identifier.includes('@');
  if (isEmail  && !validateEmail(identifier))  { setAuthError('signup-id-err', t.err_email_inv);  return; }
  if (!isEmail && !validateMobile(identifier)) { setAuthError('signup-id-err', t.err_mobile_inv); return; }
  if (!validatePassword(password)) { setAuthError('signup-pass-err',    t.err_pass_inv);      return; }
  if (password !== confirm)        { setAuthError('signup-confirm-err', t.err_pass_mismatch);  return; }
  var body = {
    name:     name,
    password: password,
    email:    isEmail  ? identifier : undefined,
    mobile:   !isEmail ? identifier : undefined
  };
  fetch(API_BASE + '/customers/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(res) {
    return res.json().then(function(data) { return { status: res.status, data: data }; });
  }).then(function(r) {
    if (r.status === 201 && r.data.success) {
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
    } else if (r.status === 409) {
      setAuthError('signup-id-err', t.err_user_exists);
    } else {
      setAuthError('signup-id-err', r.data.message || t.err_user_exists);
    }
  }).catch(function() {
    setAuthError('signup-id-err', t.err_user_exists);
  });
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────
function doForgot() {
  var t          = TRANSLATIONS[currentLang];
  var identifier = (document.getElementById('forgot-identifier').value || '').trim();
  clearAuthErrors();
  if (!identifier) { setAuthError('forgot-id-err', t.err_id_req); return; }
  var user = getUsers().find(function(u) { return u.email === identifier || u.mobile === identifier; });
  if (!user) { setAuthError('forgot-id-err', t.err_not_found); return; }
  _forgotId = identifier;
  showAuthView('reset');
}

function doReset() {
  var t       = TRANSLATIONS[currentLang];
  var password = document.getElementById('reset-password').value || '';
  var confirm  = document.getElementById('reset-confirm').value  || '';
  clearAuthErrors();
  if (!validatePassword(password)) { setAuthError('reset-pass-err',    t.err_pass_inv);     return; }
  if (password !== confirm)        { setAuthError('reset-confirm-err', t.err_pass_mismatch); return; }
  var users = getUsers();
  var user  = users.find(function(u) { return u.email === _forgotId || u.mobile === _forgotId; });
  if (!user) { setAuthError('reset-pass-err', t.err_reset_fail); return; }
  user.password = hashPass(password);
  updateUser(user);
  var msg = document.getElementById('reset-success-msg');
  if (msg) { msg.textContent = t.msg_reset_ok; }
  setTimeout(function() { showAuthView('login'); }, 2000);
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
  closeProfileModal();
  updateAuthUI();
  updateFavBadge();
  renderGrid();
}

// ─── Auth Header Button ───────────────────────────────────────────────────────
function handleAuthBtnClick() {
  if (getCurrentUser()) openProfileModal();
  else openAuthModal('login');
}

function openFavoritesPanel() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  renderFavPanel();
  document.getElementById('fav-page').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeFavPanel() {
  document.getElementById('fav-page').classList.remove('open');
  document.body.style.overflow = '';
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
        '<div class="fav-panel-thumb" style="background:' + p.gradient + '" onclick="closeFavPanel();openModal(' + p.id + ')">' + PLACEHOLDER_SVG + '</div>' +
        '<div class="fav-panel-info" onclick="closeFavPanel();openModal(' + p.id + ')">' +
        '<span class="fav-panel-name">' + name + '</span>' +
        '<span class="fav-panel-cat">' + (t['cat_' + p.category] || p.category) + '</span>' +
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

function updateAuthUI() {
  var user = getCurrentUser();
  var btn  = document.getElementById('auth-header-btn');
  if (!btn) return;
  if (user) {
    var displayName = user.full_name || user.name || '';
    var firstName   = displayName.split(' ')[0] || displayName;
    var avatarSrc   = user.id ? (localStorage.getItem('mf_avatar_' + user.id) || '') : '';
    if (avatarSrc) {
      btn.innerHTML = '<img class="auth-header-avatar" src="' + avatarSrc + '" alt=""> ' + firstName;
    } else {
      btn.innerHTML = '👤 ' + firstName;
    }
  } else {
    btn.innerHTML = TRANSLATIONS[currentLang].auth_header_btn || '👤 ورود';
  }
}

// ─── Profile Modal ────────────────────────────────────────────────────────────
function openProfileModal() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  document.getElementById('profile-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
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
        u.favorites = getCurrentUser().favorites || [];
        u.orders    = getCurrentUser().orders    || [];
        updateUser(u);
        renderProfileHeader();
        renderInfoTab();
        renderAddresses();
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
      : '👤';
  }
}
function closeProfileModal() {
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
  if (tab === 'info')      renderInfoTab();
  if (tab === 'addresses') renderAddresses();
  if (tab === 'orders')    renderOrders();
  if (tab === 'favorites') renderFavoritesTab();
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
    // Customer ID badge
    (customerId
      ? '<div style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:10px 16px;margin-bottom:20px">' +
        '<span style="font-size:12px;color:#888">' + (currentLang === 'fa' ? 'شناسه مشتری' : currentLang === 'tr' ? 'Müşteri ID' : 'Customer ID') + '</span>' +
        '<span style="font-family:monospace;font-size:18px;font-weight:800;color:var(--primary);letter-spacing:1px">' + customerId + '</span>' +
        '<span style="margin-inline-start:auto;font-size:11px;color:#aaa">' + (currentLang === 'fa' ? 'نوع: ' : 'Via: ') + regByLabel + '</span>' +
        '</div>'
      : '') +

    // Avatar
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
    '<div class="info-avatar-ring">' +
    (src
      ? '<img src="' + src + '" alt="">'
      : '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#4a7fd4" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>') +
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

    // Fields — same structure as address form
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

    '<span class="auth-field-success" id="info-save-success"></span>' +
    '<button id="info-save-btn" class="auth-submit-btn" onclick="saveInfoAll()">' + t.profile_info_save + '</button>';
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
      // crop square from center
      var s = Math.min(img.width, img.height);
      var sx = (img.width  - s) / 2;
      var sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      var resized = canvas.toDataURL('image/jpeg', 0.85);
      var user = getCurrentUser();
      if (!user) return;
      localStorage.setItem('mf_avatar_' + user.id, resized);
      renderProfileHeader();
      renderInfoTab();
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
  renderProfileHeader();
  renderInfoTab();
}

function saveInfoAll() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  if (!user) return;

  var nameInp   = document.getElementById('info-name-input');
  var emailInp  = document.getElementById('info-email-input');
  var mobileInp = document.getElementById('info-mobile-input');
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
  if (user.registered_by !== 'e' && emailVal  && emailVal  !== user.email)  body.email  = emailVal;
  if (user.registered_by !== 'm' && mobileVal && mobileVal !== user.mobile) body.mobile = mobileVal;
  console.log('[saveInfoAll] registered_by:', user.registered_by, '| emailVal:', emailVal, '| user.email:', user.email, '| body:', JSON.stringify(body));

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
      u.full_name    = r.data.data.full_name;
      u.email        = r.data.data.email;
      u.mobile       = r.data.data.mobile;
      if (r.data.data.registered_by) u.registered_by = r.data.data.registered_by;
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
  if (!name)   { setAuthError('addr-name-err',   t2.err_addr_name);   valid = false; }
  if (!phone)  { setAuthError('addr-phone-err',  t2.err_addr_phone);  valid = false; }
  if (!city)   { setAuthError('addr-city-err',   t2.err_addr_city);   valid = false; }
  if (!detail) { setAuthError('addr-detail-err', t2.err_addr_detail); valid = false; }
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
      _renderOrdersList(data.success ? data.data : []);
    }).catch(function() { _renderOrdersList([]); });
  } else {
    _renderOrdersList([]);
  }
}

var _cachedApiOrders  = [];
var _profileExpandedId = null;

function _renderOrdersList(apiOrders) {
  _cachedApiOrders = apiOrders;
  var t   = TRANSLATIONS[currentLang];
  var user = getCurrentUser();
  var container = document.getElementById('profile-tab-orders');
  if (!container) return;
  var localOrders = user ? (user.orders || []) : [];
  var dateLocale = currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-US';
  var nameKey = currentLang === 'fa' ? 'name_fa' : currentLang === 'tr' ? 'name_tr' : 'name_en';

  var ORDER_COLORS = {
    preorder:'#3b82f6', payment_needed:'#f59e0b', approval_needed:'#eab308',
    preparing:'#22c55e', delivery:'#8b5cf6', delivered:'#16a34a', cancelled:'#9ca3af',
  };
  var ORDER_LABELS = {
    preorder:        t.preorder_registered || 'پیش‌سفارش',
    payment_needed:  t.payment_info_title  || 'در انتظار پرداخت',
    approval_needed: t.receipt_uploaded    || 'در انتظار تأیید',
    preparing:       t.preparing_msg       || 'در حال آماده‌سازی',
    delivery:        t.status_delivery      || 'ارسال شده',
    delivered:       t.order_delivered     || 'تحویل شده',
    cancelled:       t.status_cancelled    || 'لغو شده',
  };

  var apiHtml = apiOrders.map(function(order) {
    var st    = order.status;
    var badgeColor = ORDER_COLORS[st] || '#6b7280';
    var badgeLabel = ORDER_LABELS[st] || st;
    var dateStr = new Date(order.created_at).toLocaleDateString(dateLocale);
    var isExpanded = (_profileExpandedId === order.id);

    var itemsHtml = (order.order_items || []).map(function(oi) {
      var pname = oi.products ? (oi.products[nameKey] || oi.products.name_fa || '') : '';
      return '<div class="order-item-row">' +
        '<span>• ' + pname + '</span>' +
        (oi.size_label ? '<span>' + oi.size_label + '</span>' : '') +
        '<span>× ' + oi.qty + '</span>' +
        '</div>';
    }).join('');

    // ─── Detail area (shown when expanded) ──────────────────────────────────
    var detailHtml = '';
    if (isExpanded) {
      detailHtml += '<div class="order-detail-area">';

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
            '<div class="order-payment-row"><span>' + (t.payment_iban || 'شبا') + ':</span><strong style="direction:ltr">' + order.iban + '</strong></div>' +
            (order.bank_name ? '<div class="order-payment-row"><span>' + (t.payment_bank || 'بانک') + ':</span>' + order.bank_name + '</div>' : '') +
            (order.account_holder ? '<div class="order-payment-row"><span>' + (t.payment_holder || 'صاحب حساب') + ':</span>' + order.account_holder + '</div>' : '') +
            '</div>';
        }
        detailHtml += '<div class="order-upload-area">' +
          '<p style="font-size:13px;font-weight:600;margin-bottom:8px">' + (t.upload_receipt || 'آپلود رسید پرداخت') + '</p>' +
          '<input type="file" id="prof-receipt-' + order.id + '" accept="image/*" style="display:none" onchange="profileUploadReceipt(this,' + order.id + ')">' +
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

      if (st === 'delivery') {
        detailHtml += '<div class="order-tracking-box">' +
          (order.carrier_name ? '<div class="order-payment-row"><span>' + (t.carrier_label || 'باربری') + ':</span>' + order.carrier_name + '</div>' : '') +
          (order.tracking_number ? '<div class="order-payment-row"><span>' + (t.tracking_label || 'کد پیگیری') + ':</span><strong style="direction:ltr">' + order.tracking_number + '</strong></div>' : '') +
          '</div>';
      }

      if (st === 'delivered') {
        detailHtml += '<p class="order-detail-hint" style="color:#16a34a;font-weight:700">' + (t.order_delivered || 'تحویل داده شد ✓') + '</p>';
      }

      if (st === 'cancelled') {
        detailHtml += '<p class="order-detail-hint" style="color:#9ca3af">❌ ' + (t.status_cancelled || 'لغو شده') + '</p>';
      }

      detailHtml += '</div>';
    }

    return '<div class="order-card" id="porder-' + order.id + '">' +
      '<div class="order-header order-header--clickable" onclick="toggleProfileOrder(' + order.id + ')">' +
      '<span class="order-id"># ' + order.id + '</span>' +
      '<span style="background:' + badgeColor + '20;color:' + badgeColor + ';border:1px solid ' + badgeColor + '40;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">' + badgeLabel + '</span>' +
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
      '<span class="order-id"># ' + order.id.slice(-6).toUpperCase() + '</span>' +
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

  var combined = apiHtml + localHtml;
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
  container.innerHTML = combined;
}

function toggleProfileOrder(orderId) {
  _profileExpandedId = (_profileExpandedId === orderId) ? null : orderId;
  _renderOrdersList(_cachedApiOrders);
}

function profileCancelOrder(orderId) {
  var t = TRANSLATIONS[currentLang];
  if (!confirm(t.cancel_confirm || 'آیا مطمئنید؟')) return;
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
      }
      showToast(t.preorder_cancelled || 'پیش‌سفارش لغو شد');
      _profileExpandedId = null;
      renderOrders();
    } else {
      showToast(data.message || 'خطا');
    }
  }).catch(function() { showToast('خطا در اتصال'); });
}

function profileUploadReceipt(input, orderId) {
  var file = input.files && input.files[0];
  if (!file) return;
  var t = TRANSLATIONS[currentLang];
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
      }
      showToast(t.receipt_uploaded || 'رسید ارسال شد');
      renderOrders();
    } else {
      showToast(data.message || 'خطا در ارسال رسید');
      if (btn) { btn.disabled = false; btn.textContent = t.upload_receipt_btn || 'ارسال رسید'; }
    }
  }).catch(function() {
    showToast('خطا در اتصال');
    if (btn) { btn.disabled = false; }
  });
  input.value = '';
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
  container.innerHTML =
    '<div class="fav-grid">' +
    favProds.map(function(p) {
      return (
        '<div class="fav-card" onclick="closeProfileModal();openModal(' + p.id + ')">' +
        '<div class="fav-thumb" style="background:' + p.gradient + '">' + PLACEHOLDER_SVG + '</div>' +
        '<span class="fav-name">' + p.name[currentLang] + '</span>' +
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

function reloadProducts() {
  fetch(API_BASE + '/products')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data.success) return;
      var newProducts = data.data.map(mapApiProduct);
      var snapshot = function(list) {
        return JSON.stringify(list.map(function(p) {
          return { id: p.id, delivery_days: p.delivery_days, stock: p.stock, price: p.price, tag: p.tag };
        }));
      };
      if (snapshot(newProducts) !== snapshot(products)) {
        products = newProducts;
        updateNavVisibility();
        renderGrid();
      }
    })
    .catch(function() {});
}

document.addEventListener('DOMContentLoaded', function() {
  fillContactInfo();
  initLangSwitcher();
  initNavDropdowns();
  initHeaderScroll();
  initSmoothScroll();
  initModal();
  applyLang(currentLang);
  updateCartBadge();
  updateAuthUI();
  updateFavBadge();
  initIdleTimer();

  Promise.all([
    fetch(API_BASE + '/categories').then(function(r) { return r.json(); }).catch(function() { return null; }),
    fetch(API_BASE + '/products').then(function(r) { return r.json(); }).catch(function() { return null; }),
  ]).then(function(results) {
    var catData  = results[0];
    var prodData = results[1];

    // Products first so buildSidebar can filter by stock
    if (prodData && prodData.success && prodData.data.length) {
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
