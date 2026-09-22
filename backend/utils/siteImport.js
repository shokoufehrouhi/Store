// Per-site product import scrapers, keyed by site name. Every source site has
// its own HTML structure, so there is no generic "works for any site"
// scraper — each site needs its own function here. Called from
// backend/utils/siteSync.js#importSite with a PageManager (`pm`) — a real
// headless-Chrome page that auto-recycles across navigations (these sites
// 403 plain HTTP requests, and a single page eventually crashes across the
// hundreds of navigations a full paginated import can involve).
const fs   = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const { compressImageFile } = require('./compressImage');
const { translateText } = require('./translate');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

// Turkish color name (as it appears in "<Color> Kadın ..." page titles) -> our
// colors.id. Beyond the core palette, our colors table has no exact match
// for several real Defacto shades — those map to the closest available
// color rather than being left uncategorized (confirmed via audit: 67
// products had no color at all because their leading word wasn't in here,
// e.g. "Antrasit Erkek Standart Fit Pantolon").
const TR_COLOR_TO_ID = {
  'siyah': 1, 'beyaz': 2, 'kırmızı': 3, 'kirmizi': 3, 'mavi': 4, 'lacivert': 5,
  'yeşil': 6, 'yesil': 6, 'gri': 7, 'turuncu': 8, 'sarı': 9, 'sari': 9,
  'mor': 10, 'pembe': 11, 'turkuaz': 12, 'kahverengi': 13, 'bej': 17,
  // closest-available approximations, not exact matches:
  'antrasit': 7, 'kahve': 13, 'haki': 6, 'bordo': 3, 'indigo': 5,
  'ekru': 17, 'ekru\'': 17, 'taş': 17, 'tas': 17, 'petrol': 12,
  'vizon': 13, 'somon': 11, 'gümüş': 7, 'gumus': 7, 'altın': 9, 'altin': 9,
};

// Turkish keyword (in the product name) -> our subcategories.id, within
// category_id 1 (Clothing). Falls back to null (no subcategory) if nothing matches.
const TR_KEYWORD_TO_SUBCATEGORY = [
  [/tişört|tshirt|t-shirt/i, 1],
  [/şort|bermuda/i, 2],
  [/pantolon|eşofman altı|jogger/i, 3],
  [/tayt/i, 4],
  [/sweatshirt|hırka|kazak|triko/i, 5],
  [/mont|ceket|yelek|kaban|trençkot|yağmurluk|parka|blazer/i, 6],
];

// Same idea, within category_id 7 (Sports) — the "Fit" listing's own
// subcategory taxonomy differs from regular clothing's.
const TR_KEYWORD_TO_SPORT_SUBCATEGORY = [
  [/tişört|tshirt|t-shirt|polo/i, 26],
  [/şort/i, 27],
  [/\bset\b|takım/i, 28],
  [/tayt|leg\b|pantolon/i, 29],
  [/gömlek|sweatshirt|hırka/i, 30],
  [/eşofman|jogger/i, 31],
  [/ayakkabı|sneaker/i, 32],
  [/şapka|bere/i, 33],
  [/eldiven/i, 34],
  [/mont|yelek|ceket|yağmurluk|parka/i, 35],
  [/atlet|kolsuz|bralet/i, 36],
];

// category_id 10 (Cosmetics). English terms included since some product
// names are partly/fully English (K-beauty brands).
const TR_KEYWORD_TO_COSMETIC_SUBCATEGORY = [
  [/ruj|dudak|lip\b/i, 44],
  [/rimel|göz kalemi|eyeliner|maskara|kaş|eye\b/i, 43],
  [/fondöten|allık|far|kapatıcı|bb krem/i, 42],
  [/oje|tırnak|nail/i, 49],
  [/parfüm|deodorant|koku|perfume/i, 48],
  [/şampuan|saç|conditioner|hair/i, 46],
  [/vücut|body/i, 47],
  [/fırça|sünger|aparat|cihaz|brush|booster cap/i, 50],
  [/serum|krem|maske|tonik|nemlendirici|temizleyici|peeling|esans|mask|cream|cleanser|essence|toner/i, 45],
];

function guessSubcategoryId(nameTr, categoryId = 1) {
  const map = categoryId === 7 ? TR_KEYWORD_TO_SPORT_SUBCATEGORY
    : categoryId === 10 ? TR_KEYWORD_TO_COSMETIC_SUBCATEGORY
    : TR_KEYWORD_TO_SUBCATEGORY;
  const hit = map.find(([re]) => re.test(nameTr));
  return hit ? hit[1] : null;
}

function guessColorId(title) {
  // Page titles always lead with the color regardless of gender segment:
  // "Bej Kadın ...", "Lacivert Erkek ...", "Pembe Kız Çocuk ...".
  // .toLowerCase() alone mangles Turkish İ ("İndigo" -> "i̇ndigo", not
  // "indigo" — the classic Turkish-I problem) and silently missed every
  // "İndigo ..." product's color. toLocaleLowerCase('tr') handles it correctly.
  const firstWord = title.trim().split(' ')[0]?.toLocaleLowerCase('tr');
  return firstWord && TR_COLOR_TO_ID[firstWord] || null;
}

// Madame Coco's own "Renk" variant field is a bare color word/phrase (e.g.
// "Bej", "Açık Gri"), not a title prefix — unlike Defacto's guessColorId
// above. Kozmetik variants use this same field for scent names ("Dark
// Ambre", "Poetic Oud"), which correctly match nothing here and fall back to
// no color, same as an unrecognized Defacto shade would.
function guessColorIdFromWord(text) {
  if (!text) return null;
  const norm = s => s.trim().toLocaleLowerCase('tr');
  const full = norm(text);
  if (TR_COLOR_TO_ID[full]) return TR_COLOR_TO_ID[full];
  for (const w of full.split(/\s+/)) if (TR_COLOR_TO_ID[w]) return TR_COLOR_TO_ID[w];
  return null;
}

