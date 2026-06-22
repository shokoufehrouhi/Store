// ─── State ────────────────────────────────────────────────────────────────────
var currentLang        = localStorage.getItem('lang') || 'fa';
var currentCategory    = 'all';
var currentSubcategory = null;
var currentGender      = 'all';
var cart               = JSON.parse(localStorage.getItem('cart') || '[]');
var _qaProduct = null, _qaColor = null, _qaSize = null;

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

  if (cart.length === 0) {
    itemsEl.innerHTML =
      '<div class="cart-empty">' +
      '<p>' + t.cart_empty + '</p>' +
      '<p class="cart-empty-hint">' + t.cart_empty_hint + '</p>' +
      '</div>';
    footerEl.innerHTML = '';
    return;
  }

  itemsEl.innerHTML = cart.map(function(item, i) {
    var p = products.find(function(pr) { return pr.id === item.id; });
    if (!p) return '';
    var name      = p.name[currentLang];
    var colorHex  = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].hex : '';
    var colorName = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].name[currentLang] : '';
    var size      = item.size ? localizeNumber(item.size) : '';

    return (
      '<div class="cart-item">' +
      '<div class="cart-item-thumb" style="background:' + p.gradient + '"><span>' + p.emoji + '</span></div>' +
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
  footerEl.innerHTML =
    '<div class="cart-total">' + localizeNumber(String(totalQty)) + ' ' + t.cart_item_unit + '</div>' +
    '<div class="cart-order-btns">' +
    '<button class="cart-order-btn cart-order-wa" onclick="sendCartOrder()">' +
    WA_SVG_SMALL + ' ' + t.cart_order_btn +
    '</button>' +
    '<button class="cart-order-btn cart-order-tg" onclick="sendCartOrderTelegram()">' +
    TG_SVG_SMALL + ' ' + t.cart_order_tg_btn +
    '</button>' +
    '</div>';
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
        var colorKey  = Object.keys(COLORS).find(function(k) { return COLORS[k] === colorObj; }) || '';
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
    '<div class="qa-product-thumb" style="background:' + p.gradient + '"><span>' + p.emoji + '</span></div>' +
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

  // active state روی همه filter elements (sidebar + nav)
  var allFilterEls = document.querySelectorAll(
    '.sidebar-item[data-filter], .sidebar-sub-item, .nav-link[data-filter], .nav-drop-item, .mobile-menu a[data-filter]'
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

// ─── Sidebar Navigation ───────────────────────────────────────────────────────
function initSidebar() {
  // آیتم‌هایی که زیرمنو دارند → toggle accordion
  document.querySelectorAll('.sidebar-item.has-sub').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      var group = item.closest('.sidebar-group');
      var isOpen = group.classList.contains('open');
      // بستن همه گروه‌های باز
      document.querySelectorAll('.sidebar-group.open').forEach(function(g) {
        g.classList.remove('open');
      });
      if (!isOpen) group.classList.add('open');
      // فیلتر جنسیت را هم اعمال کن
      handleFilterClick(item, false);
    });
  });

  // آیتم‌های بدون زیرمنو و آیتم‌های زیرمنو
  document.querySelectorAll('.sidebar-item:not(.has-sub), .sidebar-sub-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      handleFilterClick(item, window.innerWidth < 900);
    });
  });
}

