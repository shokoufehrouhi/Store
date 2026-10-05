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
  [/tişört|\btshirt|t-shirt/i, 1],
  [/şort|bermuda/i, 2],
  [/pantolon|eşofman altı|jogger/i, 3],
  [/tayt/i, 4],
  [/sweatshirt|hırka|kazak|triko/i, 5],
  [/mont|ceket|yelek|kaban|trençkot|yağmurluk|parka|blazer/i, 6],
];

// Same idea, within category_id 7 (Sports) — the "Fit" listing's own
// subcategory taxonomy differs from regular clothing's.
const TR_KEYWORD_TO_SPORT_SUBCATEGORY = [
  [/tişört|\btshirt|t-shirt|polo/i, 26],
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

// Every product page's title leads with the color regardless of gender
// segment: "Bej Kadın ...", "Lacivert Erkek ...", "Pembe Kız Çocuk ...".
function extractLeadingColorWord(title) {
  return title.trim().split(' ')[0] || null;
}

// Madame Coco's own "Renk" variant field is a bare color word/phrase (e.g.
// "Bej", "Açık Gri"), not a title prefix. Kozmetik variants use this same
// field for scent names ("Dark Ambre", "Poetic Oud") — those must never
// reach getOrCreateColorId below (it would happily create a fake "color"
// row for a fragrance name), so MadameCoco's own import keeps using this
// old, non-creating, null-on-no-match version rather than the shared one.
function guessColorIdFromWord(text) {
  if (!text) return null;
  const norm = s => s.trim().toLocaleLowerCase('tr');
  const full = norm(text);
  if (TR_COLOR_TO_ID[full]) return TR_COLOR_TO_ID[full];
  for (const w of full.split(/\s+/)) if (TR_COLOR_TO_ID[w]) return TR_COLOR_TO_ID[w];
  return null;
}

// Turkish word/phrase -> ASCII-safe slug for colors.key (VarChar(20), unique).
function slugifyColorKey(word) {
  const trMap = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
  const slug = word.trim().toLocaleLowerCase('tr')
    .split('').map(ch => trMap[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return slug || null;
}

// Memoized per import run — every product in the same run that hits the
// same unrecognized color word reuses the same newly-created row instead of
// re-querying/re-creating it each time.
const colorCreateCache = new Map();

// Every site scraper only ever has a bare Turkish color WORD to work with
// (a title prefix for Defacto, a "Renk"/color-code field for Zara and
// LCWaikiki) — never a hex value — so a shade this site's own products
// don't already cover can't be matched to an *existing* swatch by name
// alone. Previously that meant silently leaving the product uncategorized
// by color (color_id: null); this creates a new colors row instead, with a
// neutral placeholder hex (the real one isn't knowable from a name alone —
// an admin can correct it later in the color's own edit page) so the
// product still gets tagged with *a* color rather than none. NOT used by
// MadameCoco (see guessColorIdFromWord above) — its color field doubles as
// scent names for Kozmetik products, which would otherwise get created as
// fake colors here.
async function getOrCreateColorId(word) {
  if (!word) return null;
  const norm = word.trim().toLocaleLowerCase('tr');
  if (!norm) return null;
  if (TR_COLOR_TO_ID[norm]) return TR_COLOR_TO_ID[norm];
  for (const w of norm.split(/\s+/)) if (TR_COLOR_TO_ID[w]) return TR_COLOR_TO_ID[w];

  if (colorCreateCache.has(norm)) return colorCreateCache.get(norm);
  const key = slugifyColorKey(word);
  if (!key) return null;

  let color = await prisma.colors.findUnique({ where: { key } });
  if (!color) {
    const [name_fa, name_en] = await Promise.all([
      translateText(word, 'tr', 'fa').catch(() => word),
      translateText(word, 'tr', 'en').catch(() => word),
    ]);
    try {
      color = await prisma.colors.create({
        data: {
          key,
          hex: '#CCCCCC',
          name_fa: name_fa.slice(0, 30),
          name_en: name_en.slice(0, 30),
          name_tr: word.trim().slice(0, 30),
        },
      });
    } catch (err) {
      // Another product earlier in this same run's Promise.all batch (or a
      // concurrent import) may have created the same key between the
      // findUnique above and this create — fall back to reading it.
      if (err.code === 'P2002') color = await prisma.colors.findUnique({ where: { key } });
      else throw err;
    }
  }
  colorCreateCache.set(norm, color.id);
  return color.id;
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
//
// Every importer runs 2 products at a time (IMPORT_CONCURRENCY), and two
// calls landing between the same findFirst and create would otherwise both
// get "last + 1" — products.code is unique, so one create would fail. The
// highest number handed out in this process is remembered and never
// reused, even before its product row exists.
let lastIssuedProductCodeNum = 0;
async function generateProductCode() {
  const last = await prisma.products.findFirst({
    where: { code: { startsWith: 'SHIL' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const fromDb = last?.code ? Number(last.code.replace('SHIL', '')) + 1 : 100;
  const nextNum = Math.max(fromDb, lastIssuedProductCodeNum + 1);
  lastIssuedProductCodeNum = nextNum;
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
  let skipped = candidateUrls.length - newUrls.length;

  // IMPORT_CONCURRENCY (2) PageManagers sharing this run's one already-
  // launched browser (separate tabs, not separate browsers) -- same pattern
  // as Lefties. Was 4 until 4 tabs on a second importer (Zara) pushed this
  // VPS's 3.8GB RAM into full swap and crashed the production process
  // mid-import (confirmed live, 2026-09-29). Only raise it after confirming
  // the VPS actually has the headroom, not by assumption.
  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const CONCURRENCY = canParallelize ? IMPORT_CONCURRENCY : 1;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  async function processOne(workerPm, url) {
    try {
      const data = await scrapeDefactoProduct(workerPm, url);
      if (!data.name || !data.originalPrice) { return; }
      // Most listings here are discount-only already, but Kozmetik isn't
      // (Defacto has no dedicated cosmetics discount page) — it mixes
      // full-price items in, and every listing's own "on sale" flag proved
      // unreliable (data-discount="False" even on visibly discounted
      // cards). The one signal that's actually correct: does the product's
      // own page show a live "Sepette X TL" discounted price at all?
      if (!data.discountedPrice) { return; }
      const meta = metaByUrl.get(url);
      const gender = guessGenderFromTitle(data.title, meta.gender);
      // size_label is VARCHAR(10) — adult sizes (S/M/38/...) fit fine, but
      // kids' items use labels like "5/6 Yaş (116cm)" (15-17 chars), which
      // failed every kids' import outright. Drop the "(116cm)" part first.
      data.sizes = data.sizes.map(s => ({ ...s, size: s.size.split(' (')[0].trim().slice(0, 10) }));

      const priceOriginal = data.originalPrice;
      const priceSite = data.discountedPrice ?? data.originalPrice;
      const discountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      // site.markup_percent is applied on top of the source's already-
      // discounted price — with a large enough markup that marked-up price
      // can end up ABOVE the source's original price, which would show
      // customers a "discount" that's actually more expensive than the
      // "original" price on the same page. Never import (or keep visible)
      // something in that state.
      if (discountedPrice > priceOriginal) { skipped++; return; }
      // Markup can also land the marked-up price exactly AT the original
      // price (0% real saving left) — not broken like the > case, so it's
      // still worth importing, just not as a "discount": tag it 'original'
      // instead so it doesn't show up wherever the site filters by
      // tag=discount despite having nothing actually discounted about it.
      const tag = discountedPrice === priceOriginal ? 'original' : 'discount';

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

      const colorId = await getOrCreateColorId(extractLeadingColorWord(data.title));

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
          tag,
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorId ? { create: [{ color_id: colorId, is_available: true }] } : undefined,
          product_sizes: data.sizes.length ? {
            create: data.sizes.map(s => ({ size_label: s.size, is_available: s.stock > 0 })),
          } : undefined,
        },
      });

      if (data.sizes.length) {
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

  await runQueue(newUrls, pms, (workerPm, url) => processOne(workerPm, url));
  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

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

  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const CONCURRENCY = canParallelize ? IMPORT_CONCURRENCY : 1;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  async function processOne(workerPm, url) {
    if (imported.filter(p => !p.error).length >= limit) return;
    try {
      const data = await scrapeMadameCocoProduct(workerPm, url);
      if (!data || !data.name || data.price == null) return;
      if (!data.firstPrice || data.firstPrice <= data.price) { notDiscounted++; return; }

      const subcategoryId = data.categorySlug ? getLifestyleSubcategoryId(data.categorySlug) : null;

      const priceOriginal = data.firstPrice;
      const priceSite = data.price;
      const discountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      // Markup on top of an already-discounted price can push the marked-up
      // price above the source's original price — never import something
      // whose "discount" would show as more expensive than its "original".
      if (discountedPrice > priceOriginal) { notDiscounted++; return; }
      // Landing exactly AT the original price (0% real saving left) isn't
      // broken like the > case, so it's still worth importing — just not
      // tagged 'discount', so it doesn't show up wherever the site filters
      // by tag=discount despite having nothing actually discounted.
      const tag = discountedPrice === priceOriginal ? 'original' : 'discount';

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
          tag,
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

  await runQueue(newUrls, pms, (workerPm, url) => processOne(workerPm, url));
  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

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

// Extracts a bare percent number from text like "−22%", "%68", "22.5%" — a
// site's own stated discount rate, when it has one (see resolveDiscountTag
// below).
function parseDiscountPercent(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Two ways to decide whether site.markup_percent still leaves a product
// worth importing, tried in priority order:
// (a) the site states its own discount rate directly (LCWaikiki's "−22%",
//     Koton's "%68") — trust that over anything derived from raw prices,
//     and require it to be strictly greater than the markup being layered
//     on top: a source discount no bigger than the markup itself isn't a
//     real deal for Shilista even though the raw marked-up price might
//     still happen to land under the original.
// (b) no stated rate available (Defacto/MadameCoco/Zara never show one) —
//     fall back to deriving it from raw prices: reject only if the
//     marked-up price would land AT or ABOVE the original price, same
//     "0% real saving left" nuance as before (tag 'original' rather than
//     an outright reject when it lands exactly at the original).
// Returns null when the product should be skipped, otherwise the tag to
// save it under.
function resolveDiscountTag({ discountPercentText, markupPercent, finalDiscountedPrice, priceOriginal }) {
  const sourcePct = parseDiscountPercent(discountPercentText);
  if (sourcePct != null) {
    return sourcePct > markupPercent ? 'discount' : null;
  }
  if (finalDiscountedPrice > priceOriginal) return null;
  return finalDiscountedPrice === priceOriginal ? 'original' : 'discount';
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
    // schema.org "image" can be a bare string (see Koton/Kiko's same fix) --
    // spreading a string into a Set splits it into single characters.
    const groupImages = Array.isArray(group.image) ? group.image : (group.image ? [group.image] : []);
    // Two different colors can share one display name -- confirmed live
    // 2026-10-01: a jean with two separate "Mavi" shades (color codes 400
    // and 407), so filtering by name alone merged both shades' sizes and
    // every size came out twice, breaking product_sizes' unique (product_id,
    // size_label). The loaded color's 3-digit code is the tail of the main
    // image's file name ("00840355400-p.jpg" -> 400) and the middle part of
    // each variant's sku ("549089409-400-36"); match on that when both are
    // readable, the name only as a fallback.
    const loadedColorCode = String(groupImages[0] || '').match(/\/\d{8}(\d{3})-p\//)?.[1] || null;
    const variantColorCode = v => String(v.sku || '').split('-')[1] || null;
    const isVariantInStock = v => (v.offers?.availability ? !/OutOfStock/i.test(v.offers.availability) : true);
    let sameColorVariants = (group.hasVariant || []).filter(v => v.color === colorName);
    if (loadedColorCode && sameColorVariants.some(v => variantColorCode(v) === loadedColorCode)) {
      sameColorVariants = sameColorVariants.filter(v => variantColorCode(v) === loadedColorCode);
    }
    // Colorless one-size items (perfumes -- confirmed live 2026-10-03): the
    // title has no " - <Color>" part and the only variant is color "",
    // size "STANDART", so nothing above matched and the product was saved
    // with no sizes AND a hardcoded stock of 0 even while in stock. Read
    // their availability as a whole-product flag instead of a fake size.
    let oneSizeInStock = null;
    if (!colorName) {
      const plain = (group.hasVariant || []).filter(v => !v.color);
      if (plain.length && plain.every(v => !v.size || /^standart$/i.test(String(v.size).trim()))) {
        oneSizeInStock = plain.some(isVariantInStock);
      } else {
        sameColorVariants = plain;
      }
    }
    const sizeByLabel = new Map();
    for (const v of sameColorVariants) {
      const inStock = isVariantInStock(v);
      // "EU 36 (US 29)" (jeans) doesn't fit product_sizes.size_label's
      // VarChar(10) -- it used to be cut to "EU 36 (US " -- keep the EU size.
      const label = String(v.size || '').replace(/^EU\s+(\S+)\s*\(US[^)]*\)$/, '$1');
      sizeByLabel.set(label, (sizeByLabel.get(label) || false) || inStock);
    }

    return {
      name: group.name,
      images: [...new Set(groupImages)],
      description: group.description || '',
      delText: delEl?.textContent || null,
      insText: insEl?.textContent || null,
      color: colorName,
      sizes: [...sizeByLabel].map(([size, inStock]) => ({ size, inStock })),
      oneSizeInStock,
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

  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const CONCURRENCY = canParallelize ? IMPORT_CONCURRENCY : 1;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  async function processOne(workerPm, url) {
    if (imported.filter(p => !p.error).length >= limit) return;
    try {
      const data = await scrapeZaraProduct(workerPm, url);
      if (!data || !data.name) return;
      const originalPrice = parseTLPrice(data.delText);
      const discountedPrice = parseTLPrice(data.insText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; return; }

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
      // Markup on top of an already-discounted price can push the marked-up
      // price above the source's original price — never import something
      // whose "discount" would show as more expensive than its "original".
      if (finalDiscountedPrice > priceOriginal) { notDiscounted++; return; }
      // Landing exactly AT the original price (0% real saving left) isn't
      // broken like the > case, so it's still worth importing — just not
      // tagged 'discount', so it doesn't show up wherever the site filters
      // by tag=discount despite having nothing actually discounted.
      const tag = finalDiscountedPrice === priceOriginal ? 'original' : 'discount';

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

      const colorId = await getOrCreateColorId(data.color);

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
          tag,
          // Sized products get their total from inventory just below; a
          // colorless one-size item (perfume) has no inventory rows at all.
          stock: data.sizes.length ? 0 : (data.oneSizeInStock ? 10 : 0),
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

  await runQueue(newUrls, pms, (workerPm, url) => processOne(workerPm, url));
  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

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
//
// waitUntil is 'domcontentloaded', not 'networkidle2', for the same reason
// Zara uses it (see collectZaraListingLinks): this site keeps a steady drip
// of analytics/tracking calls that can keep the network from ever going
// idle. That alone wasn't enough on the VPS though — navigation was still
// timing out there (never locally) even with domcontentloaded, while a
// plain curl to the same URL from that same VPS came back in ~1s. So it
// isn't network reachability — it's headless Chrome itself taking too long
// to get through this page's real payload: dozens of tracker/personalization
// requests (GTM, sgtm.lcw.com, useinsider.com, Google Ads pixels, ...) that
// this scraper never reads anything from, competing for the VPS's more
// limited CPU. Aborting them (plus images/fonts/media, also never read)
// via request interception is what actually fixed it.
async function ensureLcWaikikiPageSetup(page) {
  if (!page.__lcwRequestBlockingSetup) {
    page.__lcwRequestBlockingSetup = true;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();
      const isHeavyAsset = type === 'image' || type === 'font' || type === 'media';
      const isTracker = /googlesyndication|google-analytics|googletagmanager|doubleclick|useinsider\.com|sgtm\.lcw\.com|mindbehind|facebook\.com\/tr|clarity\.ms|hotjar/i.test(url);
      if (isHeavyAsset || isTracker) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
  }

  const vp = page.viewport();
  if (!vp || vp.width < 1200) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
}

async function collectLcWaikikiListingLinks(pm, listingUrl) {
  const page = await pm.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureLcWaikikiPageSetup(page);
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
  const page = await pm.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureLcWaikikiPageSetup(page);
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
    // LCW's own stated discount rate (e.g. "−22%") — preferred over deriving
    // one from raw prices when it's available, see discountPctGate below.
    const discountPercentText = priceContainer?.querySelector('.discount-rate-container__value')?.textContent || null;

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
      // schema.org's "image" is documented as either a single URL string or
      // an array of them — confirmed live on Kiko (2026-09-24) that some
      // products genuinely use the bare-string form (e.g. "LIPS & NAILS
      // COMBO- APRICOT NUDE SET"). The old `[...new Set(prod.image || [])]`
      // silently spread a bare string into one "image" per character
      // (Sets iterate strings char-by-char), so every image download for
      // that product failed with an invalid-URL error, caught per-image,
      // leaving the product with zero images and no visible error anywhere.
      images: [...new Set(Array.isArray(prod.image) ? prod.image : (prod.image ? [prod.image] : []))],
      description,
      originalText,
      discountedText,
      discountPercentText,
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

  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const CONCURRENCY = canParallelize ? IMPORT_CONCURRENCY : 1;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  async function processOne(workerPm, url) {
    if (imported.filter(p => !p.error).length >= limit) return;
    try {
      const data = await scrapeLcWaikikiProduct(workerPm, url);
      if (!data || !data.name) return;
      if (data.seller !== LCW_BRAND_SELLER) { wrongBrand++; return; }
      const originalPrice = parseTLPrice(data.originalText);
      const discountedPrice = parseTLPrice(data.discountedText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; return; }

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
      const tag = resolveDiscountTag({
        discountPercentText: data.discountPercentText,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; return; }

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

      const colorId = await getOrCreateColorId(data.color);

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
          tag,
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

  await runQueue(newUrls, pms, (workerPm, url) => processOne(workerPm, url));
  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

  return { imported, skipped: notDiscounted + wrongBrand + (candidateUrls.length - newUrls.length) };
}

// Koton — single-brand store (JSON-LD offers.brand confirmed "Koton" on
// every product checked; no marketplace risk like LCWaikiki, so no seller
// gate needed). Discount signal is a populated .price__retail element next
// to .price__price — same "only renders when genuinely marked down"
// pattern as Zara's <del> and LCWaikiki's discount-group.
//
// /70e-varan-fiyat-indirimli-urunler/ is the real, comprehensive discount
// listing (confirmed live: 10,190 products, ~80% of individually-sampled
// cards genuinely discounted) — it replaced an earlier version of this
// scraper that used the plain kadin/erkek/cocuk/bebek department roots,
// each the WHOLE unfiltered department (e.g. kadin-elbise-kampanyasi/,
// despite its name, is just the full 1,911-item dress category with no
// discount filter at all), which only ever reached ~10% hit rate and, at
// the default limit=30, never sampled deep enough to visit most genuine
// discounts at all.
//
// But 70e-varan isn't grouped by category — at limit=30 the scrape loop
// stops after roughly the first ~40-50 (30 / ~80% hit rate) candidates in
// whatever order the site returns them, which turned out to systematically
// under-represent categories that aren't near the front of that order
// (confirmed live: specific 50-71%-off dresses the user pointed out never
// got reached). The *-kampanyasi pages are individually lower hit rate
// (~60%, since they're really just "category, discounts included" rather
// than discount-only) but each guarantees SOME budget lands on that
// specific category every run, via the same round-robin interleave already
// used for every other multi-listing scraper here. Gender still comes from
// each product's own breadcrumb (see guessKotonGender below), not from
// which listing found it, so mixing department-scoped and cross-department
// listings here is fine.
const KOTON_LISTINGS = [
  { url: 'https://www.koton.com/70e-varan-fiyat-indirimli-urunler/', gender: 'unisex' },
  { url: 'https://www.koton.com/kadin-elbise-kampanyasi/',           gender: 'female' },
  { url: 'https://www.koton.com/kadin-etek-kampanyasi/',             gender: 'female' },
  { url: 'https://www.koton.com/kadin-kampanyali-tisort/',           gender: 'female' },
  { url: 'https://www.koton.com/kadin-kampanyali-bluz/',             gender: 'female' },
  { url: 'https://www.koton.com/erkek-kampanyali-kot-pantolon/',     gender: 'male' },
  { url: 'https://www.koton.com/erkek-kampanyali-polo-tisort/',      gender: 'male' },
];
const KOTON_MAX_PAGES_PER_LISTING = 8;

// This site is tracker-heavy (Microsoft Clarity, useinsider.com — the same
// platform LCWaikiki uses, Google Analytics, all confirmed live on a
// product page) — set up proactively this time instead of discovering it
// the hard way after a VPS-only navigation timeout (see the LCWaikiki
// import's own history for exactly that sequence of events).
async function ensureKotonPageSetup(page) {
  if (page.__kotonRequestBlockingSetup) return;
  page.__kotonRequestBlockingSetup = true;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const url = req.url();
    const isHeavyAsset = type === 'image' || type === 'font' || type === 'media';
    const isTracker = /clarity\.ms|useinsider\.com|analytics\.google\.com|googletagmanager|googlesyndication|doubleclick|facebook\.com\/tr|hotjar/i.test(url);
    if (isHeavyAsset || isTracker) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

// Pagination looks like a plain ?page=N query param (the "Sonraki" link's
// own href), but a fresh navigation straight to that URL doesn't work —
// confirmed live: page.goto()-ing directly to kadin/?page=1 came back with
// the exact same 45 products as page 0, not a second page. This is a
// client-routed SPA — the URL only actually advances when the "Sonraki"
// link is clicked in-page (history.pushState + its own data fetch), so
// pagination happens by clicking within one continuous page session rather
// than by navigating to each page's URL like Defacto's own ?page=N does.
async function collectKotonListingLinks(pm, listingUrl) {
  const page = await pm.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKotonPageSetup(page);
  await new Promise(r => setTimeout(r, 1500));

  const links = new Set();
  for (let i = 0; i < KOTON_MAX_PAGES_PER_LISTING; i++) {
    const pageLinks = await page.evaluate(() => [...new Set(
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href').split('?')[0])
        .filter(h => h && /-\d{6,}(-\d+)?\/?$/.test(h))
    )]);
    pageLinks.forEach(h => links.add(h));

    const clicked = await page.evaluate(() => {
      const a = document.querySelector('a.pz-pagination-link.-next')
        || Array.from(document.querySelectorAll('a.pz-pagination-link')).find(el => /sonraki/i.test(el.textContent));
      if (a) { a.click(); return true; }
      return false;
    });
    if (!clicked) break;
    await new Promise(r => setTimeout(r, 2500));
  }
  return [...links];
}

async function scrapeKotonProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKotonPageSetup(page);
  await new Promise(r => setTimeout(r, 1500));
  // <pz-price> is a custom element that populates its own text via JS after
  // load — a fixed sleep long enough locally wasn't long enough on the
  // VPS's slower CPU (confirmed: a real run there imported 3 of 85
  // candidates, everything else read as "not discounted" because neither
  // price element had actually rendered yet when read). Poll for it
  // instead of guessing a bigger fixed number; swallow a timeout rather
  // than aborting the scrape — the evaluate below still runs and correctly
  // treats a genuinely-still-empty price as not-discounted either way.
  await page.waitForFunction(
    () => (document.querySelector('.price__price pz-price')?.textContent || '').trim().length > 0,
    { timeout: 8000 }
  ).catch(() => {});

  return page.evaluate(() => {
    const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .filter(Boolean);
    const prod = ldBlocks.find(d => d['@type'] === 'Product');
    if (!prod) return null;

    // Breadcrumb (e.g. "Anasayfa > Erkek > Giyim > Pantolon > <name>") is
    // the one per-product signal for both gender and department section —
    // more reliable than which listing surfaced the URL, same reasoning as
    // LCWaikiki's routeLcWaikikiCategory.
    const bc = ldBlocks.find(d => d['@type'] === 'BreadcrumbList');
    const breadcrumbNames = (bc?.itemListElement || []).map(li => li.name).filter(Boolean);

    const originalText = document.querySelector('.price__retail pz-price')?.textContent || null;
    const discountedText = document.querySelector('.price__price pz-price')?.textContent || null;
    // Koton's own stated discount rate (e.g. "%68") — preferred over
    // deriving one from raw prices when it's available, see
    // resolveDiscountTag.
    const discountPercentText = document.querySelector('.price__discount')?.textContent || null;

    // The real description sits in a plain <p> inside .product-info__details
    // (no click-to-expand needed, unlike LCWaikiki's drawer) — JSON-LD's own
    // "description" is generic marketing boilerplate, same trap as LCWaikiki.
    const detailsEl = document.querySelector('.product-info__details');
    const descP = detailsEl
      ? Array.from(detailsEl.querySelectorAll('p')).find(p => p.textContent.trim().length > 50)
      : null;
    const description = descP ? descP.textContent.trim() : '';

    const colorText = document.querySelector('.product-attributes-color.js-product-color-text')
      ?.textContent.split(':')[1]?.trim() || null;

    // Every size this color/product was ever offered in shows here — an
    // out-of-stock one just carries a -disabled modifier class instead of
    // being omitted from the DOM (unlike LCWaikiki, where out-of-stock
    // sizes simply don't render at all).
    //
    // Jeans have a second group ("Boy Seç", length — data-key
    // integration_secondary_size_id) next to the usual one ("Beden Seç",
    // data-key integration_size_id). Reading both as one flat list stored
    // the length as if it were a size, and a waist equal to a length (32
    // and 32) broke product_sizes' unique (product_id, size_label) — hit
    // live 2026-09-30 on a Koton baggy jean. Waist x length becomes
    // "28/32", and only in-stock combinations are kept (same choice the
    // user made for Mavi's jeans).
    const readOpts = (key) => Array.from(document.querySelectorAll(`.variant__option.js-variant-option[data-key="${key}"]`)).map(o => ({
      size: o.textContent.trim().split('\n')[0].trim(),
      inStock: !o.classList.contains('-disabled'),
    }));
    const primary = readOpts('integration_size_id');
    const lengths = readOpts('integration_secondary_size_id');
    let sizes = primary.length ? primary : Array.from(document.querySelectorAll('.variant__option.js-variant-option')).map(o => ({
      size: o.textContent.trim().split('\n')[0].trim(),
      inStock: !o.classList.contains('-disabled'),
    }));
    if (primary.length && lengths.length) {
      sizes = primary.flatMap(w => lengths.map(l => ({ size: `${w.size}/${l.size}`, inStock: w.inStock && l.inStock })))
        .filter(s => s.inStock);
    }
    const byLabel = new Map();
    for (const s of sizes) byLabel.set(s.size, (byLabel.get(s.size) || false) || s.inStock);
    sizes = [...byLabel].map(([size, inStock]) => ({ size, inStock }));

    return {
      name: prod.name,
      // schema.org's "image" is documented as either a single URL string or
      // an array of them — confirmed live on Kiko (2026-09-24) that some
      // products genuinely use the bare-string form (e.g. "LIPS & NAILS
      // COMBO- APRICOT NUDE SET"). The old `[...new Set(prod.image || [])]`
      // silently spread a bare string into one "image" per character
      // (Sets iterate strings char-by-char), so every image download for
      // that product failed with an invalid-URL error, caught per-image,
      // leaving the product with zero images and no visible error anywhere.
      images: [...new Set(Array.isArray(prod.image) ? prod.image : (prod.image ? [prod.image] : []))],
      description,
      originalText,
      discountedText,
      discountPercentText,
      color: colorText,
      sizes,
      breadcrumbNames,
    };
  });
}

// Koton has no home-goods/Lifestyle department at all (confirmed via its
// own category sitemap — only Kadın/Erkek/Çocuk/Bebek roots exist), so
// routing only ever needs to pick between Clothing/Shoes/Accessories/
// Cosmetics, checked against the full breadcrumb text same as LCWaikiki.
function routeKotonCategory(breadcrumbNames) {
  const joined = (breadcrumbNames || []).join(' > ');
  if (/ayakkabı|bot\b|sandalet|terlik/i.test(joined)) return 2; // Shoes
  if (/kozmetik|parfüm/i.test(joined)) return 10; // Cosmetics
  if (/aksesuar|çanta|kemer|cüzdan|küpe|yüzük|takı|şapka|bere/i.test(joined)) return 3; // Accessories
  return 1; // Clothing (default)
}
function guessKotonAccessorySubcategoryId(nameTr) {
  return /çanta|canta/i.test(nameTr || '') ? 13 : null;
}

function guessKotonGender(breadcrumbNames, defaultGender) {
  const dept = (breadcrumbNames || [])[1] || '';
  if (/bebek/i.test(dept)) return 'kids';
  if (/çocuk/i.test(dept)) return 'kids';
  if (/kadın/i.test(dept)) return 'female';
  if (/erkek/i.test(dept)) return 'male';
  return defaultGender;
}

// Site scraper entry point. A product is only imported when its loaded
// color actually shows a populated .price__retail — every listing here is
// used purely as a source of candidate URLs, same as every other scraper.
async function Koton(pm, site, opts = {}) {
  const limit = opts.limit || 30;

  const metaByUrl = new Map();
  const perListing = [];
  for (const listing of KOTON_LISTINGS) {
    const hrefs = await collectKotonListingLinks(pm, listing.url);
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

  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const CONCURRENCY = canParallelize ? IMPORT_CONCURRENCY : 1;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  async function processOne(workerPm, url) {
    if (imported.filter(p => !p.error).length >= limit) return;
    try {
      const data = await scrapeKotonProduct(workerPm, url);
      if (!data || !data.name) return;
      const originalPrice = parseTLPrice(data.originalText);
      const discountedPrice = parseTLPrice(data.discountedText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; return; }

      const listingMeta = metaByUrl.get(url) || { gender: 'unisex' };
      const gender = guessKotonGender(data.breadcrumbNames, listingMeta.gender);
      data.sizes = data.sizes.map(s => ({ ...s, size: (s.size || '').slice(0, 10) }));

      const priceOriginal = originalPrice;
      const priceSite = discountedPrice;
      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      const tag = resolveDiscountTag({
        discountPercentText: data.discountPercentText,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; return; }

      const category_id = routeKotonCategory(data.breadcrumbNames);
      const subcategory_id = category_id === 1 ? guessSubcategoryId(data.name, 1)
        : category_id === 3 ? guessKotonAccessorySubcategoryId(data.name)
        : category_id === 10 ? guessSubcategoryId(data.name, 10)
        : null; // category_id 2 (Shoes) has no subcategories in production yet

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

      const colorId = await getOrCreateColorId(data.color);

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
          tag,
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

  await runQueue(newUrls, pms, (workerPm, url) => processOne(workerPm, url));
  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

// Kiko is an Akinon-platform cosmetics-only storefront (same `pz-` custom
// element family as Koton, confirmed live — different vendor, same JS-
// hydration timing quirks). Most cards on any of its listings carry only a
// marketing badge ("1 alana 1 hediye", "2. ürüne %50") with no real price
// cut, so the per-card `pz-price.-retail` element (the old, struck-through
// price) is what actually finds genuine discounts, not the page's own
// framing (same lesson as Zara/LCWaikiki/Koton's own gates). Pagination is
// `<pz-pagination type="infinite" per-page="20">` — confirmed live that a
// programmatic scrollTo()/scrollIntoView() never triggers its loader at all
// (stuck at the first 20 items); only a real page.mouse.wheel() does, and
// even then the DOM is a virtualized ~20-item window, not an ever-growing
// list, so every round's cards must be read and kept rather than trusting
// final DOM size.
//
// The one all-products campaign page (/kampanyali-urunler/, 2216 items) was
// the first design here — confirmed live it's a real bug, not just
// theoretical: a real sync run against it found only 2 candidates, even
// though /makyaj-seti/ alone (one of the listings below) visibly has
// several genuine discounts sitting right on its first page — a bounded
// scroll through the huge undifferentiated list just never reaches every
// category, same "single listing hits quota before reaching some
// categories" failure mode as Koton's own history. These are Kiko's own
// nav-menu section pages instead (each much smaller, 24-656 total vs 2216),
// scraped separately and interleaved round-robin so one big listing can't
// crowd out a small one before the run's overall `limit` is reached.
const KIKO_LISTINGS = [
  'https://www.kikomilano.com.tr/dudak-makyaji/',
  'https://www.kikomilano.com.tr/goz-makyaji/',
  'https://www.kikomilano.com.tr/yuz-makyaji/',
  'https://www.kikomilano.com.tr/tirnak-urunleri/',
  'https://www.kikomilano.com.tr/cilt-bakimi/',
  'https://www.kikomilano.com.tr/aksesuarlar/',
  'https://www.kikomilano.com.tr/makyaj-seti/',
];
const KIKO_SCROLL_ROUNDS_PER_LISTING = 6; // ~120 of each listing's own candidates per run
const KIKO_MAX_SHADES_PER_PRODUCT = 60; // seen up to 35 real shades on one item; just a safety bound

// Same platform-tracker family confirmed live as Koton's own (Google Ads/
// Analytics) plus Visilabs, a Turkish analytics/personalization vendor this
// site uses that Koton didn't.
async function ensureKikoPageSetup(page) {
  if (page.__kikoRequestBlockingSetup) return;
  page.__kikoRequestBlockingSetup = true;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const url = req.url();
    const isHeavyAsset = type === 'image' || type === 'font' || type === 'media';
    const isTracker = /doubleclick\.net|googlesyndication|googleadservices|analytics\.google\.com|googletagmanager|visilabs\.net|facebook\.com\/tr|hotjar/i.test(url);
    if (isHeavyAsset || isTracker) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

// Kiko's shade labels ("34 Chestnut", "120 Rosy Mauve0") are English/Italian
// shade names, not Turkish color words like every other site here —
// translating tr->fa/en (what getOrCreateColorId above assumes) would
// mistranslate an already-English word, so this creates/reuses a colors row
// from the raw label directly, source language 'en'. Also cleans messy
// source data confirmed live: a leading shade number ("34 Chestnut" ->
// "Chestnut"), a trailing stray digit ("120 Rosy Mauve0" -> "Rosy Mauve"),
// or a trailing period ("105 Scarlet Red." -> "Scarlet Red") — the last two
// also mean two swatches can clean down to the exact same word (confirmed
// live: "105 Scarlet Red" and "105 Scarlet Red." both existed on one
// product), so callers must still dedupe by the returned color id.
async function getOrCreateKikoColorId(rawLabel) {
  const word = (rawLabel || '')
    .replace(/^\d+\s*/, '')
    .replace(/\.$/, '')
    .replace(/(\D)\d$/, '$1')
    .trim();
  if (!word) return null;
  const cacheKey = 'kiko:' + word.toLowerCase();
  if (colorCreateCache.has(cacheKey)) return colorCreateCache.get(cacheKey);
  const key = slugifyColorKey(word);
  if (!key) return null;

  let color = await prisma.colors.findUnique({ where: { key } });
  if (!color) {
    const [name_fa, name_tr] = await Promise.all([
      translateText(word, 'en', 'fa').catch(() => word),
      translateText(word, 'en', 'tr').catch(() => word),
    ]);
    try {
      color = await prisma.colors.create({
        data: { key, hex: '#CCCCCC', name_fa: name_fa.slice(0, 30), name_en: word.slice(0, 30), name_tr: name_tr.slice(0, 30) },
      });
    } catch (err) {
      // Same race as getOrCreateColorId above — another product earlier in
      // this run (or a concurrent import) may have created this key first.
      if (err.code === 'P2002') color = await prisma.colors.findUnique({ where: { key } });
      else throw err;
    }
  }
  colorCreateCache.set(cacheKey, color.id);
  return color.id;
}

// Scrolls one listing, reading each card's url + whether it carries a
// genuine `pz-price.-retail` directly from the grid. See the big comment
// above KIKO_LISTINGS for why this needs page.mouse.wheel() and why every
// round's cards get folded into `found` rather than reading the DOM's final
// size once at the end.
async function collectKikoListingCandidates(pm, listingUrl) {
  const page = await pm.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKikoPageSetup(page);
  await new Promise(r => setTimeout(r, 1500));

  const found = new Map();
  for (let i = 0; i < KIKO_SCROLL_ROUNDS_PER_LISTING; i++) {
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.product-item')).map(card => ({
      url: card.querySelector('a[href]')?.href || null,
      discounted: !!card.querySelector('pz-price.-retail'),
    })));
    for (const c of cards) if (c.url && c.discounted) found.set(c.url, true);

    await page.mouse.wheel({ deltaY: 2500 });
    await new Promise(r => setTimeout(r, 1800));
  }
  return [...found.keys()];
}

// Round-robins every listing's own candidates (same interleaving Koton's
// own multi-listing collection uses) so a big listing (Yüz Makyajı, ~656
// items) can't crowd out a small one (Makyaj Seti, ~24 items) before the
// run's overall `limit` is reached.
async function collectKikoDiscountedCandidates(pm) {
  const perListing = [];
  for (const listingUrl of KIKO_LISTINGS) {
    perListing.push(await collectKikoListingCandidates(pm, listingUrl));
  }
  const seen = new Set();
  const result = [];
  for (let i = 0; i < Math.max(...perListing.map(l => l.length), 0); i++) {
    for (const urls of perListing) {
      const u = urls[i];
      if (u && !seen.has(u)) { seen.add(u); result.push(u); }
    }
  }
  return result;
}

// Every PDP lists its own full sibling shade family via <pz-variant-option>
// (a custom element carrying a url+value per shade) — KikoMilano() below
// uses that list to group every shade of one item into a single product
// with one color per shade (chosen over a product-per-shade, which is how
// the site itself presents them, to keep the catalog from ballooning up to
// ~35x per style). Confirmed live that a shade swatch click navigates to a
// distinct URL rather than swapping an image in place, so shades can't be
// read from one page load alone. JSON-LD offers.price is always the CURRENT
// (possibly discounted) price, never the original (confirmed live: Glossy
// Lip Set's JSON-LD said 1598, the real original was 3197) — the genuine
// old-price signal is the `.price.-retail` element, which only renders when
// a real discount is active. JSON-LD's own "availability" is unreliable
// (confirmed live: a shade whose page showed "STOĞU GELİNCE HABER VER"
// still reported "InStock" there), so stock comes from the actual add-to-
// cart/notify-me button instead. The real description sits in JSON-LD's own
// "description" field here (unlike LCWaikiki/Koton's boilerplate trap) —
// confirmed live it matches the short line shown right under the title, not
// generic marketing copy.
async function scrapeKikoProduct(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKikoPageSetup(page);
  await new Promise(r => setTimeout(r, 1200));
  await page.waitForFunction(
    () => (document.querySelector('.product-info .price pz-price')?.textContent || '').trim().length > 0,
    { timeout: 8000 }
  ).catch(() => {});

  return page.evaluate(() => {
    const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .filter(Boolean);
    const prod = ldBlocks.find(d => d['@type'] === 'Product');
    if (!prod) return null;

    const retailEl = document.querySelector('.product-info .price.-retail pz-price');
    const currentEl = document.querySelector('.product-info .price:not(.-retail) pz-price');
    const actionArea = document.querySelector('.product-info__action') || document;
    const inStock = !actionArea.querySelector('.js-product-stock-alert');

    const selected = document.querySelector('pz-variant-option.-selected');
    const variantUrls = Array.from(document.querySelectorAll('pz-variant-option'))
      .map(o => o.getAttribute('url'))
      .filter(Boolean)
      .map(u => new URL(u, location.href).href);

    return {
      name: prod.name,
      // schema.org's "image" is documented as either a single URL string or
      // an array of them — confirmed live on Kiko (2026-09-24) that some
      // products genuinely use the bare-string form (e.g. "LIPS & NAILS
      // COMBO- APRICOT NUDE SET"). The old `[...new Set(prod.image || [])]`
      // silently spread a bare string into one "image" per character
      // (Sets iterate strings char-by-char), so every image download for
      // that product failed with an invalid-URL error, caught per-image,
      // leaving the product with zero images and no visible error anywhere.
      images: [...new Set(Array.isArray(prod.image) ? prod.image : (prod.image ? [prod.image] : []))],
      description: prod.description || '',
      hasRetail: !!retailEl,
      originalText: retailEl?.textContent || null,
      currentText: currentEl?.textContent || null,
      inStock,
      currentShadeLabel: selected?.getAttribute('value') || null,
      variantUrls,
    };
  });
}

// A lightweight visit to one sibling shade's own page, just to read its
// price/stock/label — can't be inferred from the swatch list on another
// shade's page alone (confirmed live: a shade's own swatch still carries
// the `selectable` attribute even when that exact shade's page shows
// "STOĞU GELİNCE HABER VER").
async function scrapeKikoShade(pm, url) {
  const page = await pm.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKikoPageSetup(page);
  await new Promise(r => setTimeout(r, 1200));
  await page.waitForFunction(
    () => document.querySelector('pz-variant-option.-selected') != null,
    { timeout: 8000 }
  ).catch(() => {});

  return page.evaluate(() => {
    const selected = document.querySelector('pz-variant-option.-selected');
    const label = selected?.getAttribute('value') || null;
    if (!label) return null;
    const actionArea = document.querySelector('.product-info__action') || document;
    const inStock = !actionArea.querySelector('.js-product-stock-alert');
    return { label, inStock };
  });
}

// Kiko is a single-department cosmetics storefront — always category_id 10,
// no routing needed like Koton's Clothing/Shoes/Accessories/Cosmetics
// split. Subcategory reuses the same TR_KEYWORD_TO_COSMETIC_SUBCATEGORY
// table Koton/Zara already share (ids 42 Face/43 Eye/44 Lip/45 Skincare/
// etc. all already exist in production — confirmed several are just
// currently inactive/hidden from the public API for having zero products,
// not missing). Gender defaults to 'unisex' — no gender selector anywhere
// on the site. Kiko's own discount badge (the listing card's "50%") never
// appears on the PDP itself, so the tag is derived from raw prices (case B
// of resolveDiscountTag) like Defacto/MadameCoco/Zara, not the stated-
// percent case LCWaikiki/Koton use.
async function KikoMilano(pm, site, opts = {}) {
  const limit = opts.limit || 30;

  const candidateUrls = await collectKikoDiscountedCandidates(pm);

  const existing = await prisma.products.findMany({
    where: { product_link: { in: candidateUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const newUrls = candidateUrls.filter(u => !existingSet.has(u));

  const imported = [];
  let notDiscounted = 0;
  // Every sibling URL of an already-imported shade group lands here so it's
  // never reprocessed as its own separate candidate later in this run.
  const consumedUrls = new Set();

  // One tab per worker, same pattern as Lefties.
  const canParallelize = typeof opts.createPageManager === 'function' && opts.browser;
  const pms = [pm];
  if (canParallelize) for (let i = 1; i < IMPORT_CONCURRENCY; i++) pms.push(opts.createPageManager(opts.browser));

  let stopped = false;
  await runQueue(newUrls, pms, async (workerPm, url) => {
    if (stopped) return;
    if (imported.filter(p => !p.error).length >= limit) return void (stopped = true);
    if (consumedUrls.has(url)) return;
    try {
      const data = await scrapeKikoProduct(workerPm, url);
      if (!data || !data.name) return;
      if (!data.hasRetail) { notDiscounted++; return; }

      const priceOriginal = parseTLPrice(data.originalText);
      const priceSite = parseTLPrice(data.currentText);
      if (!priceOriginal || priceSite == null || priceOriginal <= priceSite) { notDiscounted++; return; }

      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      const tag = resolveDiscountTag({
        discountPercentText: null,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; return; }

      // Two shades of one product can be in flight on the two workers at
      // once: the first to get here claims the whole group (nothing between
      // reading its page and this claim awaits), the other drops out instead
      // of importing a duplicate.
      const groupUrls = [url, ...data.variantUrls.filter(u => u !== url)].slice(0, KIKO_MAX_SHADES_PER_PRODUCT);
      if (groupUrls.some(u => consumedUrls.has(u))) return;
      groupUrls.forEach(u => consumedUrls.add(u));

      const category_id = 10;
      const subcategory_id = guessSubcategoryId(data.name, 10);

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

      const siblingUrls = [url, ...data.variantUrls.filter(u => u !== url)].slice(0, KIKO_MAX_SHADES_PER_PRODUCT);
      const shades = [];
      for (const sUrl of siblingUrls) {
        if (sUrl === url) {
          if (data.currentShadeLabel) shades.push({ label: data.currentShadeLabel, inStock: data.inStock });
          continue;
        }
        try {
          const sData = await scrapeKikoShade(workerPm, sUrl);
          if (sData) shades.push(sData);
        } catch (e) { /* skip a broken shade page, keep the rest of the group */ }
      }

      const colorEntries = [];
      const seenColorIds = new Set();
      for (const s of shades) {
        const colorId = await getOrCreateKikoColorId(s.label);
        if (!colorId || seenColorIds.has(colorId)) continue;
        seenColorIds.add(colorId);
        colorEntries.push({ colorId, inStock: s.inStock });
      }

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id, subcategory_id,
          gender: 'unisex',
          name_fa: nameFa, name_en: nameEn, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: data.description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: finalDiscountedPrice,
          tag,
          // A variant-less product (no pz-variant-option at all, e.g. some
          // accessories) never reaches the product_inventory update below —
          // its own inStock is the only stock signal it'll ever get, so it
          // has to land here instead of the hardcoded 0 every other
          // importer uses (they always have at least a size or a color).
          stock: colorEntries.length ? 0 : (data.inStock ? 10 : 0),
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorEntries.length ? { create: colorEntries.map(c => ({ color_id: c.colorId, is_available: c.inStock })) } : undefined,
        },
      });

      if (colorEntries.length) {
        await prisma.product_inventory.createMany({
          data: colorEntries.map(c => ({ product_id: product.id, color_id: c.colorId, size_label: null, quantity: c.inStock ? 10 : 0 })),
        });
        const totalQty = colorEntries.filter(c => c.inStock).length * 10;
        await prisma.products.update({ where: { id: product.id }, data: { stock: totalQty } });
      }

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  });

  for (let i = 1; i < pms.length; i++) await pms[i].close().catch(() => {});

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

// Lefties is Inditex's discount/basics banner (same corporate family as
// Zara, confirmed live: same lft-/inditex-prefixed JS framework, the same
// event-tracker.inditex.com telemetry, the same itxrest robots.txt
// disallow). Its Turkish storefront has no dedicated sale/outlet section
// anywhere in the nav or URL space (checked live across Woman/Man/Kids — no
// "İndirim" equivalent exists, unlike Zara's hardcoded ezel-fiyatlar pages),
// so every regular category listing doubles as this scraper's only source
// of candidate URLs, gated per-product on a real second price line actually
// rendering — same "worth including even if empty today" reasoning as
// Zara's own Beauty/Home segments (confirmed live: neither found a single
// genuine markdown across ~150 sampled products on 2026-09-24 — this is
// expected to import 0 until Lefties' next seasonal sale, not a bug).
//
// Unlike every other scraper here, the candidate LISTING urls aren't
// hardcoded IDs: Lefties' own gzipped category sitemap (linked from its
// robots.txt) is fetched and parsed fresh every run, so the numeric -c<id>s
// never need hand-updating as Lefties adds/renames categories. Since the
// switch to its catalog API (see readLeftiesCategory) reading a listing
// takes well under a second, so EVERY category is used (~540 on
// 2026-10-05: all of Woman/Man/Kids incl. babies, Home, Sportswear) —
// before, page scrolling capped this to a curated ~38 to keep runs under a
// few hours. Pure marketing collections (new-in, halloween, ...) are
// skipped: they only re-list products that already have a real category.
// Deeper (more specific) categories come first so a product shared with
// its parent is filed under e.g. "kids/girl/footwear" rather than "kids".
const LEFTIES_EXCLUDE = /\/(new-in|halloween|seasonal-basics|back-to-office|ready-22|collabs|promotion|total-look|bestsellers)(\/|-c)/;
const LEFTIES_HOME_SLUGS = [
  [/\/(tableware|glassware|cutlery|table-linen)/, 'sofra'],
  [/\/dining-room|\/kitchen/, 'mutfak'],
  [/\/bathroom/, 'banyo'],
  [/\/bedroom/, 'yatak-odasi'],
  [/\/fragrances/, 'kozmetik'],
  [/\/decoration/, 'dekorasyon'],
];

function routeLeftiesListing(path) {
  const top = path.split('/')[0];
  const gender = { woman: 'female', man: 'male', kids: 'kids' }[top] || 'unisex';
  const p = '/' + path;
  if (top === 'home') {
    const hit = LEFTIES_HOME_SLUGS.find(([re]) => re.test(p));
    return { gender, categoryId: LIFESTYLE_CATEGORY_ID, homeSlug: hit ? hit[1] : 'ev-yasam' };
  }
  if (/\/footwear(\/|$)/.test(p)) return { gender, categoryId: 2 };
  if (/\/(accessories|bags|bags-%7c-backpacks|maternity-bags)(\/|$)/i.test(p)) return { gender, categoryId: 3 };
  if (/\/sportswear(\/|$)/.test(p)) return { gender, categoryId: 7 };
  return { gender, categoryId: 1 };
}

async function fetchLeftiesListingMeta(pm) {
  const page = await pm.goto('https://www.lefties.com/tr/tr/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureLeftiesPageSetup(page);
  const urls = await page.evaluate(async () => {
    const res = await fetch('https://www.lefties.com/9/info/sitemaps/sitemap-home-categories-lf-tr-0.xml.gz');
    const buf = await res.arrayBuffer();
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    // The sitemap lists every locale together; /tr/en/ paths are plain
    // ASCII and resolve to the same numbered category as the Turkish ones
    // (Inditex routes by the trailing -c<id>, not the slug).
    return [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
      .filter((u) => u.includes('/tr/en/') && /-c\d+\.html$/.test(u));
  });
  const listings = urls
    .map((u) => ({ u, path: u.replace('https://www.lefties.com/tr/en/', '').replace(/-c\d+\.html$/, '') }))
    .filter(({ u, path }) => path.split('/').length >= 2 && !LEFTIES_EXCLUDE.test(u))
    .sort((a, b) => b.path.split('/').length - a.path.split('/').length)
    .map(({ u, path }) => ({ url: u.replace('/tr/en/', '/tr/tr/'), homeSlug: null, ...routeLeftiesListing(path) }));
  return { page, listings };
}

// Same event-tracker.inditex.com/GTM/Facebook-pixel telemetry pattern as
// Zara (same corporate family), confirmed live — blocked proactively here
// rather than discovering a VPS-only navigation timeout the hard way, same
// lesson as LCWaikiki/Koton's own history.
// Only trackers are blocked here, NOT images/fonts/media (unlike every
// other ensure*PageSetup in this file) — confirmed live, and the direct
// cause of the "Quilted Shopper" miss above: Lefties' own listing grid
// uses each product image's load event as its lazy-load trigger for
// revealing the next batch, so aborting image requests doesn't just save
// bandwidth here, it silently caps every listing at whatever rendered
// before the image pipeline stalled (~98 of Woman Bags' real 220, in one
// run) with no error or signal that anything was cut short.
async function ensureLeftiesPageSetup(page) {
  if (page.__leftiesRequestBlockingSetup) return;
  page.__leftiesRequestBlockingSetup = true;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const isTracker = /event-tracker\.inditex\.com|gtm\.lefties\.com|googletagmanager|google-analytics|doubleclick|connect\.facebook\.net|s\.pinimg\.com|clarity\.ms|hotjar/i.test(url);
    if (isTracker) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

// Accessories(3) currently only has one real subcategory in production
// ("bag" / Çantalar, id 13), same as every other scraper's own version of
// this helper.
function guessLeftiesAccessorySubcategoryId(nameTr) {
  return /çanta|canta/i.test(nameTr || '') ? 13 : null;
}

// User's choice (2026-10-05): every importer works on 2 products at a time.
// Browser-based importers get one PageManager (tab) per worker; API-only
// ones (Mavi, MClub, ArmaLife, Mango) just need 2 slots to run in.
const IMPORT_CONCURRENCY = 2;
const IMPORT_WORKER_SLOTS = Array.from({ length: IMPORT_CONCURRENCY }, (_, i) => i);

// Runs `work(resource, item, idx)` over `items`, one call in flight per
// entry in `resources` (e.g. one PageManager each), each worker pulling the
// next item off a shared index counter (a plain shared queue) rather than a
// fixed static split — so one worker stuck on a slow item doesn't leave the
// others idle with items still waiting, the way a fixed "N items per
// worker" chunking would. Takes the actual resources array, not a bare
// concurrency number: each of the `resources.length` loops closes over ONE
// resource for its entire run, so the same PageManager is never handed to
// two concurrent `work()` calls at once — a `resources[idx % resources.length]`
// scheme looks equivalent but isn't: idx doesn't correspond to which loop
// actually claimed it (queue items are claimed by whichever loop asks
// next), so two different loops can land on the same idx%N in flight
// together and race on that PageManager's single underlying page.
async function runQueue(items, resources, work) {
  let next = 0;
  async function worker(resource) {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      await work(resource, items[idx], idx);
    }
  }
  await Promise.all(resources.map(worker));
}

// Lefties can serve the exact same physical product under two entirely
// different URLs depending on which listing surfaced it — confirmed live:
// a crossbody bag was reachable both as .../kadın/çanta/.../makrome-...
// -c1030511545p747894851.html (its real home, Bags) AND as .../kadın/
// ayakkabı/makrome-...-c1030267545p747894851.html (Footwear's own category
// id spliced into the same product's URL, presumably a cross-sell/"you may
// also like" widget rendering with the browsing context's own category
// prefix). Same trailing `p<id>.html` both times — that id, not the full
// URL, is Lefties' actual stable product identifier, so every URL-keyed
// dedup below (candidates against each other, and against already-imported
// products) uses it instead. The real bug this caused in production: two
// separate `products` rows for the same bag, one correctly under Bags, one
// miscategorized as Footwear because it happened to be discovered there.
function leftiesProductId(url) {
  return url.match(/p(\d+)\.html/)?.[1] || url;
}

// Lefties' own storefront API (Inditex's itxrest — the same JSON its listing
// pages fill themselves from). Akamai blocks plain requests to it, so it's
// called with fetch() from inside the one Lefties page this run opens (the
// homepage, see fetchLeftiesListingMeta), like Mavi. Per listing that's one
// call for its product ids, one for per-size stock, and one per 50 products
// for names/prices/colors/sizes/images — versus the old approach of
// scrolling every listing and opening every product page, which took hours
// (2026-10-05: 18 categories / ~3,500 products read in 37s this way).
const LEFTIES_API = '/itxrest/3/catalog/store/94009021/90009064';
const LEFTIES_STOCK_API = '/itxrest/2/catalog/store/94009021/90009064';
const LEFTIES_LANGUAGE_ID = -43; // Turkish
const LEFTIES_BATCH = 50;
const LEFTIES_STOCK_PER_SIZE = 10;
const LEFTIES_MAX_GALLERY_IMAGES = 14;

// Reads Lefties products inside the page (Akamai blocks the API outside
// it) and returns plain objects trimmed to what the import needs. A bundle
// product carries its real details in bundleProductSummaries[0], whose id
// is the one product pages and our stored product_link use. Stock comes
// from the stock endpoint, not the size's own isBuyable (confirmed
// 2026-10-05: true even for sold-out sizes). `stockScope` is either a
// category id (one call covers every product in it) or null to ask per
// product.
function leftiesReadProductsInPage({ api, stockApi, lang, batch, categoryId, ids, stockScope }) {
  const get = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Lefties API ${res.status} (category ${categoryId})`);
    return res.json();
  };
  return (async () => {
    const availability = new Map(); // sku -> 'in_stock' | 'out_of_stock' | ...
    const addStock = (data) => {
      for (const s of data.stocks || []) for (const sku of s.stocks || []) availability.set(String(sku.id), sku.availability);
    };
    if (stockScope) {
      addStock(await get(`${stockApi}/category/${stockScope}/stock?withSubCategories=false&languageId=${lang}&appId=1`).catch(() => ({})));
    }
    const out = [];
    for (let i = 0; i < ids.length; i += batch) {
      const data = await get(`${api}/productsArray?productIds=${ids.slice(i, i + batch).join('%2C')}&languageId=${lang}&categoryId=${categoryId}&appId=1`);
      for (const p of data.products || []) {
        const b = p.bundleProductSummaries?.[0] || p;
        const d = b.detail || {};
        const skus = (d.colors || []).flatMap(c => (c.sizes || []).map(s => String(s.sku)));
        // Not covered by the category's stock list (or none was read):
        // ask for this one product's stock instead.
        if (skus.some(sku => !availability.has(sku))) {
          addStock(await get(`${stockApi}/product/${b.id}/stock?languageId=${lang}&appId=1`).catch(() => ({})));
        }
        const imagesByColor = {};
        for (const x of d.xmedia || []) {
          imagesByColor[x.colorCode] = (x.xmediaItems || []).flatMap(it => it.medias || [])
            .map(m => m.url || m.extraInfo?.url).filter(u => u && /\.jpe?g/i.test(u));
        }
        out.push({
          id: String(b.id),
          topId: String(p.id),
          name: p.name || b.name,
          family: [b.familyName, b.subFamilyName, p.familyName].filter(Boolean).join(' '),
          slug: String(b.productUrl || p.productUrl || '').replace(/-l\d+$/, ''),
          description: String(d.longDescription || d.description || '').trim(),
          colors: (d.colors || []).map(c => ({
            id: c.id,
            name: c.name,
            images: imagesByColor[c.id] || [],
            sizes: (c.sizes || []).filter(s => s.visibilityValue !== 'HIDE').map(s => ({
              name: s.name,
              price: Number(s.price) / 100,
              oldPrice: s.oldPrice ? Number(s.oldPrice) / 100 : null,
              inStock: availability.get(String(s.sku)) === 'in_stock',
            })),
          })),
        });
      }
    }
    return out;
  })();
}

const leftiesApiArgs = () => ({ api: LEFTIES_API, stockApi: LEFTIES_STOCK_API, lang: LEFTIES_LANGUAGE_ID, batch: LEFTIES_BATCH });

// One listing (category). Product ids already read from an earlier listing
// this run, or already imported, are remembered inside the page itself
// (window.__leftiesSkip, seeded once per run) and never re-read — most
// products sit in several categories (parent, child, "view all").
async function readLeftiesCategory(page, categoryId) {
  const args = { ...leftiesApiArgs(), categoryId };
  const ids = await page.evaluate(async ({ api, lang, categoryId }) => {
    const res = await fetch(`${api}/category/${categoryId}/product?showProducts=false&languageId=${lang}&appId=1`);
    if (!res.ok) throw new Error(`Lefties API ${res.status} (category ${categoryId})`);
    const list = await res.json();
    const skip = window.__leftiesSkip || (window.__leftiesSkip = new Set());
    const fresh = (list.productIds || []).map(String).filter(id => !skip.has(id));
    fresh.forEach(id => skip.add(id));
    return fresh;
  }, args);
  if (!ids.length) return [];
  const products = await page.evaluate(leftiesReadProductsInPage, { ...args, ids, stockScope: categoryId });
  // Bundles list under a top-level id but are stored by their inner id.
  await page.evaluate((more) => more.forEach(id => window.__leftiesSkip.add(id)), products.flatMap(p => [p.id, p.topId]));
  return products;
}

// Specific products (stock check), grouped by the category in their link.
async function readLeftiesProducts(page, categoryId, ids) {
  return page.evaluate(leftiesReadProductsInPage, { ...leftiesApiArgs(), categoryId, ids, stockScope: null });
}

// Rebuilds a Lefties product's colors, sizes and per color x size stock for
// the given colors (same approach as writeArmaLifeVariants: nothing
// references these rows by id), only when something changed.
async function writeLeftiesVariants(productId, colors) {
  const inventory = [];
  const sizeOrder = [];
  const colorRows = new Map();
  for (const c of colors) {
    const colorId = await getOrCreateColorId(c.name);
    for (const s of c.sizes) {
      const label = String(s.name || '').trim().slice(0, 10);
      if (!label) continue;
      if (!sizeOrder.includes(label)) sizeOrder.push(label);
      const quantity = s.inStock ? LEFTIES_STOCK_PER_SIZE : 0;
      const same = inventory.find((i) => i.color_id === colorId && i.size_label === label);
      if (same) { same.quantity = Math.max(same.quantity, quantity); continue; }
      inventory.push({ product_id: productId, color_id: colorId, size_label: label, quantity });
    }
    if (colorId != null) {
      const inStock = c.sizes.some((s) => s.inStock);
      colorRows.set(colorId, { product_id: productId, color_id: colorId, is_available: inStock || !!colorRows.get(colorId)?.is_available });
    }
  }
  const stock = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const sig = (rows) => rows.map((r) => `${r.color_id}|${r.size_label}|${r.quantity}`).sort().join(',');
  const current = await prisma.product_inventory.findMany({ where: { product_id: productId } });
  if (sig(current) === sig(inventory)) return { stock, changed: false };
  await prisma.$transaction([
    prisma.product_inventory.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.deleteMany({ where: { product_id: productId } }),
    prisma.product_sizes.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.createMany({ data: [...colorRows.values()] }),
    prisma.product_sizes.createMany({
      data: sizeOrder.map((label) => ({
        product_id: productId, size_label: label,
        is_available: inventory.some((i) => i.size_label === label && i.quantity > 0),
      })),
    }),
    prisma.product_inventory.createMany({ data: inventory }),
  ]);
  return { stock, changed: true };
}

// Lefties shows its own rate as the cut over the old price ("-28%"), which
// is what's compared against the markup (case (a) of resolveDiscountTag).
// Every in-stock color that clears it goes into one product (same as
// ArmaLife/Mango); the most expensive of them sets the price. Null when no
// color qualifies.
function leftiesPricing(product, markupPercent) {
  const qualifying = [];
  for (const c of product.colors) {
    const sized = c.sizes.filter(s => s.oldPrice > s.price && s.price > 0);
    if (!sized.length || !c.sizes.some(s => s.inStock)) continue;
    const current = Math.max(...sized.map(s => s.price));
    const original = Math.max(...sized.map(s => s.oldPrice));
    const pct = Math.round((original - current) / original * 100);
    const finalDiscountedPrice = Math.round(current * (1 + markupPercent / 100) * 100) / 100;
    const tag = resolveDiscountTag({ discountPercentText: String(pct), markupPercent, finalDiscountedPrice, priceOriginal: original });
    if (tag === 'discount') qualifying.push({ colorId: c.id, original, current, finalDiscountedPrice });
  }
  if (!qualifying.length) return null;
  const top = qualifying.reduce((a, b) => (b.current > a.current ? b : a));
  return {
    colorIds: qualifying.map(q => q.colorId),
    price: top.original, discounted_price: top.finalDiscountedPrice, cost_price: top.current, tag: 'discount',
  };
}

async function Lefties(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  await seedLifestyleSubcategories();

  // The one navigation of the run (homepage + category sitemap). A
  // transient timeout here once aborted a whole run, so it gets one retry.
  let meta;
  try {
    meta = await fetchLeftiesListingMeta(pm);
  } catch (err) {
    console.warn(`[siteImport] Lefties listing-meta fetch failed, retrying once: ${err.message}`);
    await new Promise((r) => setTimeout(r, 3000));
    meta = await fetchLeftiesListingMeta(pm);
  }
  const { page, listings } = meta;

  const existingLinks = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null } },
    select: { product_link: true },
  });
  const existingIds = new Set(existingLinks.map((e) => leftiesProductId(e.product_link)));
  await page.evaluate((ids) => { window.__leftiesSkip = new Set(ids); }, [...existingIds]);

  // Each product once, under the first listing that has it — the same
  // product shows up in several listings (see leftiesProductId).
  const products = new Map(); // id -> { product, listing, categoryId }
  for (const listing of listings) {
    const categoryId = listing.url.match(/-c(\d+)\.html/)?.[1];
    if (!categoryId) continue;
    try {
      for (const product of await readLeftiesCategory(page, categoryId)) {
        if (!products.has(product.id)) products.set(product.id, { product, listing, categoryId });
      }
    } catch (err) {
      // One failing listing shouldn't cost the run every other listing.
      console.warn(`[siteImport] Lefties listing failed, skipping: ${listing.url} — ${err.message}`);
    }
  }

  const fresh = [...products.values()].filter(({ product }) => !existingIds.has(product.id) && !existingIds.has(product.topId));
  const candidates = fresh
    .map((entry) => ({ ...entry, pricing: leftiesPricing(entry.product, site.markup_percent) }))
    .filter((entry) => entry.pricing);

  const imported = [];
  let stopped = false;
  await runQueue(candidates, IMPORT_WORKER_SLOTS, async (_worker, { product, listing, categoryId, pricing }) => {
    if (stopped) return;
    if (imported.filter((p) => !p.error).length >= limit) return void (stopped = true);
    const url = `https://www.lefties.com/tr/${product.slug}-c${categoryId}p${product.id}.html`;
    try {
      // A listing's path alone misfiles some products — kids' sneakers live
      // under character collections like "Hello Kitty", not "footwear" — so
      // Lefties' own product family (e.g. "FLATSHOES") wins when it says
      // shoes or bags (e.g. "TRAINERS", "FLATSHOES"; it's sometimes blank,
      // so the Turkish name is checked too).
      const isShoe = /SHOE|TRAINER|SNEAKER|SANDAL|BOOT|FOOTWEAR|SLIPPER|BALLERINA|ESPADRILLE|CLOG|MOCCASIN|LOAFER|FLIP/i.test(product.family)
        || /ayakkabı|sneaker|\bbot\b|çizme|sandalet|terlik|babet|patik/i.test(product.name);
      const isBag = /BAG|BACKPACK|WALLET|PURSE/i.test(product.family) || /çanta|cüzdan/i.test(product.name);
      const category_id = isShoe ? 2 : isBag ? 3 : listing.categoryId;
      const subcategory_id = category_id === 1 || category_id === 7 ? guessSubcategoryId(product.name, category_id)
        : category_id === 3 ? guessLeftiesAccessorySubcategoryId(product.name)
        : category_id === LIFESTYLE_CATEGORY_ID ? getLifestyleSubcategoryId(listing.homeSlug)
        : null; // category_id 2 (Shoes) has no subcategories in production yet

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch((err) => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(product.name, 'fa'),
        translateOrWarn(product.name, 'en'),
        product.description ? translateOrWarn(product.description, 'fa') : '',
        product.description ? translateOrWarn(product.description, 'en') : '',
      ]);
      const nameTr = product.name.slice(0, 120);

      const colors = product.colors.filter((c) => pricing.colorIds.includes(c.id));
      const photos = [...colors[0].images.slice(0, 8)];
      for (const c of colors.slice(1)) photos.push(...c.images.slice(0, 2));
      const mediaUrls = [];
      for (const imgUrl of [...new Set(photos)].slice(0, LEFTIES_MAX_GALLERY_IMAGES)) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const created = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id, subcategory_id,
          gender: listing.gender || 'unisex',
          name_fa: (name_fa || nameTr).slice(0, 120), name_en: (name_en || nameTr).slice(0, 120), name_tr: nameTr,
          desc_fa, desc_en, desc_tr: product.description || null,
          price: pricing.price,
          discounted_price: pricing.discounted_price,
          cost_price: pricing.cost_price,
          tag: pricing.tag,
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
        },
      });

      const { stock } = await writeLeftiesVariants(created.id, colors);
      await prisma.products.update({ where: { id: created.id }, data: { stock } });

      imported.push({ id: created.id, name: product.name });
    } catch (err) {
      imported.push({ error: err.message, url });
    }
  });

  return { imported, skipped: (products.size - fresh.length) + (fresh.length - candidates.length) };
}

// Lefties' stock check (called from siteSync.js#checkSiteStock, with a
// browser page since the API only answers from inside one): re-reads each
// imported product's prices, colors and per-size stock. Same rule as
// Mango's: a product whose discount ended, no longer clears the markup, or
// sold out in every qualifying color is taken off the site — selling it
// at the old discounted price would be selling below Lefties' price.
// Otherwise it's re-priced and its colors/sizes/stock rewritten (products
// imported before colors were grouped pick up their other discounted
// colors here).
async function checkLeftiesStock(site, products, pm) {
  const { syncSubcategoryActiveState } = require('./subcategorySync');
  const { page } = await fetchLeftiesListingMeta(pm);

  const byCategory = new Map();
  for (const p of products) {
    const categoryId = p.product_link?.match(/-c(\d+)p\d+\.html/)?.[1] || '0';
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push(p);
  }

  const results = [];
  for (const [categoryId, group] of byCategory) {
    let found = new Map();
    try {
      for (let i = 0; i < group.length; i += LEFTIES_BATCH) {
        const ids = group.slice(i, i + LEFTIES_BATCH).map(p => leftiesProductId(p.product_link));
        for (const item of await readLeftiesProducts(page, categoryId, ids)) {
          found.set(item.id, item);
          found.set(item.topId, item);
        }
      }
    } catch (err) {
      for (const p of group) results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
      continue;
    }
    for (const p of group) {
      try {
        const item = found.get(leftiesProductId(p.product_link));
        const pricing = item ? leftiesPricing(item, site.markup_percent) : null;
        if (!pricing) {
          await prisma.products.update({
            where: { id: p.id },
            data: { is_active: false, is_live: false, is_dirty: false, updated_at: new Date() },
          });
          if (p.subcategory_id) await syncSubcategoryActiveState(p.subcategory_id);
          results.push({ id: p.id, name: p.name_tr, status: 'deactivated (discount ended, sold out or gone)' });
          continue;
        }
        const colors = item.colors.filter(c => pricing.colorIds.includes(c.id));
        const { stock, changed } = await writeLeftiesVariants(p.id, colors);
        const keepAdminTag = ['bestseller', 'new'].includes(p.tag) ? p.tag : null;
        const tag = stock === 0 ? 'sold_out' : (pricing.tag || keepAdminTag);
        const update = {};
        if (Number(p.price) !== pricing.price) update.price = pricing.price;
        if ((p.discounted_price == null ? null : Number(p.discounted_price)) !== pricing.discounted_price) update.discounted_price = pricing.discounted_price;
        if (Number(p.cost_price) !== pricing.cost_price) update.cost_price = pricing.cost_price;
        if (p.stock !== stock) update.stock = stock;
        if (p.tag !== tag) {
          update.tag = tag;
          update.sold_out_at = tag === 'sold_out' ? new Date() : null;
        }
        if (Object.keys(update).length || changed) {
          await prisma.products.update({ where: { id: p.id }, data: { ...update, is_dirty: true, updated_at: new Date() } });
        }
        results.push({
          id: p.id, name: p.name_tr,
          status: tag === 'sold_out' ? 'sold_out' : `ok (stock=${stock})${Object.keys(update).length || changed ? ', updated' : ''}`,
        });
      } catch (err) {
        results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
      }
    }
  }
  return results;
}

// Mavi is an SAP Commerce (Spartacus/Angular) storefront behind a strict
// Cloudflare WAF — confirmed live that a handful of consecutive headless
// page navigations (listing -> listing -> listing) got this machine's IP
// hard-blocked ("Sorry, you have been blocked", then 403 even for plain
// curl). Its own OCC REST API (p1-api.mavi.com, the same one the
// storefront itself calls) returns everything this importer needs as JSON
// though — so this navigates exactly ONCE (the homepage, to pick up
// Cloudflare's cookies in a real browser context) and does every listing/
// product read after that as an in-page fetch() from that one page,
// instead of one navigation per page like every other scraper here.
//
// Only the "İndirim" entry under each department's own menu (Kadın/Erkek/
// Çocuk) is used — the user's explicit choice. Outlet (/outlet/c/4) was
// deliberately left out: confirmed live that outlet items carry only a
// single price with no old/struck-through one at all (their outlet price
// IS the list price), so they're never a real discount. Every product on
// these three listings, by contrast, had a genuine price > salePrice plus
// Mavi's own stated discountRate (checked all 487 at the time of writing).
const MAVI_API = 'https://p1-api.mavi.com/maviwebservices/v2/mavi';
const MAVI_DISCOUNT_QUERY = ':relevance:categoryTheme:Sezon İndirimi';
const MAVI_LISTINGS = [
  { categoryCode: '1', gender: 'female' }, // Kadın
  { categoryCode: '2', gender: 'male' },   // Erkek
  { categoryCode: '3', gender: 'kids' },   // Çocuk
];
const MAVI_PAGE_SIZE = 100;
const MAVI_MAX_PAGES_PER_LISTING = 10;

async function ensureMaviPageSetup(page) {
  if (page.__maviRequestBlockingSetup) return;
  page.__maviRequestBlockingSetup = true;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const url = req.url();
    const isHeavyAsset = type === 'image' || type === 'font' || type === 'media';
    const isTracker = /useinsider\.com|analytics\.google\.com|google-analytics\.com|googletagmanager|googlesyndication|doubleclick|facebook\.com\/tr|hotjar|stylitics|fitanalytics/i.test(url);
    if (isHeavyAsset || isTracker) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

async function openMaviApiPage(pm) {
  const page = await pm.goto('https://www.mavi.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ensureMaviPageSetup(page);
  await new Promise(r => setTimeout(r, 2000));
  const title = await page.title();
  if (/attention required|just a moment/i.test(title)) {
    throw new Error(`Mavi: blocked by Cloudflare on the homepage ("${title}")`);
  }
  return page;
}

async function maviApiGet(page, apiPath) {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
  }, MAVI_API + apiPath);
  if (res.status !== 200) throw new Error(`Mavi API ${res.status} for ${apiPath}`);
  return JSON.parse(res.text);
}

// Mavi's own product code (e.g. "1011270-89353" — style + color), the
// trailing segment of every product URL. Used for dedup instead of the full
// URL since the slug part in front of it is just the (renameable) name.
function maviProductCode(url) {
  return url.match(/\/p\/([^/?#]+)/)?.[1] || url;
}

function routeMaviCategory(mainCategoryName) {
  if (/çanta|cüzdan|aksesuar|kemer|şapka|bere|atkı|çorap/i.test(mainCategoryName || '')) return 3; // Accessories
  return 1; // Clothing
}

function guessMaviGender(genderName, defaultGender) {
  if (/çocuk|bebek/i.test(genderName || '')) return 'kids';
  if (/kadın/i.test(genderName || '')) return 'female';
  if (/erkek/i.test(genderName || '')) return 'male';
  return defaultGender;
}

async function Mavi(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  const page = await openMaviApiPage(pm);

  const metaByCode = new Map();
  const perListing = [];
  for (const listing of MAVI_LISTINGS) {
    const items = [];
    for (let pg = 0; pg < MAVI_MAX_PAGES_PER_LISTING; pg++) {
      const data = await maviApiGet(page, `/products/search?fields=FULL&query=${encodeURIComponent(MAVI_DISCOUNT_QUERY)}`
        + `&categoryCode=${listing.categoryCode}&pageSize=${MAVI_PAGE_SIZE}&currentPage=${pg}`);
      for (const p of data.products || []) {
        if (!p.code || metaByCode.has(p.code)) continue;
        metaByCode.set(p.code, { listing, search: p });
        items.push(p.code);
      }
      if (pg + 1 >= (data.pagination?.totalPages || 0)) break;
    }
    perListing.push(items);
  }
  const candidateCodes = [];
  for (let i = 0; i < Math.max(...perListing.map(l => l.length), 0); i++) {
    for (const codes of perListing) if (codes[i]) candidateCodes.push(codes[i]);
  }

  const existing = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null } },
    select: { product_link: true },
  });
  const existingCodes = new Set(existing.map(e => maviProductCode(e.product_link)));
  const newCodes = candidateCodes.filter(c => !existingCodes.has(c));

  const imported = [];
  let notDiscounted = 0;
  let consecutiveErrors = 0;

  let stopped = false;
  // One at a time, unlike every other importer: Mavi's Cloudflare WAF has
  // already blocked this IP for request bursts once (see Mavi's own notes).
  await runQueue(newCodes, [0], async (_worker, code) => {
    if (stopped) return;
    if (imported.filter(p => !p.error).length >= limit) return void (stopped = true);
    const { listing, search } = metaByCode.get(code);
    const url = new URL(search.url, 'https://www.mavi.com').href;

    // The search results already carry price/salePrice/discountRate, so a
    // product the markup rule would reject anyway is skipped here without its
    // own API call. Confirmed live 2026-09-30: with markup 40% (above every
    // Mavi discount at the time) nothing could pass, so one run walked all
    // ~490 candidates one API call each -- 280 of them errored, most likely
    // throttled; the same run with markup 25% needed only ~30 calls, 0 errors.
    const searchOriginal = search.price?.value;
    const searchSale = search.salePrice?.value;
    if (!searchOriginal || searchSale == null || searchOriginal <= searchSale || !resolveDiscountTag({
      discountPercentText: search.discountRate != null ? String(search.discountRate) : null,
      markupPercent: site.markup_percent,
      finalDiscountedPrice: Math.round(searchSale * (1 + site.markup_percent / 100) * 100) / 100,
      priceOriginal: searchOriginal,
    })) { notDiscounted++; return; }

    try {
      const data = await maviApiGet(page, `/products/basic/${encodeURIComponent(code)}?fields=FULL`);
      consecutiveErrors = 0;
      if (!data || !data.name) return;

      const priceOriginal = data.price?.value;
      const priceSite = data.salePrice?.value;
      if (!priceOriginal || priceSite == null || priceOriginal <= priceSite) { notDiscounted++; return; }

      // Jeans/trousers come as waist x length: every variant carries both
      // `size` (waist) and `length`, so `size` alone repeats (e.g. 26 seven
      // times for lengths 28-40) and product_sizes' @@unique([product_id,
      // size_label]) rejected the whole create -- hit live 2026-09-30 on
      // "Lisbon Açık Bej Denim Gabardin Pantolon" (113 variants). Label as
      // "26/28" when there's a length; any remaining duplicate label is
      // merged, in stock if any of its variants is.
      const sizeByLabel = new Map();
      for (const v of data.allSizeVariants || []) {
        const label = (v.length ? `${v.size}/${v.length}` : String(v.size || '')).slice(0, 10);
        if (!label) continue;
        const inStock = v.stockLevelStatus !== 'outOfStock';
        sizeByLabel.set(label, (sizeByLabel.get(label) || false) || inStock);
      }
      let sizes = [...sizeByLabel].map(([size, inStock]) => ({ size, inStock }));
      // A waist x length grid runs to 100+ combinations (113 on that same
      // product, only 16 in stock) -- listing every sold-out one as an
      // unavailable chip swamps the product page, so for these only the
      // in-stock combinations are kept (user's choice). Nothing re-adds a
      // combination that comes back in stock later: checkSiteStock skips Mavi.
      if ((data.allSizeVariants || []).some(v => v.length)) sizes = sizes.filter(s => s.inStock);
      // Nothing left to sell in any size — not worth importing at all.
      if (sizes.length && !sizes.some(s => s.inStock)) { notDiscounted++; return; }

      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      const tag = resolveDiscountTag({
        discountPercentText: data.discountRate != null ? String(data.discountRate) : null,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; return; }

      const mainCategoryName = (data.mainCategories || search.mainCategories || [])[0]?.name || '';
      const gender = guessMaviGender(data.gender?.name || search.gender?.name, listing.gender);
      const category_id = routeMaviCategory(mainCategoryName);
      const subcategory_id = category_id === 1 ? guessSubcategoryId(`${mainCategoryName} ${data.name}`, 1)
        : /çanta/i.test(mainCategoryName) ? 13
        : null;

      // Mavi's description text carries raw inline HTML ("...Tişört.</br>Yenilikçi...").
      const description = (data.fullDescription || data.description || '')
        .replace(/<\/?br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .replace(/\n{2,}/g, '\n').trim();

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(data.name, 'fa'),
        translateOrWarn(data.name, 'en'),
        description ? translateOrWarn(description, 'fa') : '',
        description ? translateOrWarn(description, 'en') : '',
      ]);

      // galleryImagesNew entries are size templates ("//sky-static.mavi.com/
      // mnresize/{x}/{y}/<code>_image_1.jpg?v=...") — 1005x1425 is the same
      // size Mavi's own JSON-LD uses for the product page.
      const imageUrls = [...new Set((data.galleryImagesNew || [])
        .filter(u => typeof u === 'string')
        .map(u => u.replace('{x}', '1005').replace('{y}', '1425'))
        .map(u => u.startsWith('//') ? 'https:' + u : u))];
      const mediaUrls = [];
      for (const imgUrl of imageUrls) {
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const colorId = await getOrCreateColorId(data.colour?.name || search.colour?.name);

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id,
          subcategory_id,
          gender,
          name_fa: (name_fa || '').slice(0, 120), name_en: (name_en || '').slice(0, 120), name_tr: data.name.slice(0, 120),
          desc_fa, desc_en, desc_tr: description || null,
          price: priceOriginal,
          cost_price: priceSite,
          discounted_price: finalDiscountedPrice,
          tag,
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorId ? { create: [{ color_id: colorId, is_available: true }] } : undefined,
          product_sizes: sizes.length ? {
            create: sizes.map(s => ({ size_label: s.size, is_available: s.inStock })),
          } : undefined,
        },
      });

      if (sizes.length) {
        await prisma.product_inventory.createMany({
          data: sizes.map(s => ({
            product_id: product.id, color_id: colorId, size_label: s.size,
            quantity: s.inStock ? 10 : 0,
          })),
        });
        const totalQty = sizes.filter(s => s.inStock).length * 10;
        await prisma.products.update({ where: { id: product.id }, data: { stock: totalQty } });
      } else {
        // No size variants at all (bags, wallets) -- one color-level row, or
        // stock stays 0 and adminController's resolveProductTag turns it
        // sold_out on the next admin save (its color-only branch).
        await prisma.product_inventory.create({
          data: { product_id: product.id, color_id: colorId, size_label: null, quantity: 10 },
        });
        await prisma.products.update({ where: { id: product.id }, data: { stock: 10 } });
      }

      imported.push({ id: product.id, name: data.name });
    } catch (err) {
      imported.push({ error: err.message, url });
      // Several in a row almost certainly means Mavi/Cloudflare is refusing
      // this IP now, not that each product is individually broken -- stop
      // rather than keep hitting it (which only prolongs a block).
      if (++consecutiveErrors >= 5) return void (stopped = true);
    }
    // Gentle pacing — every call here goes through the same Cloudflare WAF
    // that already hard-blocked rapid page navigations once.
    await new Promise(r => setTimeout(r, 700));
  });

  return { imported, skipped: notDiscounted + (candidateCodes.length - newCodes.length) };
}

// mClub (mclub.com.tr) is a Korean-cosmetics retailer carrying ~24 brands;
// only the brands in MCLUB_BRANDS are imported (the user's choice — MISSHA
// to start with). Unlike every other importer here it imports the brand's
// WHOLE catalog, not just discounted items: only products with a real price
// cut get tag 'discount', the rest are imported with no tag at all, sold at
// mClub's own price + site.markup_percent.
//
// The site is a React SPA whose own GET api.mclub.com.tr/home returns the
// ENTIRE catalog (all ~2800 products, ~5MB) in one response — every listing
// page is just a client-side filter over it — so a whole run is a single
// request, no per-product page visits at all. That matters: the API sits
// behind Akamai, and 6 parallel productDetail requests from one IP got
// "Access Denied" within seconds (confirmed live 2026-10-03). Unlike Mavi,
// it's fetched straight from Node, not in-page: Akamai answers headless
// Chrome's own fetch with a 403 (confirmed live), while a plain request with
// a browser User-Agent gets the full 200 response.
//
// Per-product fields used (the site's own minified names), confirmed against
// the storefront's own product-card render code:
//   n  = [name, Turkish subtitle, shade label, url slug, ...]
//   p  = list price; ci.cD > 0 renders p as a struck-through old price and
//        p - ci.cD as the current one; ci.eD > 0 is a "Sepette" (in-cart)
//        price of p - ci.eD. ci.c is a campaign label like "2 Al 1 Öde" —
//        NOT a price cut, and deliberately not treated as a discount (user's
//        choice: Shilista can't offer buy-2-pay-1).
//   s  = stock (the card shows "Gelince Haber Ver" when s <= 0)
//   fl = filter-value ids (Kategori / Ürün Tipi among them)
//   ic = image count: <id>.jpg, <id>-1.jpg ... <id>-(ic-1).jpg on the CDN
// At the time of writing no product in the whole catalog had cD or eD > 0,
// so every MISSHA product imports untagged until mClub runs a real sale.
const MCLUB_BRANDS = ['MISSHA'];
const MCLUB_IMAGE_BASE = 'https://imagemclub.sm.mncdn.com/products';
const MCLUB_MAX_IMAGES = 8;
const MCLUB_STOCK_PER_SHADE = 10;
const MCLUB_FILTER_KATEGORI = 1;
const MCLUB_FILTER_URUN_TIPI = 8;
const MCLUB_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// mClub's own "Ürün Tipi" (product type) value -> our Cosmetics (category 10)
// subcategory. Anchored on the exact type names where a loose match would
// misfire (e.g. "Göz Kremi" is skincare, not eye makeup), and makeup
// removers / sun creams pinned to skincare up front — Kategori alone sent
// "Perfect Lip & Eye Make Up Remover" to Lip and a sun mist to Body. Types not listed
// here (masks, serums, toners, "Set", "Mist", ...) fall back to the
// product's mClub "Kategori" below.
const MCLUB_TYPE_TO_SUBCATEGORY = [
  [/^(makyaj temizleme|cilt temizleme|güneş kremi)$/, 45],
  [/aksesuar|fırça|sünger|puf|yağ kontrol kağıdı/, 50],
  [/^(far|far paleti|maskara|eyeliner|göz kalemi|kaş kalemi|kaş maskarası|kirpik.*)$/, 43],
  [/^(ruj|tint|dudak kalemi|dudak bakımı|dolgunlaştırıcı|lip.*)$/, 44],
  [/^(bb krem|cc krem|cushion|fondöten|pudra|baz|allık|concelear|kapatıcı|bronzer\/contour|aydınlatıcı|highlighter|makyaj sabitleyici)$/, 42],
  [/şampuan|saç/, 46],
  [/vücut|el kremi|intim/, 47],
  [/parfüm/, 48],
  [/oje|tırnak/, 49],
];

function routeMClubSubcategory(typeNames, kategoriNames, name) {
  for (const t of typeNames) {
    const hit = MCLUB_TYPE_TO_SUBCATEGORY.find(([re]) => re.test(t));
    if (hit) return hit[1];
  }
  for (const k of kategoriNames) {
    if (k === 'cilt bakımı') return 45;
    if (k === 'saç bakımı') return 46;
    if (k === 'vücut bakımı' || k === 'kişisel bakım/hijyen') return 47;
    if (k === 'aksesuarlar') return 50;
    if (k === 'makyaj') return guessSubcategoryId(name, 10) || 42;
  }
  return guessSubcategoryId(name, 10);
}

// Fetches /home once and returns only MCLUB_BRANDS' products (trimmed to the
// fields used here) plus the Kategori/Ürün Tipi filter-value names their
// `fl` ids refer to.
async function fetchMClubCatalog() {
  const res = await fetch('https://api.mclub.com.tr/home', {
    headers: { 'User-Agent': MCLUB_USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`mClub API ${res.status} for /home`);
  const d = await res.json();
  const keep = new Set(MCLUB_BRANDS);
  const products = (d.products || []).filter(p => keep.has(p.m)).map(p => ({
    id: p._id, n: p.n, p: p.p, s: p.s, m: p.m, fl: p.fl, ic: p.ic, ci: p.ci,
  }));
  // A brand vanishing entirely is far more likely a changed API than a
  // brand dropped overnight — fail loudly rather than "import 0" quietly.
  if (!products.length) throw new Error(`mClub: /home had no products for ${MCLUB_BRANDS.join(', ')}`);
  const filterValues = {};
  for (const f of d.filters || []) {
    if (f.filtre_id !== MCLUB_FILTER_KATEGORI && f.filtre_id !== MCLUB_FILTER_URUN_TIPI) continue;
    for (const v of f.filtreDegerler || []) filterValues[v.fd_id] = { filterId: f.filtre_id, name: v.fd_ad };
  }
  return { products, filterValues };
}

// mClub lists every shade as its own product ("Modern Shadow Matte (101
// Pale Bloom)", "... (117 Pink Sis)", ...). These are grouped into ONE
// Shilista product with one color per shade (user's choice, same as Kiko)
// by name: the shade label n[2] sits in trailing parentheses of the name,
// so stripping it gives the shared base name. mClub's own grouping fields
// can't be used for this — `pr` and productDetail's `vl` were both
// confirmed live to lump unrelated products together (vl put BB cream
// shades and Time Revolution sample sachets in one 39-item group). Every
// base-name group checked had one identical price across all its shades.
function groupMClubShades(products) {
  const groups = new Map();
  for (const p of products) {
    const [fullName = '', subtitle = '', shade = '', slug = ''] = Array.isArray(p.n) ? p.n : [];
    const label = String(shade).trim();
    let base = String(fullName).trim();
    if (label) {
      base = base.replace(/\s*\(([^()]*)\)\s*$/, (m, inner) =>
        inner.trim().toLocaleLowerCase('tr') === label.toLocaleLowerCase('tr') ? '' : m).trim();
    }
    const key = `${p.m}|${base.toLocaleLowerCase('tr')}`;
    if (!groups.has(key)) groups.set(key, { base, members: [] });
    groups.get(key).members.push({
      ...p,
      fullName: String(fullName).trim(),
      subtitle: String(subtitle).trim(),
      label,
      url: `https://mclub.com.tr/${slug}-p-${p.id}`,
      inStock: Number(p.s) > 0,
    });
  }
  return [...groups.values()].map(g => {
    g.members.sort((a, b) => a.id - b.id);
    // Lowest-id in-stock shade stands for the whole group (price, images,
    // product_link) — stable from run to run as long as it stays in stock.
    g.rep = g.members.find(m => m.inStock) || g.members[0];
    g.name = g.members.length > 1 ? g.base : g.rep.fullName;
    return g;
  });
}

// Selling price is always mClub's current price + markup. Only a genuine
// price cut (ci.cD, or the in-cart ci.eD — taking the bigger one, they're
// never shown stacked) that still leaves the marked-up price under mClub's
// own list price gets tag 'discount' with the list price shown struck
// through; anything else is a plain untagged product (discounted_price
// null — the frontend only shows a discount when discounted_price < price).
function mclubPricing(member, markupPercent) {
  const listPrice = Number(member.p);
  const cut = Math.max(Number(member.ci?.cD) || 0, Number(member.ci?.eD) || 0);
  const sitePrice = Math.round((listPrice - cut) * 100) / 100;
  const finalPrice = Math.round(sitePrice * (1 + markupPercent / 100) * 100) / 100;
  if (cut > 0 && finalPrice < listPrice) {
    return { price: listPrice, discounted_price: finalPrice, cost_price: sitePrice, tag: 'discount' };
  }
  return { price: finalPrice, discounted_price: null, cost_price: sitePrice, tag: null };
}

// Shade labels are English shade names, often numbered ("101 Pale Bloom",
// "No.8 Stella Prism") — same shape as Kiko's, so they go through Kiko's
// en-source color helper (which already strips a leading shade number).
// A bare number ("No.17", BB cream shades) is kept whole, otherwise it
// would strip down to nothing and the shade would get no color at all.
async function getOrCreateMClubShadeColorId(rawLabel) {
  const label = rawLabel.replace(/^#\s*/, ''); // "#1 Rosy Rooftop" -> "1 Rosy Rooftop"
  if (/^no\.?\s*\d+$/i.test(label)) return getOrCreateKikoColorId(label);
  return getOrCreateKikoColorId(label.replace(/^no\.?\s*/i, ''));
}

async function mclubShadeColors(group) {
  if (group.members.length < 2) return [];
  const entries = [];
  const seen = new Map(); // color id -> entry (two labels can clean to one color)
  for (const m of group.members) {
    if (!m.label) continue;
    const colorId = await getOrCreateMClubShadeColorId(m.label);
    if (!colorId) continue;
    if (seen.has(colorId)) { seen.get(colorId).inStock ||= m.inStock; continue; }
    const entry = { colorId, inStock: m.inStock };
    seen.set(colorId, entry);
    entries.push(entry);
  }
  return entries;
}

async function MClub(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  const { products, filterValues } = await fetchMClubCatalog();
  const groups = groupMClubShades(products);

  const allUrls = groups.flatMap(g => g.members.map(m => m.url));
  const existing = await prisma.products.findMany({
    where: { product_link: { in: allUrls } },
    select: { product_link: true },
  });
  const existingSet = new Set(existing.map(e => e.product_link));
  const fresh = groups.filter(g => !g.members.some(m => existingSet.has(m.url)));
  // Nothing to sell yet — picked up by a later run once back in stock.
  const sellable = fresh.filter(g => g.members.some(m => m.inStock));
  // Real discounts first, so a sale is never stuck behind the plain backlog.
  sellable.sort((a, b) => (mclubPricing(b.rep, 0).tag ? 1 : 0) - (mclubPricing(a.rep, 0).tag ? 1 : 0));

  const imported = [];
  let consecutiveErrors = 0;
  let stopped = false;
  // One at a time, unlike every other importer: mClub's Akamai blocked
  // this IP for 20+ minutes over a burst of parallel requests once.
  await runQueue(sellable, [0], async (_worker, group) => {
    if (stopped) return;
    if (imported.filter(p => !p.error).length >= limit) return void (stopped = true);
    const url = group.rep.url;
    try {
      const pricing = mclubPricing(group.rep, site.markup_percent);

      const fl = Array.isArray(group.rep.fl) ? group.rep.fl : [];
      const namesFor = (filterId) => fl.map(id => filterValues[id])
        .filter(v => v && v.filterId === filterId)
        .map(v => v.name.toLocaleLowerCase('tr'));
      const subcategory_id = routeMClubSubcategory(
        namesFor(MCLUB_FILTER_URUN_TIPI), namesFor(MCLUB_FILTER_KATEGORI), group.name);

      // Names are English product names (K-beauty), the subtitle is Turkish.
      const nameTr = group.name.slice(0, 120);
      const subtitle = group.rep.subtitle;
      const translateOrWarn = (text, source, target) => translateText(text, source, target)
        .catch(err => { console.warn(`[siteImport] translate ${source}->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(group.name, 'en', 'fa'),
        subtitle ? translateOrWarn(subtitle, 'tr', 'fa') : '',
        subtitle ? translateOrWarn(subtitle, 'tr', 'en') : '',
      ]);

      const imageCount = Math.min(Math.max(Number(group.rep.ic) || 1, 1), MCLUB_MAX_IMAGES);
      const mediaUrls = [];
      for (let i = 0; i < imageCount; i++) {
        const imgUrl = `${MCLUB_IMAGE_BASE}/${group.rep.id}/${group.rep.id}${i ? '-' + i : ''}.jpg`;
        try { mediaUrls.push(await saveImageFromUrl(imgUrl)); } catch (e) { /* skip broken image */ }
      }

      const colorEntries = await mclubShadeColors(group);
      const stock = colorEntries.length
        ? colorEntries.filter(c => c.inStock).length * MCLUB_STOCK_PER_SHADE
        : (group.rep.inStock ? MCLUB_STOCK_PER_SHADE : 0);

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id: 10, subcategory_id,
          gender: 'unisex',
          name_fa: name_fa.slice(0, 120), name_en: nameTr, name_tr: nameTr,
          desc_fa, desc_en, desc_tr: subtitle || null,
          price: pricing.price,
          discounted_price: pricing.discounted_price,
          cost_price: pricing.cost_price,
          tag: pricing.tag,
          stock,
          brand: group.rep.m,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
          product_colors: colorEntries.length ? { create: colorEntries.map(c => ({ color_id: c.colorId, is_available: c.inStock })) } : undefined,
        },
      });
      if (colorEntries.length) {
        await prisma.product_inventory.createMany({
          data: colorEntries.map(c => ({
            product_id: product.id, color_id: c.colorId, size_label: null,
            quantity: c.inStock ? MCLUB_STOCK_PER_SHADE : 0,
          })),
        });
      }
      imported.push({ id: product.id, name: group.name });
      consecutiveErrors = 0;
    } catch (err) {
      imported.push({ error: err.message, url });
      // The same failure on every group (e.g. a DB constraint) would
      // otherwise walk the whole ~400-group backlog, downloading images
      // and spending translation quota for each one before failing it.
      if (++consecutiveErrors >= 5) return void (stopped = true);
    }
  });

  return { imported, skipped: (groups.length - fresh.length) + (fresh.length - sellable.length) };
}

// mClub's stock check (called from siteSync.js#checkSiteStock instead of its
// generic Defacto-page reader): re-reads the same single /home response and
// brings every already-imported product's price, discount tag and per-shade
// stock up to date — this is what tags a product 'discount' once mClub
// starts a sale on something imported earlier untagged, and untags it when
// the sale ends. Admin-set 'bestseller'/'new' tags are left alone unless a
// discount or sell-out has to take their place.
async function checkMClubStock(site, products) {
  const { products: catalog } = await fetchMClubCatalog();
  const groupByUrl = new Map();
  for (const g of groupMClubShades(catalog)) for (const m of g.members) groupByUrl.set(m.url, g);

  const results = [];
  for (const p of products) {
    try {
      const group = groupByUrl.get(p.product_link);
      const pricing = group
        ? mclubPricing(group.members.find(m => m.inStock) || group.rep, site.markup_percent)
        : null;

      // Gone from mClub's catalog entirely = can't be bought anymore.
      let totalStock = 0;
      if (group) {
        const colorEntries = await mclubShadeColors(group);
        if (colorEntries.length) {
          for (const c of colorEntries) {
            const quantity = c.inStock ? MCLUB_STOCK_PER_SHADE : 0;
            await prisma.product_inventory.updateMany({ where: { product_id: p.id, color_id: c.colorId }, data: { quantity } });
            await prisma.product_colors.updateMany({ where: { product_id: p.id, color_id: c.colorId }, data: { is_available: c.inStock } });
          }
          totalStock = colorEntries.filter(c => c.inStock).length * MCLUB_STOCK_PER_SHADE;
        } else {
          totalStock = group.members.some(m => m.inStock) ? MCLUB_STOCK_PER_SHADE : 0;
        }
      }

      const keepAdminTag = ['bestseller', 'new'].includes(p.tag) ? p.tag : null;
      const tag = totalStock === 0 ? 'sold_out' : (pricing.tag || keepAdminTag);
      const update = {};
      if (pricing) {
        if (Number(p.price) !== pricing.price) update.price = pricing.price;
        if ((p.discounted_price == null ? null : Number(p.discounted_price)) !== pricing.discounted_price) update.discounted_price = pricing.discounted_price;
        if (Number(p.cost_price) !== pricing.cost_price) update.cost_price = pricing.cost_price;
      }
      if (p.stock !== totalStock) update.stock = totalStock;
      if (p.tag !== tag) {
        update.tag = tag;
        // Stamped only on the transition into sold_out (see scheduler.js's
        // deactivateExpiredSoldOutProducts), cleared when it comes back.
        update.sold_out_at = tag === 'sold_out' ? new Date() : null;
      }
      if (Object.keys(update).length) {
        await prisma.products.update({ where: { id: p.id }, data: { ...update, is_dirty: true, updated_at: new Date() } });
      }
      results.push({
        id: p.id, name: p.name_tr,
        status: tag === 'sold_out' ? 'sold_out' : `ok (stock=${totalStock})${Object.keys(update).length ? ', updated' : ''}`,
      });
    } catch (err) {
      results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
    }
  }
  return results;
}

// ArmaLife (armalife.com.tr, women's clothing only) runs on the Farktor
// e-commerce platform. Its listing pages fill themselves from Farktor's own
// public JSON API (farktorapi.com/new/?company=...), which with no category
// filter pages through the ENTIRE catalog — one entry per color, each with
// its list price (priceMarket), current price (priceSale), images and
// per-size stock — so no page is ever opened here. Plain Node fetch works.
//
// User's choice: import the whole catalog, not just discounted items; tag
// 'discount' only when ArmaLife's own cut, as a percent of its list price,
// is bigger than site.markup_percent — same comparison as case (a) of
// resolveDiscountTag. Everything else imports untagged at its current price
// + markup (discounted_price null), like MClub.
const ARMALIFE_API = 'https://farktorapi.com/new/';
const ARMALIFE_COMPANY = 'Fr-5500172';
const ARMALIFE_PAGE_SIZE = 60;
const ARMALIFE_MAX_PAGES = 200;
const ARMALIFE_IMAGE_BASE = 'https://farktorcdn.com/Library/Upl/5500172/Product/';
const ARMALIFE_MAX_GALLERY_IMAGES = 14;
const ARMALIFE_MAX_STOCK_PER_SIZE = 10;

// ArmaLife's own "Alt Ürün Grubu" style class (cl 08) -> our Clothing
// subcategory. Types with no matching subcategory of ours (Bluz, Body,
// Gömlek, Elbise, Etek, Takım, ...) stay null.
const ARMALIFE_TYPE_TO_SUBCATEGORY = {
  't-shirt': 1,
  'şort': 2,
  'pantolon': 3, 'eşofman': 3,
  'tayt': 4,
  'sweatshirt': 5, 'kazak': 5, 'hırka': 5,
  'ceket': 6, 'yelek': 6, 'kaban': 6, 'mont': 6, 'trençkot': 6,
};

function armalifeClass(card, cl) {
  return (card.classes || []).find(c => c.cl === cl)?.value?.trim() || '';
}

function routeArmaLifeCategory(card) {
  const type = armalifeClass(card, '08').toLocaleLowerCase('tr');
  if (armalifeClass(card, '07').toLocaleLowerCase('tr') === 'aksesuar') {
    return { category_id: 3, subcategory_id: type === 'çanta' ? 13 : null };
  }
  return { category_id: 1, subcategory_id: ARMALIFE_TYPE_TO_SUBCATEGORY[type] ?? guessSubcategoryId(card.name, 1) };
}

// About a third of the names are ArmaLife's raw ERP description instead of
// a display name: "ARMALIFE 1706 ASKILI ÇITÇITLI ESNEK KADIN BODYSUIT" or
// "ARMALIFE 1644-1 ...". Turkish-lowercasing turns the plain I of English
// loanwords into ı ("T-Shırt"), so those few words are put back.
const ARMALIFE_ENGLISH_WORDS = /^(t-shırt|shırt|sweatshırt|bodysuıt|premıum|denım|bıker|slım|fıt|basıc|vıntage|skınny|chıno|mını)$/;
function cleanArmaLifeName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n !== n.toLocaleUpperCase('tr')) return n;
  return n.replace(/^ARMALIFE\s+[\d-]+\s+/i, '')
    .toLocaleLowerCase('tr')
    .split(' ').map(w => (ARMALIFE_ENGLISH_WORDS.test(w) ? w.replace(/ı/g, 'i') : w)).join(' ')
    .replace(/(^|[\s(/-])(\S)/g, (m, sep, ch) => sep + ch.toLocaleUpperCase('tr'));
}

// The product facts ArmaLife lists on the product page (material, fit,
// sleeve, collar, ...) — its own `desc` field is just the ERP name again.
const ARMALIFE_DESC_CLASSES = ['38', '33', '34', '46', '36', '41', '42', '39', '44'];
function armalifeDescription(card) {
  return ARMALIFE_DESC_CLASSES.map(cl => (card.classes || []).find(c => c.cl === cl))
    .filter(c => c && c.clValue && c.value && !/mevcut değil/i.test(c.value))
    .map(c => `${c.clValue}: ${c.value}`)
    .join('\n');
}

// Sizes with stock, minus the bogus "0" size a few cards carry.
function armalifeSizes(card) {
  return (card.sizes || [])
    .filter(s => s.name && s.name.trim() !== '0')
    .map(s => ({ ...s, label: s.name.trim().slice(0, 10), qty: Math.max(Number(s.qty) || 0, 0) }));
}

// Pages through the whole catalog. The API repeats a few cards across
// pages, so it's deduped by modelCode (one per product color).
async function fetchArmaLifeCatalog() {
  const cards = new Map();
  let total = null;
  let seen = 0;
  for (let page = 1; page <= ARMALIFE_MAX_PAGES; page++) {
    const url = `${ARMALIFE_API}?company=${ARMALIFE_COMPANY}&page=${page}&pageSize=${ARMALIFE_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': MCLUB_USER_AGENT, Accept: 'application/json', Referer: 'https://www.armalife.com.tr/' },
    });
    if (!res.ok) throw new Error(`ArmaLife API ${res.status} for page ${page}`);
    const d = await res.json();
    total = d.size;
    const products = d.products || [];
    for (const p of products) if (p.modelCode && !cards.has(p.modelCode)) cards.set(p.modelCode, p);
    seen += products.length;
    if (!products.length || seen >= total) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!cards.size) throw new Error('ArmaLife: catalog API returned no products');
  return [...cards.values()];
}

// Every Farktor product id belonging to this color (one per size, plus the
// one its own color switcher links to) — any of them in a stored
// product_link's "_<id>" suffix points at this color.
function armalifeIds(card) {
  const ids = new Set((card.sizes || []).map(s => String(s.productId)));
  ids.add(String(card.productId));
  const own = (card.colors || []).find(c => c.modelCodes === card.modelCode);
  if (own) ids.add(String(own.productId));
  return ids;
}

function armalifeLinkId(link) {
  return String(link || '').match(/_(\d+)$/)?.[1] || null;
}

function armalifeUrl(card) {
  const own = (card.colors || []).find(c => c.modelCodes === card.modelCode);
  return `https://www.armalife.com.tr/tr/${card.seoUrl}_${own ? own.productId : card.productId}`;
}

function armalifeColorName(card) {
  const own = (card.colors || []).find(c => c.modelCodes === card.modelCode);
  return own?.colorName || card.classSubName || null;
}

// User's choice: every color of one ArmaLife model is ONE Shilista product
// (one color entry each, per color x size stock), not one product per
// color. Grouped by productCode — every card's modelCode is its
// productCode + color, and checked live that each group is a single
// style. (Each card's own `colors` list can't be used for this: it misses
// some sibling colors.)
function groupArmaLifeCatalog(catalog) {
  const groups = new Map();
  for (const card of catalog) {
    const key = card.productCode || card.modelCode;
    if (!groups.has(key)) groups.set(key, { key, members: [] });
    groups.get(key).members.push(card);
  }
  return [...groups.values()].map(g => {
    const inStock = c => armalifeSizes(c).some(s => s.qty > 0);
    g.members.sort((a, b) => (inStock(b) - inStock(a)) || String(a.modelCode).localeCompare(String(b.modelCode)));
    g.rep = g.members[0];
    g.inStock = g.members.some(inStock);
    g.ids = new Set(g.members.flatMap(c => [...armalifeIds(c)]));
    // Siblings often carry the proper display name while one color still
    // has the raw ERP one ("ARMALIFE 0142 TAM BALIKÇI ...").
    const display = g.members.find(c => c.name && c.name !== c.name.toLocaleUpperCase('tr'));
    g.name = cleanArmaLifeName((display || g.rep).name);
    return g;
  });
}

// A handful of cards price some sizes differently from the card itself
// (e.g. card 290 TL, size M 499.99 TL). Costing off the most expensive
// in-stock size never sells a size below what ArmaLife charges for it.
function armalifePricing(card, markupPercent) {
  const inStock = armalifeSizes(card).filter(s => s.qty > 0);
  const sizePrices = inStock.map(s => Number(s.priceSale)).filter(n => n > 0);
  const sitePrice = Math.max(Number(card.priceSale) || 0, ...sizePrices);
  const listPrice = Math.max(Number(card.priceMarket) || 0, sitePrice);
  const finalPrice = Math.round(sitePrice * (1 + markupPercent / 100) * 100) / 100;
  const discountPct = listPrice > 0 ? (listPrice - sitePrice) / listPrice * 100 : 0;
  if (discountPct > markupPercent) {
    return { price: listPrice, discounted_price: finalPrice, cost_price: sitePrice, tag: 'discount' };
  }
  return { price: finalPrice, discounted_price: null, cost_price: sitePrice, tag: null };
}

// Priced off the most expensive in-stock color — the 12 or so models
// whose colors are priced differently then never sell one below cost.
function armalifeGroupPricing(group, markupPercent) {
  const candidates = group.members.filter(c => armalifeSizes(c).some(s => s.qty > 0));
  const priced = (candidates.length ? candidates : group.members).map(c => armalifePricing(c, markupPercent));
  return priced.reduce((best, p) => (p.cost_price > best.cost_price ? p : best));
}

// The rep color's full photo set first, then the first two photos (front
// and back) of every other color, so each color can be seen in the gallery
// — product_media has no color link to swap photos per selected color.
function armalifeGroupPhotos(group) {
  const photosOf = c => String(c.photoAll || c.photo || '').split('||').map(p => p.trim()).filter(Boolean);
  const list = [...photosOf(group.rep)];
  for (const c of group.members.slice(1)) {
    if (!armalifeSizes(c).some(s => s.qty > 0)) continue;
    list.push(...photosOf(c).slice(0, 2));
  }
  return [...new Set(list)].slice(0, ARMALIFE_MAX_GALLERY_IMAGES);
}

// Rebuilds a product's colors, sizes and per color x size stock from its
// ArmaLife group. Nothing references these rows by id (cart/order items
// store the color and size label themselves), so replacing them outright is
// safe — and it's what adds a color ArmaLife launches after the import.
// Two ArmaLife colors can land on one of our colors ("Siyah", "Siyah
// Puantiye" -> siyah): their stock is merged. Rows are only rewritten
// when something actually changed. Returns { stock, changed }.
async function writeArmaLifeVariants(productId, group) {
  const byColor = new Map(); // colorId -> Map(label -> qty)
  const sizeOrder = [];
  for (const card of group.members) {
    const colorId = await getOrCreateColorId(armalifeColorName(card));
    if (!byColor.has(colorId)) byColor.set(colorId, new Map());
    const qtys = byColor.get(colorId);
    for (const s of armalifeSizes(card)) {
      if (!sizeOrder.includes(s.label)) sizeOrder.push(s.label);
      qtys.set(s.label, Math.max(qtys.get(s.label) || 0, Math.min(s.qty, ARMALIFE_MAX_STOCK_PER_SIZE)));
    }
  }
  const inventory = [];
  for (const [colorId, qtys] of byColor) {
    for (const label of sizeOrder) inventory.push({ product_id: productId, color_id: colorId, size_label: label, quantity: qtys.get(label) || 0 });
  }
  const colorRows = [...byColor].filter(([colorId]) => colorId != null)
    .map(([colorId, qtys]) => ({ product_id: productId, color_id: colorId, is_available: [...qtys.values()].some(q => q > 0) }));
  const sizeRows = sizeOrder.map(label => ({
    product_id: productId, size_label: label,
    is_available: inventory.some(i => i.size_label === label && i.quantity > 0),
  }));
  const sig = rows => rows.map(r => `${r.color_id}|${r.size_label}|${r.quantity}`).sort().join(',');
  const current = await prisma.product_inventory.findMany({ where: { product_id: productId } });
  const stock = inventory.reduce((sum, i) => sum + i.quantity, 0);
  if (sig(current) === sig(inventory)) return { stock, changed: false };
  await prisma.$transaction([
    prisma.product_inventory.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.deleteMany({ where: { product_id: productId } }),
    prisma.product_sizes.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.createMany({ data: colorRows }),
    prisma.product_sizes.createMany({ data: sizeRows }),
    prisma.product_inventory.createMany({ data: inventory }),
  ]);
  return { stock, changed: true };
}

async function ArmaLife(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  const groups = groupArmaLifeCatalog(await fetchArmaLifeCatalog());

  const existing = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null } },
    select: { product_link: true },
  });
  const existingIds = new Set(existing.map(e => armalifeLinkId(e.product_link)).filter(Boolean));
  // Any color of the model already imported = the whole model is (its
  // other colors get added by the stock check / merge script instead).
  const fresh = groups.filter(g => ![...g.ids].some(id => existingIds.has(id)));
  // Nothing to sell yet — picked up by a later run once back in stock.
  const sellable = fresh.filter(g => g.inStock);
  // Real discounts first, so a sale is never stuck behind the plain backlog.
  const isDiscount = g => armalifeGroupPricing(g, site.markup_percent).tag === 'discount';
  sellable.sort((a, b) => isDiscount(b) - isDiscount(a));

  const imported = [];
  let consecutiveErrors = 0;
  let stopped = false;
  await runQueue(sellable, IMPORT_WORKER_SLOTS, async (_worker, group) => {
    if (stopped) return;
    if (imported.filter(p => !p.error).length >= limit) return void (stopped = true);
    const url = armalifeUrl(group.rep);
    try {
      const pricing = armalifeGroupPricing(group, site.markup_percent);
      const { category_id, subcategory_id } = routeArmaLifeCategory(group.rep);
      const description = armalifeDescription(group.rep);

      const translateOrWarn = (text, target) => translateText(text, 'tr', target)
        .catch(err => { console.warn(`[siteImport] translate tr->${target} failed for "${text.slice(0, 40)}...": ${err.message}`); return ''; });
      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateOrWarn(group.name, 'fa'),
        translateOrWarn(group.name, 'en'),
        description ? translateOrWarn(description, 'fa') : '',
        description ? translateOrWarn(description, 'en') : '',
      ]);
      const nameTr = group.name.slice(0, 120);

      const mediaUrls = [];
      for (const photo of armalifeGroupPhotos(group)) {
        try { mediaUrls.push(await saveImageFromUrl(ARMALIFE_IMAGE_BASE + photo)); } catch (e) { /* skip broken image */ }
      }

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id, subcategory_id,
          gender: 'female',
          name_fa: (name_fa || nameTr).slice(0, 120), name_en: (name_en || nameTr).slice(0, 120), name_tr: nameTr,
          desc_fa, desc_en, desc_tr: description || null,
          price: pricing.price,
          discounted_price: pricing.discounted_price,
          cost_price: pricing.cost_price,
          tag: pricing.tag,
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
        },
      });
      const { stock } = await writeArmaLifeVariants(product.id, group);
      await prisma.products.update({ where: { id: product.id }, data: { stock } });
      imported.push({ id: product.id, name: nameTr });
      consecutiveErrors = 0;
    } catch (err) {
      imported.push({ error: err.message, url });
      if (++consecutiveErrors >= 5) return void (stopped = true);
    }
  });

  return { imported, skipped: (groups.length - fresh.length) + (fresh.length - sellable.length) };
}

// ArmaLife's stock check (called from siteSync.js#checkSiteStock instead of
// its generic Defacto-page reader): re-reads the same catalog API and brings
// every imported product's price, discount tag, colors and per color x size
// stock up to date — tags a product 'discount' once ArmaLife cuts its price
// far enough, untags it when the sale ends, and adds colors ArmaLife adds
// later. Admin-set 'bestseller'/'new' tags are left alone unless a discount
// or sell-out has to take their place.
async function checkArmaLifeStock(site, products) {
  const groupById = new Map();
  for (const g of groupArmaLifeCatalog(await fetchArmaLifeCatalog())) for (const id of g.ids) groupById.set(id, g);

  const results = [];
  for (const p of products) {
    try {
      // Gone from ArmaLife's catalog entirely = can't be bought anymore.
      const group = groupById.get(armalifeLinkId(p.product_link));
      const pricing = group ? armalifeGroupPricing(group, site.markup_percent) : null;
      let totalStock = 0;
      let variantsChanged = false;
      if (group) {
        ({ stock: totalStock, changed: variantsChanged } = await writeArmaLifeVariants(p.id, group));
      } else {
        await prisma.product_inventory.updateMany({ where: { product_id: p.id }, data: { quantity: 0 } });
        await prisma.product_sizes.updateMany({ where: { product_id: p.id }, data: { is_available: false } });
        await prisma.product_colors.updateMany({ where: { product_id: p.id }, data: { is_available: false } });
      }

      const keepAdminTag = ['bestseller', 'new'].includes(p.tag) ? p.tag : null;
      const tag = totalStock === 0 ? 'sold_out' : (pricing.tag || keepAdminTag);
      const update = {};
      if (pricing) {
        if (Number(p.price) !== pricing.price) update.price = pricing.price;
        if ((p.discounted_price == null ? null : Number(p.discounted_price)) !== pricing.discounted_price) update.discounted_price = pricing.discounted_price;
        if (Number(p.cost_price) !== pricing.cost_price) update.cost_price = pricing.cost_price;
      }
      if (p.stock !== totalStock) update.stock = totalStock;
      if (p.tag !== tag) {
        update.tag = tag;
        // Stamped only on the transition into sold_out (see scheduler.js's
        // deactivateExpiredSoldOutProducts), cleared when it comes back.
        update.sold_out_at = tag === 'sold_out' ? new Date() : null;
      }
      // Rewritten variant rows alone also make the published copy stale.
      if (Object.keys(update).length || variantsChanged) {
        await prisma.products.update({ where: { id: p.id }, data: { ...update, is_dirty: true, updated_at: new Date() } });
      }
      results.push({
        id: p.id, name: p.name_tr,
        status: tag === 'sold_out' ? 'sold_out' : `ok (stock=${totalStock})${Object.keys(update).length || variantsChanged ? ', updated' : ''}`,
      });
    } catch (err) {
      results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
    }
  }
  return results;
}

// One-off for products imported before ArmaLife's colors were grouped
// (2026-10-05, one product per color): folds every color of a model into
// its oldest product — moves the other products' photos over, rebuilds its
// colors/sizes/stock from the whole model (adding colors that were never
// imported, with their first two photos), re-prices it, and deactivates the
// now-redundant products. Products of a single-color model also get any
// missing colors added. Dry run (nothing written) unless apply is true.
// Run via backend/scripts/mergeArmaLifeColors.js.
async function mergeArmaLifeColors(site, { apply = false } = {}) {
  const { syncSubcategoryActiveState } = require('./subcategorySync');
  const groupById = new Map();
  for (const g of groupArmaLifeCatalog(await fetchArmaLifeCatalog())) for (const id of g.ids) groupById.set(id, g);

  const products = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, is_active: true, product_link: { not: null } },
    orderBy: { id: 'asc' },
    include: { product_media: { orderBy: { sort_order: 'asc' } } },
  });
  const byGroup = new Map();
  const unmatched = [];
  for (const p of products) {
    const group = groupById.get(armalifeLinkId(p.product_link));
    if (!group) { unmatched.push(p); continue; }
    if (!byGroup.has(group.key)) byGroup.set(group.key, { group, products: [] });
    byGroup.get(group.key).products.push(p);
  }

  const log = [];
  for (const { group, products: ps } of byGroup.values()) {
    const [keeper, ...extras] = ps;
    // Colors no existing product came from still need photos of their own.
    const coveredIds = new Set(ps.map(p => armalifeLinkId(p.product_link)));
    const uncovered = group.members.filter(c => armalifeSizes(c).some(s => s.qty > 0)
      && ![...armalifeIds(c)].some(id => coveredIds.has(id)));
    log.push(`${keeper.code} "${group.name}": ${group.members.length} color(s), merging ${extras.length} product(s) [${extras.map(e => e.code).join(' ') || '-'}], adding photos for ${uncovered.length} new color(s)`);
    if (!apply) continue;

    let sort = keeper.product_media.length;
    for (const e of extras) {
      for (const m of e.product_media) {
        await prisma.product_media.update({ where: { id: m.id }, data: { product_id: keeper.id, sort_order: sort++ } });
      }
    }
    for (const c of uncovered) {
      const photos = String(c.photoAll || c.photo || '').split('||').map(x => x.trim()).filter(Boolean).slice(0, 2);
      for (const photo of photos) {
        try {
          const url = await saveImageFromUrl(ARMALIFE_IMAGE_BASE + photo);
          await prisma.product_media.create({ data: { product_id: keeper.id, type: 'image', url, sort_order: sort++ } });
        } catch (e) { /* skip broken image */ }
      }
    }

    const { stock } = await writeArmaLifeVariants(keeper.id, group);
    const pricing = armalifeGroupPricing(group, site.markup_percent);
    const keepAdminTag = ['bestseller', 'new'].includes(keeper.tag) ? keeper.tag : null;
    const tag = stock === 0 ? 'sold_out' : (pricing.tag || keepAdminTag);
    await prisma.products.update({
      where: { id: keeper.id },
      data: {
        name_tr: group.name.slice(0, 120),
        price: pricing.price, discounted_price: pricing.discounted_price, cost_price: pricing.cost_price,
        stock, tag,
        ...(tag !== keeper.tag ? { sold_out_at: tag === 'sold_out' ? new Date() : null } : {}),
        is_dirty: true, updated_at: new Date(),
      },
    });
    if (extras.length) {
      await prisma.products.updateMany({
        where: { id: { in: extras.map(e => e.id) } },
        data: { is_active: false, is_live: false, is_dirty: false, updated_at: new Date() },
      });
      for (const id of new Set(extras.map(e => e.subcategory_id).filter(Boolean))) await syncSubcategoryActiveState(id);
    }
  }
  for (const p of unmatched) log.push(`${p.code} "${p.name_tr}": not in ArmaLife's catalog anymore, left as is`);
  return log;
}

// Mango (shop.mango.com/tr) — its storefront sits behind a Vercel bot
// checkpoint (plain requests get 429/403), but the three JSON APIs the
// storefront itself calls answer plain Node fetch, so no page is opened:
//   - api.shop.mango.com .../catalogs/<id>/filters: every product+color of
//     one menu's "Tümünü görüntüle" list, in one response
//   - online-orchestrator.mango.com /v4/prices/products: per-color current
//     price, original price and Mango's own discountRate (ONE product per
//     call — it rejects lists)
//   - online-orchestrator.mango.com /v4/products + /v3/stock/products:
//     names (Turkish + English), families, colors, sizes, images, and
//     per color x size availability
// Discounts are spread across every menu (user: "too hame menuha
// promotion dare"), not one sale page, so every menu's full list is
// scanned and each product's price is checked. Only a color whose own
// stated discountRate is bigger than site.markup_percent counts — case (a)
// of resolveDiscountTag, like LCWaikiki/Koton. Every qualifying color of a
// product goes into ONE Shilista product (same as ArmaLife); colors that
// aren't discounted enough are left out, since they'd sell at the wrong
// price.
const MANGO_LIST_API = 'https://api.shop.mango.com/cs/product-lists-drive-thru/v4/channels/shop/countries/tr/catalogs';
const MANGO_ORCHESTRATOR = 'https://online-orchestrator.mango.com';
const MANGO_SITE = 'https://shop.mango.com';
const MANGO_MEDIA = 'https://media.mango.com';
const MANGO_STOCK_PER_SIZE = 10;
const MANGO_MAX_GALLERY_IMAGES = 14;
// Price lookups are one product per call — with ~10,000 products across
// every menu, a run with few discounts would otherwise check them all.
// Candidates are shuffled each run, so the whole catalog still gets
// covered across runs.
const MANGO_MAX_PRICE_LOOKUPS = 1500;

// Each menu's "Tümünü görüntüle" (view all) list. teenA/teenO = Teen
// girls/boys (adult XS-XL sizing, so filed as female/male, not kids).
const MANGO_CATALOGS = [
  { id: 'dest_vertodo_she', gender: 'female' },
  { id: 'dest_vertodo_he', gender: 'male' },
  { id: 'dest_vertodo_teenA', gender: 'female' },
  { id: 'dest_vertodo_teenO', gender: 'male' },
  { id: 'dest_vertodo_nina', gender: 'kids' },
  { id: 'dest_vertodo_nino', gender: 'kids' },
  { id: 'dest_vertodo_babyNina', gender: 'kids' },
  { id: 'dest_vertodo_babyNino', gender: 'kids' },
  { id: 'dest_vertodo_newborn', gender: 'kids' },
  { id: 'dest_vertodo_home', gender: 'unisex', home: true },
];

// Mango's main family label -> one of our Lifestyle subcategory slugs
// (LIFESTYLE_SUBCATEGORY_DEFS). Only used for products from the Home menu.
const MANGO_HOME_FAMILY_TO_SLUG = [
  [/banyo|havlu|bornoz/i, 'banyo'],
  [/halı|halıları/i, 'hali-kilim'],
  [/masa örtü/i, 'sofra'],
  [/mutfak/i, 'mutfak'],
  [/nevresim|çarşaf|yorgan|yastık|yatak|battaniye|beşik|dolgu/i, 'yatak-odasi'],
  [/kırlent|perde|living|dekorasyon|çocuk odası/i, 'dekorasyon'],
];

function routeMangoCategory(familyLabel, name, catalog) {
  const fam = familyLabel || '';
  if (/ayakkabı/i.test(fam)) return { category_id: 2, subcategory_id: null };
  if (/çanta|cüzdan|kalem kutu/i.test(fam)) return { category_id: 3, subcategory_id: /çanta/i.test(fam) ? 13 : null };
  if (/aksesuar|bijuteri|takı|kemer|gözlüğ|şapka|bere|atkı|eldiven|kravat|papyon/i.test(fam)) {
    return { category_id: 3, subcategory_id: null };
  }
  if (catalog.home) {
    const hit = MANGO_HOME_FAMILY_TO_SLUG.find(([re]) => re.test(fam));
    // Pyjamas, swimwear and the like also live under Home -> still clothing.
    if (hit || !/pijama|bikini|mayo/i.test(fam)) {
      return { category_id: LIFESTYLE_CATEGORY_ID, subcategory_id: hit ? getLifestyleSubcategoryId(hit[1]) : null };
    }
  }
  return { category_id: 1, subcategory_id: guessSubcategoryId(`${name} ${fam}`, 1) };
}

async function mangoGet(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': MCLUB_USER_AGENT, Accept: 'application/json', Origin: MANGO_SITE, Referer: MANGO_SITE + '/' },
  });
  if (!res.ok) throw new Error(`Mango API ${res.status} for ${new URL(url).pathname}`);
  return res.json();
}

const mangoPrices = (productId) => mangoGet(`${MANGO_ORCHESTRATOR}/v4/prices/products?channelId=shop&countryIso=TR&productId=${productId}`);
const mangoStock = (productId) => mangoGet(`${MANGO_ORCHESTRATOR}/v3/stock/products?countryIso=TR&channelId=shop&productId=${productId}`);
const mangoProduct = (productId) => mangoGet(`${MANGO_ORCHESTRATOR}/v4/products?countryIso=TR&channelId=shop&productId=${productId}&languageIso=tr`);

function mangoLinkProductId(link) {
  return String(link || '').match(/\/(\d{8})(?:[/?#]|$)/)?.[1] || null;
}

// Every color whose own discount clears the markup, with the pricing the
// product gets: the most expensive of those colors sets it, so no included
// color is ever sold below Mango's price for it. `availableColors` (a Set
// of color ids with at least one size in stock) narrows it further when
// known. Returns null when no color qualifies.
function mangoPricing(prices, markupPercent, availableColors = null) {
  const qualifying = [];
  for (const [colorId, byKey] of Object.entries(prices || {})) {
    const pr = byKey?.default;
    const original = Number(pr?.previousPrices?.originalShop);
    const current = Number(pr?.price);
    if (!pr || !(original > current) || !(current > 0)) continue;
    if (availableColors && !availableColors.has(colorId)) continue;
    const finalDiscountedPrice = Math.round(current * (1 + markupPercent / 100) * 100) / 100;
    const tag = resolveDiscountTag({
      discountPercentText: pr.discountRate != null ? String(pr.discountRate) : null,
      markupPercent, finalDiscountedPrice, priceOriginal: original,
    });
    if (tag === 'discount') qualifying.push({ colorId, original, current, finalDiscountedPrice });
  }
  if (!qualifying.length) return null;
  const top = qualifying.reduce((a, b) => (b.current > a.current ? b : a));
  return {
    colorIds: qualifying.map(q => q.colorId),
    price: top.original, discounted_price: top.finalDiscountedPrice, cost_price: top.current, tag: 'discount',
  };
}

function mangoAvailableColors(stock) {
  return new Set(Object.entries(stock?.colors || {})
    .filter(([, c]) => Object.values(c.sizes || {}).some(s => s.available))
    .map(([colorId]) => colorId));
}

// Image paths for one color, model shots first, de-duplicated (several
// keys point at the same picture).
function mangoColorImages(color) {
  const looks = color?.looks || {};
  const look = looks['00'] || Object.values(looks)[0];
  return [...new Set(Object.values(look?.images || {}).map(i => i.img).filter(Boolean))];
}

// Rebuilds a Mango product's colors, sizes and per color x size stock for
// `colorIds` (same approach as writeArmaLifeVariants: nothing references
// these rows by id). Rows are only rewritten when something changed.
// Returns { stock, changed }.
async function writeMangoVariants(productId, detail, stock, colorIds) {
  const inventory = [];
  const sizeOrder = [];
  const colorRows = new Map();
  for (const color of (detail.colors || []).filter(c => colorIds.includes(c.id))) {
    const colorId = await getOrCreateColorId(color.label);
    const sizes = color.sizes || [];
    for (const s of sizes) {
      const label = String(s.shortDescription || s.label || '').trim().slice(0, 10);
      if (!label) continue;
      if (!sizeOrder.includes(label)) sizeOrder.push(label);
      const available = !!stock?.colors?.[color.id]?.sizes?.[s.id]?.available;
      const existing = inventory.find(i => i.color_id === colorId && i.size_label === label);
      if (existing) { if (available) existing.quantity = MANGO_STOCK_PER_SIZE; continue; }
      inventory.push({ product_id: productId, color_id: colorId, size_label: label, quantity: available ? MANGO_STOCK_PER_SIZE : 0 });
    }
    if (colorId != null) {
      const anyAvailable = inventory.some(i => i.color_id === colorId && i.quantity > 0);
      colorRows.set(colorId, { product_id: productId, color_id: colorId, is_available: anyAvailable || !!colorRows.get(colorId)?.is_available });
    }
  }
  const sizeRows = sizeOrder.map(label => ({
    product_id: productId, size_label: label,
    is_available: inventory.some(i => i.size_label === label && i.quantity > 0),
  }));
  const total = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const sig = rows => rows.map(r => `${r.color_id}|${r.size_label}|${r.quantity}`).sort().join(',');
  const current = await prisma.product_inventory.findMany({ where: { product_id: productId } });
  if (sig(current) === sig(inventory)) return { stock: total, changed: false };
  await prisma.$transaction([
    prisma.product_inventory.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.deleteMany({ where: { product_id: productId } }),
    prisma.product_sizes.deleteMany({ where: { product_id: productId } }),
    prisma.product_colors.createMany({ data: [...colorRows.values()] }),
    prisma.product_sizes.createMany({ data: sizeRows }),
    prisma.product_inventory.createMany({ data: inventory }),
  ]);
  return { stock: total, changed: true };
}

async function Mango(pm, site, opts = {}) {
  const limit = opts.limit || 30;
  await seedLifestyleSubcategories();

  // Every product once, under the first menu that lists it.
  const candidates = new Map(); // productId -> catalog
  for (const catalog of MANGO_CATALOGS) {
    let list;
    try {
      list = await mangoGet(`${MANGO_LIST_API}/${catalog.id}/filters?languageIso=tr`);
    } catch (err) {
      console.warn(`[siteImport] Mango list ${catalog.id} failed, skipping: ${err.message}`);
      continue;
    }
    for (const item of list.items || []) {
      if (item.productId && !candidates.has(item.productId)) candidates.set(item.productId, catalog);
    }
  }
  if (!candidates.size) throw new Error('Mango: every catalog list failed or came back empty');

  const existing = await prisma.products.findMany({
    where: { supplier_shop_name: site.name, product_link: { not: null } },
    select: { product_link: true },
  });
  const existingIds = new Set(existing.map(e => mangoLinkProductId(e.product_link)).filter(Boolean));
  const fresh = [...candidates.keys()].filter(id => !existingIds.has(id));
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }

  const imported = [];
  let notDiscounted = 0;
  let lookups = 0;
  let consecutiveErrors = 0;
  let stopped = false;
  await runQueue(fresh, IMPORT_WORKER_SLOTS, async (_worker, productId) => {
    if (stopped) return;
    if (imported.filter(p => !p.error).length >= limit || lookups >= MANGO_MAX_PRICE_LOOKUPS) return void (stopped = true);
    lookups++;
    let url = `${MANGO_SITE}/tr/tr/p/${productId}`;
    try {
      const prices = await mangoPrices(productId);
      // Cheap first pass on price alone — most products stop here.
      if (!mangoPricing(prices, site.markup_percent)) { notDiscounted++; consecutiveErrors = 0; return; }
      const stock = await mangoStock(productId);
      const pricing = mangoPricing(prices, site.markup_percent, mangoAvailableColors(stock));
      if (!pricing) { notDiscounted++; consecutiveErrors = 0; return; }

      const detail = await mangoProduct(productId);
      if (detail.url) url = MANGO_SITE + detail.url;
      const catalog = candidates.get(productId);
      const mainFamily = (detail.families || []).find(f => f.isMainFamily) || (detail.families || [])[0];
      const nameTr = String(detail.name || '').trim();
      const nameEn = String(detail.nameEn || nameTr).trim();
      if (!nameTr) throw new Error('no product name');
      const { category_id, subcategory_id } = routeMangoCategory(mainFamily?.label, nameTr, catalog);

      // Mango's own English name is better input for Farsi than Turkish.
      const name_fa = await translateText(nameEn, 'en', 'fa')
        .catch(err => { console.warn(`[siteImport] translate en->fa failed for "${nameEn.slice(0, 40)}...": ${err.message}`); return ''; });

      const colors = (detail.colors || []).filter(c => pricing.colorIds.includes(c.id));
      const photos = [...mangoColorImages(colors[0]).slice(0, 8)];
      for (const c of colors.slice(1)) photos.push(...mangoColorImages(c).slice(0, 2));
      const mediaUrls = [];
      for (const img of [...new Set(photos)].slice(0, MANGO_MAX_GALLERY_IMAGES)) {
        try { mediaUrls.push(await saveImageFromUrl(`${MANGO_MEDIA}${img}?wid=1200`)); } catch (e) { /* skip broken image */ }
      }

      const product = await prisma.products.create({
        data: {
          code: await generateProductCode(),
          category_id, subcategory_id,
          gender: catalog.gender,
          name_fa: (name_fa || nameEn).slice(0, 120), name_en: nameEn.slice(0, 120), name_tr: nameTr.slice(0, 120),
          price: pricing.price,
          discounted_price: pricing.discounted_price,
          cost_price: pricing.cost_price,
          tag: pricing.tag,
          stock: 0,
          brand: site.name,
          supplier_shop_name: site.name,
          product_link: url,
          product_media: mediaUrls.length ? { create: mediaUrls.map((u, i) => ({ type: 'image', url: u, sort_order: i })) } : undefined,
        },
      });
      const { stock: total } = await writeMangoVariants(product.id, detail, stock, pricing.colorIds);
      await prisma.products.update({ where: { id: product.id }, data: { stock: total } });
      imported.push({ id: product.id, name: nameTr });
      consecutiveErrors = 0;
    } catch (err) {
      imported.push({ error: err.message, url });
      // The same failure on every product (an API change, a block) would
      // otherwise burn the whole lookup budget one error at a time.
      if (++consecutiveErrors >= 5) return void (stopped = true);
    }
  });

  return { imported, skipped: notDiscounted + (candidates.size - fresh.length) };
}

// Mango's stock check (called from siteSync.js#checkSiteStock instead of
// its generic Defacto-page reader): re-reads each imported product's
// prices and stock. A product whose discount ended (or no longer clears the
// markup) is taken off the site — Mango's price went back up, so selling
// it at the old discounted price would be selling below cost. Otherwise
// re-prices it and refreshes its per color x size stock.
async function checkMangoStock(site, products) {
  const { syncSubcategoryActiveState } = require('./subcategorySync');
  const results = [];
  for (const p of products) {
    try {
      const productId = mangoLinkProductId(p.product_link);
      if (!productId) { results.push({ id: p.id, name: p.name_tr, status: 'skipped (no Mango id in link)' }); continue; }
      const [prices, stock] = await Promise.all([mangoPrices(productId), mangoStock(productId)]);
      const pricing = mangoPricing(prices, site.markup_percent, mangoAvailableColors(stock));
      if (!pricing) {
        await prisma.products.update({
          where: { id: p.id },
          data: { is_active: false, is_live: false, is_dirty: false, updated_at: new Date() },
        });
        if (p.subcategory_id) await syncSubcategoryActiveState(p.subcategory_id);
        results.push({ id: p.id, name: p.name_tr, status: 'deactivated (discount ended or sold out)' });
        continue;
      }
      const detail = await mangoProduct(productId);
      const { stock: totalStock, changed } = await writeMangoVariants(p.id, detail, stock, pricing.colorIds);

      const keepAdminTag = ['bestseller', 'new'].includes(p.tag) ? p.tag : null;
      const tag = totalStock === 0 ? 'sold_out' : (pricing.tag || keepAdminTag);
      const update = {};
      if (Number(p.price) !== pricing.price) update.price = pricing.price;
      if ((p.discounted_price == null ? null : Number(p.discounted_price)) !== pricing.discounted_price) update.discounted_price = pricing.discounted_price;
      if (Number(p.cost_price) !== pricing.cost_price) update.cost_price = pricing.cost_price;
      if (p.stock !== totalStock) update.stock = totalStock;
      if (p.tag !== tag) {
        update.tag = tag;
        update.sold_out_at = tag === 'sold_out' ? new Date() : null;
      }
      if (Object.keys(update).length || changed) {
        await prisma.products.update({ where: { id: p.id }, data: { ...update, is_dirty: true, updated_at: new Date() } });
      }
      results.push({
        id: p.id, name: p.name_tr,
        status: tag === 'sold_out' ? 'sold_out' : `ok (stock=${totalStock})${Object.keys(update).length || changed ? ', updated' : ''}`,
      });
    } catch (err) {
      results.push({ id: p.id, name: p.name_tr, status: `error: ${err.message}` });
    }
  }
  return results;
}

module.exports = {
  Defacto, MadameCoco, Zara, LCWaikiki, Koton, KikoMilano, Lefties, Mavi, MClub, ArmaLife, Mango,
  // exported for siteSync.js#checkSiteStock, which hands mClub's, ArmaLife's,
  // Mango's and Lefties' stock checks off to their own API-based readers.
  checkMClubStock, checkArmaLifeStock, checkMangoStock, checkLeftiesStock,
  // exported for backend/scripts/mergeArmaLifeColors.js.
  mergeArmaLifeColors,
  // exported for backend/scripts/backfillMissingColors.js — reusing the
  // same lookup/create logic the live importers use, rather than
  // duplicating it in the backfill script.
  extractLeadingColorWord, getOrCreateColorId,
  // exported for backend/scripts/backfillMissingProductImages.js — same
  // download+compress+save logic the live importers use.
  saveImageFromUrl,
};