// Every product page's <title> leads with "<Color> <Gender...> <Name> <id> |
// DeFacto" regardless of listing (confirmed on kadın/erkek/çocuk *and*
// sports/Fit pages, e.g. "Siyah Kadın Ultra Yumuşak ... Eşofman Altı") — more
// reliable than the listing's own default or the URL slug (which usually
// carries no gender marker at all outside the kids' segment).
function guessGenderFromTitle(title, defaultGender) {
  if (/Kız Çocuk|Kız Bebek|Erkek Çocuk|Erkek Bebek/i.test(title)) return 'kids';
  if (/\bKadın\b/i.test(title)) return 'female';
  if (/\bErkek\b/i.test(title)) return 'male';
  return defaultGender;
}

// Same SHIL#### code scheme as the admin panel's manual "add product" form
// (adminController.js#createProduct) — products created here bypass that
// endpoint (direct prisma.products.create), so it isn't generated for free.
async function generateProductCode() {
  const last = await prisma.products.findFirst({
    where: { code: { startsWith: 'SHIL' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const nextNum = last?.code ? Number(last.code.replace('SHIL', '')) + 1 : 100;
  return 'SHIL' + String(nextNum).padStart(8, '0');
}

async function saveImageFromUrl(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image fetch failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, buf);
  const result = await compressImageFile(filePath);
  const finalName = result.compressed && result.newPath ? path.basename(result.newPath) : filename;
  return '/uploads/' + finalName;
}

async function scrapeDefactoProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  return page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    let name, images = [], originalPrice;
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);
        if (d.image) { name = d.name; images = Array.isArray(d.image) ? d.image : [d.image]; }
        if (d.offers?.price) originalPrice = Number(d.offers.price);
      } catch (e) {}
    }

    let description = '';
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,span'))
      .find(el => el.textContent.trim().toLowerCase() === 'ürün hakkında');
    if (heading) {
      const container = heading.closest('div')?.parentElement || heading.parentElement;
      const items = container.querySelectorAll('li, p');
      if (items.length) description = items[0].textContent.trim();
    }

    const priceText = document.querySelector('.product-detail__price')?.textContent || '';
    const discMatch = priceText.match(/Sepette\s*([\d.,]+)\s*TL/i);
    const discountedPrice = discMatch ? Number(discMatch[1].replace(',', '.')) : null;

    const sizes = window.PRODUCT_DETAIL_SIZE_DATA
      ? window.PRODUCT_DETAIL_SIZE_DATA.map(s => ({ size: s.Size, stock: s.StockQuantity }))
      : [];

    return { name, images, description, originalPrice, discountedPrice, sizes, title: document.title };
  });
}

// Discount listing pages, one per gender/category segment — Defacto has no
// single "all discounted products" page. Kids listing mixes boys'/girls'
// items (disambiguated per-product from the URL slug, see guessGender
// above). "Fit" is the Sports & Tech (SPOR | TEKNİK) segment, its own
// category with its own subcategory taxonomy (see TR_KEYWORD_TO_SPORT_SUBCATEGORY).
const DEFACTO_LISTINGS = [
  { path: 'indirimli-urunler-listesi-kadin',   gender: 'female', categoryId: 1 },
  { path: 'erkek-indirimli-urunler-listesi',   gender: 'male',   categoryId: 1 },
  { path: 'cocuk-bebek-indirimli-urunler',     gender: 'kids',   categoryId: 1 },
  { path: 'app/fit-indirimli-urunler',         gender: 'unisex', categoryId: 7 },
  // Not a discount-only listing like the others (Defacto has no dedicated
  // Kozmetik discount page — confirmed 404 on kozmetik-indirim) — this is
  // the general Korean-skincare category, where full-price and discounted
  // items are mixed together. The post-scrape "actually discounted?" check
  // below (skip if no discountedPrice) filters it down correctly.
  { path: 'kore-cilt-bakim-urunleri',          gender: 'unisex', categoryId: 10 },
];
const MAX_PAGES_PER_LISTING = 8; // Defacto's listings have run ~5 pages in practice; this is a safety cap

async function collectListingLinks(pm, site, listingPath) {
  const links = [];
  let prevPageLinks = null;
  for (let pageNum = 1; pageNum <= MAX_PAGES_PER_LISTING; pageNum++) {
    const url = new URL(listingPath, site.url).href + (pageNum > 1 ? `?page=${pageNum}` : '');
    const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));
    const pageLinks = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => /^\/[a-z0-9-]+-\d{6,8}$/.test(h));
      return [...new Set(hrefs)];
    });
    if (!pageLinks.length) break;
    if (prevPageLinks && pageLinks[0] === prevPageLinks[0]) break; // site clamped to last page, stop
    links.push(...pageLinks);
    prevPageLinks = pageLinks;
  }
  return links;
}