// ─── Header Nav Dropdowns ─────────────────────────────────────────────────────
function initNavDropdowns() {
  document.querySelectorAll('.nav-link[data-filter], .nav-drop-item, .mobile-menu a[data-filter]').forEach(function(item) {
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
      var ck = Object.keys(COLORS).find(function(k) { return COLORS[k] === c; }) || '';
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

  return (
    '<div class="product-card" data-category="' + p.category + '" onclick="openModal(' + p.id + ')">' +
    '  <div class="product-image" style="background:' + p.gradient + '">' +
    '    <span class="product-emoji">' + p.emoji + '</span>' +
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
    '    <div class="product-actions">' +
    '      <button class="buy-btn cart-add-btn" onclick="quickAdd(event,' + p.id + ')">' +
    '        🛒 ' + t.add_to_cart +
    '      </button>' +
    '    </div>' +
    '  </div>' +
    '</div>'
  );
}

function renderGrid() {
  var grid = document.getElementById('products-grid');
  var list = products.filter(function(p) {
    if (currentCategory !== 'all' && p.category !== currentCategory) return false;
    if (currentSubcategory && p.subcategory !== currentSubcategory) return false;
    if (currentGender !== 'all' && p.gender && p.gender !== currentGender) return false;
    return true;
  });

  grid.innerHTML = list.length
    ? list.map(renderProduct).join('')
    : '<p class="no-products">' + (TRANSLATIONS[currentLang].no_products || 'محصولی یافت نشد') + '</p>';

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
    var activeTab = document.querySelector('.profile-tab-btn.active');
    if (activeTab) showProfileTab(activeTab.dataset.tab);
  }
  // اگه fav page باز بود دوباره رندر کن
  if (document.getElementById('fav-page').classList.contains('open')) {
    renderFavPanel();
  }

  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  var display = lang === 'fa' ? CONTACT.phoneDisplay : CONTACT.phoneDisplayLatin;
  document.querySelectorAll('.js-phone').forEach(function(el) { el.textContent = display; });

  renderGrid();
  updateCartBadge();
}

function initLangSwitcher() {
  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { applyLang(btn.dataset.lang); });
  });
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
  var variants  = getGradientVariants(p.gradient);

  // thumbnail strip
  var thumbsHtml = variants.map(function(g, i) {
    return (
      '<div class="modal-thumb' + (i === 0 ? ' active' : '') + '"' +
      ' style="background:' + g + '"' +
      ' onclick="switchThumb(this)">' +
      '<span>' + p.emoji + '</span></div>'
    );
  }).join('');

  // color swatches
  var colorsHtml = '';
  if (p.colors && p.colors.length > 0) {
    colorsHtml =
      '<div class="modal-colors-section">' +
      '<span class="modal-label">' + t.color_label + '</span>' +
      '<div class="modal-colors-row">' +
      p.colors.map(function(colorObj) {
        var colorKey  = Object.keys(COLORS).find(function(k) { return COLORS[k] === colorObj; }) || '';
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

  var WA_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  var TG_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

  document.getElementById('modal-panel').innerHTML =
    '<button class="modal-close" onclick="closeModalBtn()">✕</button>' +
    '<div class="modal-body">' +
    '  <div class="modal-gallery">' +
    '    <div class="modal-main-img" id="modal-main-img" style="background:' + variants[0] + '">' +
    '      <span class="modal-big-emoji">' + p.emoji + '</span>' +
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
  document.getElementById('modal-main-img').style.background = thumb.style.background;
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
// AUTH & USER SYSTEM (localStorage-based)
// ═══════════════════════════════════════════════════════════════════════════════

function getUsers()       { return JSON.parse(localStorage.getItem('mf_users') || '[]'); }
function saveUsers(u)     { localStorage.setItem('mf_users', JSON.stringify(u)); }
function getSession()     { return localStorage.getItem('mf_session') || null; }
function setSession(uid)  { uid ? localStorage.setItem('mf_session', uid) : localStorage.removeItem('mf_session'); }

function getCurrentUser() {
  var uid = getSession();
  if (!uid) return null;
  return getUsers().find(function(u) { return u.id === uid; }) || null;
}
function updateUser(user) {
  var users = getUsers();
  var idx = users.findIndex(function(u) { return u.id === user.id; });
  if (idx !== -1) { users[idx] = user; saveUsers(users); }
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
function hashPass(pwd) { return btoa(unescape(encodeURIComponent(pwd))); }

// ─── Validation ───────────────────────────────────────────────────────────────
function validateEmail(e)    { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
function validateMobile(m)   { return /^09[0-9]{9}$/.test(m.replace(/[\s\-]/g, '')); }
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
  var user = getUsers().find(function(u) { return u.email === identifier || u.mobile === identifier; });
  if (!user)                                { setAuthError('login-id-err',   t.err_not_found);  return; }
  if (user.password !== hashPass(password)) { setAuthError('login-pass-err', t.err_wrong_pass); return; }
  setSession(user.id);
  closeAuthModal();
  updateAuthUI();
  renderGrid();
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
  var exists = getUsers().find(function(u) {
    return (isEmail && u.email === identifier) || (!isEmail && u.mobile === identifier);
  });
  if (exists) { setAuthError('signup-id-err', t.err_user_exists); return; }
  var newUser = {
    id: genId(), name: name,
    email:    isEmail  ? identifier : null,
    mobile:   !isEmail ? identifier : null,
    password: hashPass(password),
    addresses: [], favorites: [], orders: []
  };
  var users = getUsers();
  users.push(newUser);
  saveUsers(users);
  setSession(newUser.id);
  closeAuthModal();
  updateAuthUI();
  renderGrid();
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
  setSession(null);
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
    container.innerHTML = '<div class="cart-empty"><p>' + t.profile_no_favs + '</p></div>';
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
        '<div class="fav-panel-thumb" style="background:' + p.gradient + '" onclick="closeFavPanel();openModal(' + p.id + ')"><span>' + p.emoji + '</span></div>' +
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
  btn.textContent = user
    ? '👤 ' + user.name.split(' ')[0]
    : (TRANSLATIONS[currentLang].auth_header_btn || '👤 ورود');
}

// ─── Profile Modal ────────────────────────────────────────────────────────────
function openProfileModal() {
  var user = getCurrentUser();
  if (!user) { openAuthModal('login'); return; }
  document.getElementById('profile-user-name').textContent    = user.name;
  document.getElementById('profile-user-contact').textContent = user.email || user.mobile || '';
  showProfileTab('addresses');
  document.getElementById('profile-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('open');
  document.body.style.overflow = '';
}
function showProfileTab(tab) {
  ['addresses','orders','favorites'].forEach(function(t) {
    var c = document.getElementById('profile-tab-' + t);
    var b = document.querySelector('.profile-page-nav-item[data-tab="' + t + '"]');
    if (c) c.style.display = t === tab ? 'block' : 'none';
    if (b) b.classList.toggle('active', t === tab);
  });
  if (tab === 'addresses') renderAddresses();
  if (tab === 'orders')    renderOrders();
  if (tab === 'favorites') renderFavoritesTab();
}

// ─── Addresses ────────────────────────────────────────────────────────────────
var _editingAddrIdx = -1;

function renderAddresses() {
  var t    = TRANSLATIONS[currentLang];
  var user = getCurrentUser(); if (!user) return;
  var container = document.getElementById('profile-tab-addresses');
  var addrs = user.addresses || [];
  container.innerHTML =
    (addrs.length === 0 ? '<p class="profile-empty">' + t.profile_no_addr + '</p>' :
      addrs.map(function(a, i) {
        return (
          '<div class="address-card" id="addr-card-' + i + '">' +
          '<div class="address-info">' +
          '<strong>' + a.name + '</strong>' +
          '<span>' + a.phone + '</span>' +
          '<span>' + a.city + ' — ' + a.detail + '</span>' +
          (a.postal ? '<span>' + t.addr_postal_label + ': ' + a.postal + '</span>' : '') +
          '</div>' +
          '<div class="address-actions">' +
          '<button class="address-edit-btn" onclick="editAddress(' + i + ')" title="' + t.addr_edit_title + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="address-remove-btn" onclick="removeAddress(' + i + ')" title="' + t.addr_delete_btn + '">✕</button>' +
          '</div>' +
          '</div>'
        );
      }).join('')
    ) +
    '<button class="add-address-btn" id="add-address-btn" onclick="toggleAddressForm(-1)">' + t.profile_add_addr + '</button>' +
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
  if (btn) btn.style.display = isEdit ? 'none' : '';
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
  var entry = { name: name, phone: phone, city: city, postal: postal, detail: detail };
  if (_editingAddrIdx >= 0) {
    user.addresses[_editingAddrIdx] = entry;
  } else {
    user.addresses.push(entry);
  }
  updateUser(user);
  renderAddresses();
}

function removeAddress(i) {
  var user = getCurrentUser();
  user.addresses.splice(i, 1);
  updateUser(user);
  renderAddresses();
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
  var orders = user.orders || [];
  if (!orders.length) { container.innerHTML = '<p class="profile-empty">' + t.profile_no_orders + '</p>'; return; }
  var dateLocale = currentLang === 'fa' ? 'fa-IR' : currentLang === 'tr' ? 'tr-TR' : 'en-US';
  container.innerHTML = orders.map(function(order) {
    var dateStr = order.date;
    try {
      var d = new Date(order.date);
      if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString(dateLocale);
    } catch(e) {}
    return (
      '<div class="order-card">' +
      '<div class="order-header">' +
      '<span class="order-id"># ' + order.id.slice(-6).toUpperCase() + '</span>' +
      '<span class="order-date">' + dateStr + '</span>' +
      '</div>' +
      order.items.map(function(item) {
        var prod      = item.productId ? products.find(function(pr) { return pr.id === item.productId; }) : null;
        var name      = prod ? prod.name[currentLang] : (item.name || '');
        var colorName = item.colorKey && COLORS[item.colorKey] ? COLORS[item.colorKey].name[currentLang] : '';
        return (
          '<div class="order-item-row">' +
          '<span>• ' + name + '</span>' +
          (colorName ? '<span>' + colorName + '</span>' : '') +
          (item.size  ? '<span>' + t.order_size_lbl + item.size + '</span>' : '') +
          '<span>× ' + item.qty + '</span>' +
          '</div>'
        );
      }).join('') +
      '</div>'
    );
  }).join('');
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
  if (!favProds.length) { container.innerHTML = '<p class="profile-empty">' + t.profile_no_favs + '</p>'; return; }
  container.innerHTML =
    '<div class="fav-grid">' +
    favProds.map(function(p) {
      return (
        '<div class="fav-card" onclick="closeProfileModal();openModal(' + p.id + ')">' +
        '<div class="fav-thumb" style="background:' + p.gradient + '"><span>' + p.emoji + '</span></div>' +
        '<span class="fav-name">' + p.name[currentLang] + '</span>' +
        '</div>'
      );
    }).join('') +
    '</div>';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  fillContactInfo();
  initLangSwitcher();
  initSidebar();
  initNavDropdowns();
  initHeaderScroll();
  initSmoothScroll();
  initModal();
  applyLang(currentLang);
  updateCartBadge();
  updateAuthUI();
  updateFavBadge();
});