// Site scraper entry point. Returns { imported: [...], skipped: [...] }.
async function Defacto(pm, site, opts = {}) {
  const limit = opts.limit || 30;

  // Collect each listing's links separately, then interleave them (one from
  // women's, one from men's, one from kids', repeat) rather than
  // concatenating — otherwise a single category with enough unclaimed
  // inventory (e.g. women's alone routinely has 100+ items) exhausts the
  // whole `limit` before the other categories are ever reached.
  const metaByUrl = new Map(); // url -> { gender, categoryId }
  const perListing = [];
  for (const listing of DEFACTO_LISTINGS) {
    const hrefs = await collectListingLinks(pm, site, listing.path);
    const urls = [];
    for (const h of hrefs) {
      const url = new URL(h, site.url).href;
      if (!metaByUrl.has(url)) {
        metaByUrl.set(url, { gender: listing.gender, categoryId: listing.categoryId });
        urls.push(url);
      }
    }
    perListing.push(urls);
  }
  const candidateUrls = [];
  for (let i = 0; i < Math.max(...perListing.map(l => l.length), 0); i++) {
    for (const urls of perListing) if (urls[i]) candidateUrls.push(urls[i]);
  }
  const existing = await prisma.products.findMany({
    where: { product_link: { in: candidateUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const newUrls = candidateUrls.filter(u => !existingSet.has(u)).slice(0, limit);

  const imported = [];
  const skipped = candidateUrls.length - newUrls.length;

  for (const url of newUrls) {
    try {
      const data = await scrapeDefactoProduct(pm, url);
      if (!data.name || !data.originalPrice) { continue; }
      // Most listings here are discount-only already, but Kozmetik isn't
      // (Defacto has no dedicated cosmetics discount page) — it mixes
      // full-price items in, and every listing's own "on sale" flag proved
      // unreliable (data-discount="False" even on visibly discounted
      // cards). The one signal that's actually correct: does the product's
      // own page show a live "Sepette X TL" discounted price at all?
      if (!data.discountedPrice) { continue; }
      const meta = metaByUrl.get(url);
      const gender = guessGenderFromTitle(data.title, meta.gender);
      // size_label is VARCHAR(10) — adult sizes (S/M/38/...) fit fine, but
      // kids' items use labels like "5/6 Yaş (116cm)" (15-17 chars), which
      // failed every kids' import outright. Drop the "(116cm)" part first.
      data.sizes = data.sizes.map(s => ({ ...s, size: s.size.split(' (')[0].trim().slice(0, 10) }));

      const priceOriginal = data.originalPrice;
      const priceSite = data.discountedPrice ?? data.originalPrice;
      const discountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;

      // A translation failure (e.g. the free API's daily quota) shouldn't
      // abort the whole import — but silently swallowing it left products
      // with blank name_fa/name_en and no trace of why. Log it instead so
      // it's visible in the sync's console output; backend/scripts/
      // backfillTranslations.js can fill in the gaps afterwards.
      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(data.name, 'fa'),
        translateOrWarn(data.name, 'en'),
        data.description ? translateOrWarn(data.description, 'fa') : '',
        data.description ? translateOrWarn(data.description, 'en') : '',
      ]);
      // name_fa/name_en/name_tr are VARCHAR(120) — machine translation (and
      // some Turkish product names themselves, especially kids' items) can
      // run longer than the source and blow past that, failing the insert.
      const nameTr = data.name.slice(0, 120);
      const nameFa = name_fa.slice(0, 120);
      const nameEn = name_en.slice(0, 120);

      // No cap — some products genuinely have 9+ images on the source and a
      // hardcoded slice(0, 8) was silently dropping the rest.
      const mediaUrls = [];
      for (const imgUrl of data.images) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id: meta.categoryId,
          subcategory_id: guessSubcategoryId(data.name, meta.categoryId),
          gender,
          name_fa: nameFa, name_en: nameEn, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: data.description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: discountedPrice,
          tag: 'discount',
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: guessColorId(data.title) ? { create: [{ color_id: guessColorId(data.title), is_available: true }] } : undefined,
          product_sizes: data.sizes.length ? {
            create: data.sizes.map(s => ({ size_label: s.size, is_available: s.stock > 0 })),
          } : undefined,
        },
      });

      if (data.sizes.length) {
        const colorId = guessColorId(data.title);
        await prisma.product_inventory.createMany({
          data: data.sizes.map(s => ({
            product_id: product.id, color_id: colorId, size_label: s.size,
            quantity: s.stock > 0 ? 10 : 0,
          })),
        });
        const totalQty = data.sizes.filter(s => s.stock > 0).length * 10;
        await prisma.products.update({ where: { id: product.id }, data: { stock: totalQty } });
      }

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  }

  return { imported, skipped };
}

// Home-goods sites (Madame Coco, and now Zara Home) have no clothing-store
// equivalent category in our taxonomy at all — everything here goes under
// the existing Lifestyle category (id 8), split into subcategories that
// mirror Madame Coco's own top-level nav (Yatak Odası, Banyo, ...) plus two
// Zara Home adds (Mobilya, Aydınlatma). Keyed by an arbitrary internal slug,
// not either site's own URL scheme — each site's listing config just picks
// whichever of these keys its category conceptually matches. All are seeded
// unconditionally at the start of every run (see seedLifestyleSubcategories)
// rather than created lazily per matched product — so they show up in admin
// (and can be reviewed/toggled/published) even on a run that imports nothing.
const LIFESTYLE_CATEGORY_ID = 8;
const LIFESTYLE_SUBCATEGORY_DEFS = {
  'yatak-odasi':    { key: 'bedroom',        label_tr: 'Yatak Odası',    label_fa: 'اتاق خواب',               label_en: 'Bedroom' },
  'banyo':          { key: 'bathroom',       label_tr: 'Banyo',          label_fa: 'حمام',                     label_en: 'Bathroom' },
  'mutfak':         { key: 'kitchen',        label_tr: 'Mutfak',         label_fa: 'آشپزخانه',                 label_en: 'Kitchen' },
  'sofra':          { key: 'tableware',      label_tr: 'Sofra',          label_fa: 'سفره و ظروف',              label_en: 'Tableware' },
  'hali-kilim':     { key: 'rugs',           label_tr: 'Halı & Kilim',   label_fa: 'فرش و قالی',               label_en: 'Rugs & Carpets' },
  'dekorasyon':     { key: 'decoration',     label_tr: 'Dekorasyon',     label_fa: 'دکوراسیون',                label_en: 'Decoration' },
  'kozmetik':       { key: 'home_cosmetics', label_tr: 'Kozmetik',       label_fa: 'عطر، شمع و بهداشت خانه',   label_en: 'Home Fragrance & Care' },
  'ev-yasam':       { key: 'home_living',    label_tr: 'Ev & Yaşam',     label_fa: 'خانه و زندگی',             label_en: 'Home & Living' },
  'ceyiz-urunleri': { key: 'trousseau',      label_tr: 'Çeyiz Ürünleri', label_fa: 'جهیزیه',                   label_en: 'Trousseau' },
  'mobilya':        { key: 'furniture',      label_tr: 'Mobilya',        label_fa: 'مبلمان',                   label_en: 'Furniture' },
  'aydinlatma':     { key: 'lighting',       label_tr: 'Aydınlatma',     label_fa: 'روشنایی',                  label_en: 'Lighting' },
};
const lifestyleSubcategoryCache = new Map(); // slug -> subcategory id, memoized for one import run

// Idempotent: findFirst-then-create per slug, safe to call on every sync.
async function seedLifestyleSubcategories() {
  for (const [slug, def] of Object.entries(LIFESTYLE_SUBCATEGORY_DEFS)) {
    if (lifestyleSubcategoryCache.has(slug)) continue;
    let sub = await prisma.subcategories.findFirst({ where: { category_id: LIFESTYLE_CATEGORY_ID, key: def.key } });
    if (!sub) {
      sub = await prisma.subcategories.create({
        data: { category_id: LIFESTYLE_CATEGORY_ID, key: def.key, label_tr: def.label_tr, label_fa: def.label_fa, label_en: def.label_en },
      });
    }
    lifestyleSubcategoryCache.set(slug, sub.id);
  }
}

function getLifestyleSubcategoryId(slug) {
  return lifestyleSubcategoryCache.get(slug) || null;
}

async function scrapeMadameCocoProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  return page.evaluate(() => {
    const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .filter(Boolean);
    const group = ldBlocks.find(d => d['@type'] === 'ProductGroup');
    const breadcrumb = ldBlocks.find(d => d['@type'] === 'BreadcrumbList');
    if (!group) return null;

    // window.dataLayer's GA4 view_item event is the one place this site
    // exposes BOTH the original and current price for the loaded variant
    // (first_price/price) — the JSON-LD offers only ever carry the current
    // price. This pair is the "pprc"/"pmprc" comparison the import is gated
    // on; every other discount signal on this site (the "İndirimli Ürünler"
    // listing tag itself, cart-level "2. ürüne %50" promos) is ignored.
    const viewItem = (window.dataLayer || []).find(d => d.event === 'view_item');
    const item = viewItem?.ecommerce?.items?.[0];
    const firstPrice = item?.first_price != null ? Number(item.first_price) : null;
    const price = item?.price != null ? Number(item.price) : null;

    // The breadcrumb's own @id is a stable URL slug ("/kozmetik/") — more
    // reliable than the visible label text, which has a Turkish-I casing
    // quirk here too ("Kozmeti̇k").
    let categorySlug = null;
    const catCrumb = breadcrumb?.itemListElement?.find(li => li.position === 2);
    if (catCrumb?.item?.['@id']) {
      categorySlug = catCrumb.item['@id'].replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
    }

    const images = [...new Set(group.image || [])];

    let description = '';
    const h2 = Array.from(document.querySelectorAll('h2')).find(e => e.textContent.trim() === 'Ürün Detayı');
    if (h2) {
      let container = h2.parentElement;
      for (let i = 0; i < 6 && container; i++) { if (container.querySelector('p')) break; container = container.parentElement; }
      const p0 = container?.querySelector('p');
      if (p0) {
        const clone = p0.cloneNode(true);
        clone.querySelectorAll('strong').forEach(s => s.remove());
        description = clone.textContent.trim();
      }
    }

    // additionalVariants covers every color/size combo with its own SKU —
    // match the one that's actually loaded via the dataLayer item's id to
    // read its color word and live stock status.
    const variant = (group.additionalVariants || []).find(v => v.sku === item?.item_id);
    const color = variant?.color || null;
    const inStock = variant ? /InStock/i.test(variant.offers?.availability || '') : true;

    return { name: group.name, images, description, firstPrice, price, categorySlug, color, inStock };
  });
}

// Madame Coco's "İndirimli Ürünler" listing has no page=N URL scheme like
// Defacto's listings — it's a scroll-triggered infinite-load grid, so
// candidates are collected by repeatedly scrolling to the bottom and reading
// newly-rendered product links until a few rounds in a row add nothing new.
async function collectMadameCocoListingLinks(pm, site, maxCandidates) {
  const url = new URL('indirimli-urunler/', site.url).href;
  const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  const links = new Set();
  let stableRounds = 0;
  for (let i = 0; i < 60 && stableRounds < 3 && links.size < maxCandidates; i++) {
    const before = links.size;
    const pageLinks = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('img[alt]').forEach(img => {
        const a = img.closest('a');
        const href = a && a.getAttribute('href');
        if (href && href.startsWith('/') && href.split('/').filter(Boolean).length === 1 && (href.match(/-/g) || []).length >= 4) {
          out.add(href);
        }
      });
      return [...out];
    });
    pageLinks.forEach(h => links.add(h));
    stableRounds = links.size === before ? stableRounds + 1 : 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1200));
  }
  return [...links].map(h => new URL(h, site.url).href);
}

// Site scraper entry point. Only the products page's own GA4 first_price/
// price pair (see scrapeMadameCocoProduct) decides "genuinely discounted" —
// per instruction, every other discount signal on this site is disregarded,
// including the "İndirimli Ürünler" listing's own tag (confirmed unreliable:
// it covers ~4100 of the site's ~4200 products, i.e. it's a marketing label,
// not a per-item discount flag). The listing is used only as a source of
// candidate URLs, exactly like Defacto's Kozmetik listing.
async function MadameCoco(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  await seedLifestyleSubcategories();
  const candidateUrls = await collectMadameCocoListingLinks(pm, site, Math.max(limit * 15, 200));

  const existing = await prisma.products.findMany({
    where: { product_link: { in: candidateUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const newUrls = candidateUrls.filter(u => !existingSet.has(u));

  const imported = [];
  let notDiscounted = 0;

  for (const url of newUrls) {
    if (imported.filter(p => !p.error).length >= limit) break;
    try {
      const data = await scrapeMadameCocoProduct(pm, url);
      if (!data || !data.name || data.price == null) continue;
      if (!data.firstPrice || data.firstPrice <= data.price) { notDiscounted++; continue; }

      const subcategoryId = data.categorySlug ? getLifestyleSubcategoryId(data.categorySlug) : null;

      const priceOriginal = data.firstPrice;
      const priceSite = data.price;
      const discountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(data.name, 'fa'),
        translateOrWarn(data.name, 'en'),
        data.description ? translateOrWarn(data.description, 'fa') : '',
        data.description ? translateOrWarn(data.description, 'en') : '',
      ]);
      const nameTr = data.name.slice(0, 120);
      const nameFa = name_fa.slice(0, 120);
      const nameEn = name_en.slice(0, 120);

      const mediaUrls = [];
      for (const imgUrl of data.images) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const colorId = guessColorIdFromWord(data.color);

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id: LIFESTYLE_CATEGORY_ID,
          subcategory_id: subcategoryId,
          gender: 'unisex',
          name_fa: nameFa, name_en: nameEn, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: data.description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: discountedPrice,
          tag: 'discount',
          stock: data.inStock ? 10 : 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorId ? { create: [{ color_id: colorId, is_available: data.inStock }] } : undefined,
        },
      });

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  }

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

// Zara has a genuinely reliable, first-party discount signal — unlike
// Madame Coco's blanket listing tag, a <del> (old price) element only
// renders, on both the listing grid and the product page, when the loaded
// color/size combo is actually marked down. No dataLayer/analytics
// workaround needed; the DOM itself is the source of truth.
function parseTLPrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Hardcoded rather than discovered from the homepage's mega-menu: confirmed
// live that Zara's homepage itself depends on geo-IP resolving the visitor
// to Turkey, and the VPS's hosting IP doesn't — it gets redirected to a
// generic "select your country" splash instead of the real /tr/ homepage,
// so there was never anything to discover from there. These deep sale-page
// URLs were captured once from a working (non-VPS) session; if Zara
// eventually renumbers them, isNotZaraSplash below will say so clearly
// rather than silently returning nothing again.
const ZARA_LISTINGS = [
  // Clothing (Kadın/Erkek/Çocuk) — category_id 1, gender per listing,
  // subcategory guessed from the product name via Defacto's own table.
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/kadin-ezel-fiyatlar-l1314.html',                    gender: 'female' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/erkek-ezel-fiyatlar-l806.html',                     gender: 'male' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/chocuklar-kiz-chocuk-ezel-fiyatlar-l427.html',      gender: 'kids' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/chocuklar-erkek-chocuk-ezel-fiyatlar-l263.html',    gender: 'kids' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/chocuklar-kiz-bebek-ezel-fiyatlar-l152.html',       gender: 'kids' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/chocuklar-erkek-bebek-ezel-fiyatlar-l69.html',      gender: 'kids' },
  { kind: 'clothing', url: 'https://www.zara.com/tr/tr/chocuklar-yenidoan-ezel-fiyatlar-l428.html',        gender: 'kids' },
  // Beauty — no dedicated "Özel Fiyatlar" page exists for it (checked live:
  // neither had it in nav, nor any <del> in a sample listing — no genuine
  // discount right now), so these are just its two real listing pages,
  // included so a future sale is picked up automatically. Maps onto the
  // existing Cosmetics category (id 10), same subcategory table Defacto's
  // own Kozmetik import uses.
  { kind: 'cosmetics', url: 'https://www.zara.com/tr/tr/kadin-guzellik-parfumler-l1415.html' },
  { kind: 'cosmetics', url: 'https://www.zara.com/tr/tr/kadin-beauty-makyaj-l4414.html' },
  // Zara Home — same "no category for this at all" problem as Madame Coco
  // (checked live: no sale page, no <del> in a sample listing either), so
  // reuses that exact Lifestyle-subcategory infrastructure. homeSlug points
  // at a LIFESTYLE_SUBCATEGORY_DEFS key, not Zara's own URL slug.
  { kind: 'home', url: 'https://www.zara.com/tr/tr/home-yatak-odasi-l2087.html',            homeSlug: 'yatak-odasi' },
  { kind: 'home', url: 'https://www.zara.com/tr/tr/home-dekorasyon-l6612.html',             homeSlug: 'dekorasyon' },
  { kind: 'home', url: 'https://www.zara.com/tr/tr/home-oturma-odasi-oda-hali-l2119.html',  homeSlug: 'hali-kilim' },
  { kind: 'home', url: 'https://www.zara.com/tr/tr/home-mobilya-l6181.html',                homeSlug: 'mobilya' },
  { kind: 'home', url: 'https://www.zara.com/tr/tr/home-aydinlatma-l8348.html',             homeSlug: 'aydinlatma' },
];

// last_import_status is VARCHAR(300) — keep thrown messages well under that
// or the status-update itself fails silently and admin sees nothing at all.
function assertNotZaraSplash(page, diag) {
  const isSplash = /select your location/i.test(diag.bodyTextSample) || page.url().replace(/\/+$/, '') === 'https://www.zara.com';
  if (isSplash) {
    throw new Error(`Zara: redirected to country-selector splash (url=${page.url().slice(0, 60)}, title="${diag.title.slice(0, 40)}") — VPS IP likely not geo-resolving as Turkey`);
  }
}

async function collectZaraListingLinks(pm, listingUrl) {
  const page = await pm.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const diag = await page.evaluate(() => ({ title: document.title, bodyTextSample: (document.body.innerText || '').slice(0, 60) }));
  assertNotZaraSplash(page, diag);

  const links = new Set();
  let stableRounds = 0;
  for (let i = 0; i < 20 && stableRounds < 2; i++) {
    const before = links.size;
    const pageLinks = await page.evaluate(() => [...new Set(
      Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => h && /-p\d+\.html/.test(h))
    )]);
    pageLinks.forEach(h => links.add(h));
    stableRounds = links.size === before ? stableRounds + 1 : 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1000));
  }
  return [...links];
}

async function scrapeZaraProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  return page.evaluate(() => {
    const group = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .find(d => d && d['@type'] === 'ProductGroup');
    if (!group) return null;

    const delEl = document.querySelector('del .money-amount__main') || document.querySelector('del');
    const insEl = document.querySelector('.price-current__amount .money-amount__main') || document.querySelector('ins .money-amount__main');

    // The page title always ends "<Name> - <Color>" for whichever
    // color/size the URL's own params loaded — matches hasVariant[].color
    // exactly, which is how the per-size stock for THIS color is isolated
    // (hasVariant spans every color × size combo in the group, not just
    // the one on screen).
    const titleParts = document.title.split(' - ');
    const colorName = titleParts.length > 1 ? titleParts[titleParts.length - 1].split('|')[0].trim() : null;
    const sameColorVariants = (group.hasVariant || []).filter(v => v.color === colorName);

    return {
      name: group.name,
      images: [...new Set(group.image || [])],
      description: group.description || '',
      delText: delEl?.textContent || null,
      insText: insEl?.textContent || null,
      color: colorName,
      sizes: sameColorVariants.map(v => ({
        size: v.size,
        inStock: v.offers?.availability ? !/OutOfStock/i.test(v.offers.availability) : true,
      })),
    };
  });
}

// Site scraper entry point. A product is only imported when its loaded
// variant actually shows a <del> old price — every listing here (including
// the ones for segments with no sale live today) is used purely as a source
// of candidate URLs, same as Defacto's Kozmetik listing.
async function Zara(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  await seedLifestyleSubcategories();

  const metaByUrl = new Map();
  const perListing = [];
  for (const listing of ZARA_LISTINGS) {
    const hrefs = await collectZaraListingLinks(pm, listing.url);
    const urls = [];
    for (const h of hrefs) {
      if (!metaByUrl.has(h)) { metaByUrl.set(h, listing); urls.push(h); }
    }
    perListing.push(urls);
  }
  const candidateUrls = [];
  for (let i = 0; i < Math.max(...perListing.map(l => l.length), 0); i++) {
    for (const urls of perListing) if (urls[i]) candidateUrls.push(urls[i]);
  }

  const existing = await prisma.products.findMany({
    where: { product_link: { in: candidateUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const newUrls = candidateUrls.filter(u => !existingSet.has(u));

  const imported = [];
  let notDiscounted = 0;

  for (const url of newUrls) {
    if (imported.filter(p => !p.error).length >= limit) break;
    try {
      const data = await scrapeZaraProduct(pm, url);
      if (!data || !data.name) continue;
      const originalPrice = parseTLPrice(data.delText);
      const discountedPrice = parseTLPrice(data.insText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; continue; }

      const listingMeta = metaByUrl.get(url) || { kind: 'clothing' };
      let category_id, subcategory_id, gender;
      if (listingMeta.kind === 'cosmetics') {
        category_id = 10;
        subcategory_id = guessSubcategoryId(data.name, 10);
        gender = 'unisex';
      } else if (listingMeta.kind === 'home') {
        category_id = LIFESTYLE_CATEGORY_ID;
        subcategory_id = getLifestyleSubcategoryId(listingMeta.homeSlug);
        gender = 'unisex';
      } else {
        category_id = 1;
        subcategory_id = guessSubcategoryId(data.name, 1);
        gender = listingMeta.gender || 'unisex';
      }
      data.sizes = data.sizes.map(s => ({ ...s, size: (s.size || '').slice(0, 10) }));

      const priceOriginal = originalPrice;
      const priceSite = discountedPrice;
      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(data.name, 'fa'),
        translateOrWarn(data.name, 'en'),
        data.description ? translateOrWarn(data.description, 'fa') : '',
        data.description ? translateOrWarn(data.description, 'en') : '',
      ]);
      const nameTr = data.name.slice(0, 120);
      const nameFa = name_fa.slice(0, 120);
      const nameEn = name_en.slice(0, 120);

      const mediaUrls = [];
      for (const imgUrl of data.images) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const colorId = guessColorIdFromWord(data.color);

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id,
          subcategory_id,
          gender,
          name_fa: nameFa, name_en: nameEn, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: data.description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: finalDiscountedPrice,
          tag: 'discount',
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorId ? { create: [{ color_id: colorId, is_available: true }] } : undefined,
          product_sizes: data.sizes.length ? {
            create: data.sizes.map(s => ({ size_label: s.size, is_available: s.inStock })),
          } : undefined,
        },
      });

      if (data.sizes.length) {
        await prisma.product_inventory.createMany({
          data: data.sizes.map(s => ({
            product_id: product.id, color_id: colorId, size_label: s.size,
            quantity: s.inStock ? 10 : 0,
          })),
        });
        const totalQty = data.sizes.filter(s => s.inStock).length * 10;
        await prisma.products.update({ where: { id: product.id }, data: { stock: totalQty } });
      }

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  }

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

// LC Waikiki, like Zara, has a genuinely reliable first-party discount
// signal: the product-detail price block always renders a
// .product-price__discount-group element, but it's only non-empty (holding
// a .price-in-cart span with the discounted price) when the loaded
// color/SKU is actually marked down — confirmed against both a discounted
// product (899,99 TL -> 699,99 TL) and a full-price one (empty group, just
// a bare .current-price). Unlike Zara this site has no ProductGroup/
// hasVariant JSON-LD bundling every color — each color is its own page/URL
// (like Defacto), so gender/subcategory/color all come from that single
// page the same way Defacto's do.
// Found via /site-haritasi (the human sitemap page — 2216 links, unlike the
// mega-menu's inconsistent per-segment "İndirim" URLs used in an earlier
// pass) rather than by clicking each gender/age flyout separately: it has
// one broad root category per top-nav department (Kadın, Erkek, Çocuk,
// Bebek, Ev & Yaşam, plus the standalone cross-gender Ayakkabı/Aksesuar/
// Kozmetik roots), which is both simpler and full coverage in one shot.
// robots.txt documents (as a Disallow, since it's crawler-facing) a
// "sadece-indirimdekiler=true" query filter — appended here as a mild
// candidate-narrowing optimization, but NOT trusted as the real discount
// gate (confirmed live: only ~1/3 of a filtered listing's cards actually
// have a populated discount-group, so it's imprecise like Madame Coco's own
// "İndirimli Ürünler" tag) — the real gate stays the per-product
// .product-price__discount-group check in LCWaikiki() below.
const LCW_LISTINGS = [
  { url: 'https://www.lcw.com/kadin-t-1?sadece-indirimdekiler=true',       gender: 'female' },
  { url: 'https://www.lcw.com/erkek-t-2?sadece-indirimdekiler=true',       gender: 'male' },
  { url: 'https://www.lcw.com/cocuk-t-3?sadece-indirimdekiler=true',       gender: 'kids' },
  { url: 'https://www.lcw.com/bebek-t-4?sadece-indirimdekiler=true',       gender: 'kids' },
  { url: 'https://www.lcw.com/ev-yasam-t-5?sadece-indirimdekiler=true',    gender: 'unisex' },
  { url: 'https://www.lcw.com/kozmetik-t-6204?sadece-indirimdekiler=true', gender: 'unisex' },
  { url: 'https://www.lcw.com/ayakkabi-u-300032?sadece-indirimdekiler=true', gender: 'unisex' },
  { url: 'https://www.lcw.com/aksesuar-u-300025?sadece-indirimdekiler=true', gender: 'unisex' },
];

// This site is a marketplace, not an LC Waikiki-only storefront (robots.txt
// separately allow-lists other sellers' own store pages — English Home, Joy
// Kitchen, Markastok, Happy Center, Schafer) — a broad root like kadin-t-1
// or ev-yasam-t-5 can include their listings alongside LC Waikiki's own, so
// every product is gated on its own JSON-LD offers.seller.name, confirmed
// "LC Waikiki" even for its in-house sub-labels (LCW Vision, LCW STEPS, LCW
// Kids, LCW ACCESSORIES, LCW HOME, ...) — those are LC Waikiki's own lines,
// not third-party sellers.
const LCW_BRAND_SELLER = 'LC Waikiki';

// The gender/age-segment roots above (kadin-t-1 etc.) are each the WHOLE
// department, not clothing-only — they already include that department's
// own shoes/bags/accessories, which overlap with the dedicated Ayakkabı/
// Aksesuar/Kozmetik roots' own candidates. Routing by listing-of-origin
// would miscategorize whichever of the two listings happened to reach a
// shared URL first, so category_id is instead decided per-product from its
// own JSON-LD "category" breadcrumb (e.g. "Kadın > Kadın Ayakkabı > Kadın
// Ev Ayakkabıları > Kadın Ev Terliği", or "Kişisel Bakım & Kozmetik >
// Kozmetik > Çocuk Parfüm ve Deodorant") — the one signal that's actually
// tied to the specific product rather than to whichever listing found it.
// Ev & Yaşam is checked first and only against the top segment, since a
// home-fragrance item's breadcrumb can otherwise contain "parfüm" too and
// get misrouted into personal-care Cosmetics by the broader keyword check.
function routeLcWaikikiCategory(categoryPath) {
  const path = categoryPath || '';
  const top = path.split('>')[0]?.trim() || '';
  if (/^ev\s*&?\s*yaşam/i.test(top)) return LIFESTYLE_CATEGORY_ID;
  if (/ayakkabı/i.test(path)) return 2; // Shoes
  if (/kozmetik|kişisel bakım|parfüm/i.test(path)) return 10; // Cosmetics
  if (/aksesuar|çanta/i.test(path)) return 3; // Accessories
  return 1; // Clothing (default — also every plain Kadın/Erkek/Çocuk/Bebek garment)
}

// Accessories(3) currently only has one real subcategory in production
// ("bag" / Çantalar, id 13) — anything else under this category is left
// uncategorized, same null-fallback convention as guessSubcategoryId.
function guessLcWaikikiAccessorySubcategoryId(nameTr) {
  return /çanta|canta/i.test(nameTr || '') ? 13 : null;
}

// LC Waikiki's own Ev & Yaşam breadcrumb (2nd segment, e.g. "Yatak Odası
// Tekstili", "Kişisel Bakım Ürünleri") uses different Turkish wording than
// Madame Coco's nav-derived LIFESTYLE_SUBCATEGORY_DEFS slugs, so it's
// matched by keyword here instead of reusing MadameCoco's slug-from-URL
// approach — same defs/ids, just a different route to them.
const LCW_LIFESTYLE_KEYWORD_TO_SLUG = [
  [/yatak\s*odası|nevresim|çarşaf|yorgan|yastık/i, 'yatak-odasi'],
  [/banyo|havlu/i, 'banyo'],
  [/mutfak/i, 'mutfak'],
  [/sofra|fincan|tabak|bardak/i, 'sofra'],
  [/halı|kilim/i, 'hali-kilim'],
  [/dekorasyon|süs/i, 'dekorasyon'],
  [/kişisel bakım|oda kokusu|mum\b/i, 'kozmetik'],
  [/mobilya/i, 'mobilya'],
  [/aydınlatma/i, 'aydinlatma'],
  [/çeyiz/i, 'ceyiz-urunleri'],
];
function guessLcWaikikiLifestyleSubcategoryId(categoryPath) {
  const hit = LCW_LIFESTYLE_KEYWORD_TO_SLUG.find(([re]) => re.test(categoryPath || ''));
  return hit ? getLifestyleSubcategoryId(hit[1]) : null;
}

// Puppeteer's page defaults to an 800x600 viewport, which serves this site's
// mobile layout — one where the size selector isn't an inline row of
// .option-size-box buttons at all, but a "Beden Seç" button that opens a
// bottom sheet (confirmed live: at 800x600 .option-size-box simply doesn't
// exist in the DOM, at 1440x900 it's 7 buttons for the same page). A reload
// after widening fixes it; only actually reloads once per PageManager page
// (viewport persists across navigations on the same page instance).
async function ensureLcWaikikiDesktopViewport(page) {
  const vp = page.viewport();
  if (!vp || vp.width < 1200) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  }
}

async function collectLcWaikikiListingLinks(pm, listingUrl) {
  const page = await pm.goto(listingUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await ensureLcWaikikiDesktopViewport(page);
  await new Promise(r => setTimeout(r, 1500));

  // Scroll-triggered infinite-load grid, same as Madame Coco/Zara — links
  // are accumulated into a running Set on every round rather than read once
  // at the end, since this site's list appears to virtualize (items scrolled
  // far out of view stop showing up in a fresh querySelectorAll pass).
  const links = new Set();
  let stableRounds = 0;
  for (let i = 0; i < 30 && stableRounds < 3; i++) {
    const before = links.size;
    const pageLinks = await page.evaluate(() => [...new Set(
      Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => h && /-o-\d+$/.test(h))
    )]);
    pageLinks.forEach(h => links.add(h));
    stableRounds = links.size === before ? stableRounds + 1 : 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1200));
  }
  return [...links];
}

async function scrapeLcWaikikiProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await ensureLcWaikikiDesktopViewport(page);
  await new Promise(r => setTimeout(r, 1500));

  // The JSON-LD Product's own "description" is generic site-wide marketing
  // boilerplate ("... LCW'de! Hemen online alışveriş yap ..."), not the real
  // product text — that only exists inside a collapsed accordion drawer
  // (a React portal, not present in the DOM until its toggle button is
  // clicked), so it has to be opened first.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button.product-detail-drawer__button'))
      .find(b => b.textContent.includes('Ürün Açıklaması'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  return page.evaluate(() => {
    const prod = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .find(d => d && d['@type'] === 'Product');
    if (!prod) return null;

    const priceContainer = document.querySelector('.product-detail__price-container');
    const originalText = priceContainer?.querySelector('.current-price')?.textContent || null;
    const discountedText = priceContainer?.querySelector('.product-price__discount-group .price-in-cart')?.textContent || null;

    const description = document.querySelector('.product-detail-drawer__content--description')?.textContent.trim() || '';

    // "Renk: Lacivert / W5MY58Z8-CUJ" — same bare-color-word shape as Madame
    // Coco's "Renk" field, just with the SKU appended after a slash.
    const colorText = document.querySelector('.product-detail__color-codes')?.textContent.split('/')[0]?.trim() || null;

    // Sizes with no stock left simply aren't rendered as buttons at all
    // (confirmed on two different products, one with a single size run and
    // one with none out of stock — no disabled/sold-out class exists to
    // check) — so every rendered button is in-stock by construction.
    const sizes = Array.from(document.querySelectorAll('.option-size-box')).map(b => ({
      size: b.getAttribute('data-label') || b.textContent.trim(),
      inStock: true,
    }));

    return {
      name: prod.name,
      images: [...new Set(prod.image || [])],
      description,
      originalText,
      discountedText,
      color: colorText,
      sizes,
      title: document.title,
      seller: prod.offers?.seller?.name || null,
      category: prod.category || null,
    };
  });
}

// Site scraper entry point. A product is only imported when (a) its loaded
// color actually shows a populated .product-price__discount-group, and (b)
// it's actually sold by LC Waikiki itself, not another brand on this
// marketplace — every listing here is used purely as a source of candidate
// URLs, same as Defacto's Kozmetik listing / Zara's no-sale-today segments.
async function LCWaikiki(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  await seedLifestyleSubcategories();

  const metaByUrl = new Map();
  const perListing = [];
  for (const listing of LCW_LISTINGS) {
    const hrefs = await collectLcWaikikiListingLinks(pm, listing.url);
    const urls = [];
    for (const h of hrefs) {
      const url = new URL(h, site.url).href;
      if (!metaByUrl.has(url)) { metaByUrl.set(url, listing); urls.push(url); }
    }
    perListing.push(urls);
  }
  const candidateUrls = [];
  for (let i = 0; i < Math.max(...perListing.map(l => l.length), 0); i++) {
    for (const urls of perListing) if (urls[i]) candidateUrls.push(urls[i]);
  }

  const existing = await prisma.products.findMany({
    where: { product_link: { in: candidateUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const newUrls = candidateUrls.filter(u => !existingSet.has(u));

  const imported = [];
  let notDiscounted = 0;
  let wrongBrand = 0;

  for (const url of newUrls) {
    if (imported.filter(p => !p.error).length >= limit) break;
    try {
      const data = await scrapeLcWaikikiProduct(pm, url);
      if (!data || !data.name) continue;
      if (data.seller !== LCW_BRAND_SELLER) { wrongBrand++; continue; }
      const originalPrice = parseTLPrice(data.originalText);
      const discountedPrice = parseTLPrice(data.discountedText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; continue; }

      const listingMeta = metaByUrl.get(url) || { gender: 'unisex' };
      const gender = guessGenderFromTitle(data.title, listingMeta.gender);
      data.sizes = data.sizes.map(s => ({ ...s, size: (s.size || '').slice(0, 10) }));

      const category_id = routeLcWaikikiCategory(data.category);
      const subcategory_id = category_id === 1 ? guessSubcategoryId(data.name, 1)
        : category_id === 3 ? guessLcWaikikiAccessorySubcategoryId(data.name)
        : category_id === LIFESTYLE_CATEGORY_ID ? guessLcWaikikiLifestyleSubcategoryId(data.category)
        : category_id === 10 ? guessSubcategoryId(data.name, 10)
        : null; // category_id 2 (Shoes) has no subcategories in production yet

      const priceOriginal = originalPrice;
      const priceSite = discountedPrice;
      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(data.name, 'fa'),
        translateOrWarn(data.name, 'en'),
        data.description ? translateOrWarn(data.description, 'fa') : '',
        data.description ? translateOrWarn(data.description, 'en') : '',
      ]);
      const nameTr = data.name.slice(0, 120);
      const nameFa = name_fa.slice(0, 120);
      const nameEn = name_en.slice(0, 120);

      const mediaUrls = [];
      for (const imgUrl of data.images) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const colorId = guessColorIdFromWord(data.color);

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id,
          subcategory_id,
          gender,
          name_fa: nameFa, name_en: nameEn, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: data.description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: finalDiscountedPrice,
          tag: 'discount',
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorId ? { create: [{ color_id: colorId, is_available: true }] } : undefined,
          product_sizes: data.sizes.length ? {
            create: data.sizes.map(s => ({ size_label: s.size, is_available: s.inStock })),
          } : undefined,
        },
      });

      if (data.sizes.length) {
        await prisma.product_inventory.createMany({
          data: data.sizes.map(s => ({
            product_id: product.id, color_id: colorId, size_label: s.size,
            quantity: s.inStock ? 10 : 0,
          })),
        });
        const totalQty = data.sizes.filter(s => s.inStock).length * 10;
        await prisma.products.update({ where: { id: product.id }, data: { stock: totalQty } });
      }

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  }

  return { imported, skipped: notDiscounted + wrongBrand + (candidateUrls.length - newUrls.length) };
}

module.exports = { Defacto, MadameCoco, Zara, LCWaikiki };
