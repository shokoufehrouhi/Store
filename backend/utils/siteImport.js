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
  let skipped = candidateUrls.length - newUrls.length;

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
      // site.markup_percent is applied on top of the source's already-
      // discounted price — with a large enough markup that marked-up price
      // can end up ABOVE the source's original price, which would show
      // customers a "discount" that's actually more expensive than the
      // "original" price on the same page. Never import (or keep visible)
      // something in that state.
      if (discountedPrice > priceOriginal) { skipped++; continue; }
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
      // Markup on top of an already-discounted price can push the marked-up
      // price above the source's original price — never import something
      // whose "discount" would show as more expensive than its "original".
      if (discountedPrice > priceOriginal) { notDiscounted++; continue; }
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
      // Markup on top of an already-discounted price can push the marked-up
      // price above the source's original price — never import something
      // whose "discount" would show as more expensive than its "original".
      if (finalDiscountedPrice > priceOriginal) { notDiscounted++; continue; }
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
      images: [...new Set(prod.image || [])],
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
      const tag = resolveDiscountTag({
        discountPercentText: data.discountPercentText,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; continue; }

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
    const sizes = Array.from(document.querySelectorAll('.variant__option.js-variant-option')).map(o => ({
      size: o.textContent.trim().split('\n')[0].trim(),
      inStock: !o.classList.contains('-disabled'),
    }));

    return {
      name: prod.name,
      images: [...new Set(prod.image || [])],
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

  for (const url of newUrls) {
    if (imported.filter(p => !p.error).length >= limit) break;
    try {
      const data = await scrapeKotonProduct(pm, url);
      if (!data || !data.name) continue;
      const originalPrice = parseTLPrice(data.originalText);
      const discountedPrice = parseTLPrice(data.discountedText);
      if (!originalPrice || discountedPrice == null || originalPrice <= discountedPrice) { notDiscounted++; continue; }

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
      if (!tag) { notDiscounted++; continue; }

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

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

// Kiko is an Akinon-platform cosmetics-only storefront (same `pz-` custom
// element family as Koton, confirmed live — different vendor, same JS-
// hydration timing quirks). Its whole catalog (2216 products, confirmed
// live) sits behind a single infinite-scroll listing — most cards there
// carry only a marketing badge ("1 alana 1 hediye", "2. ürüne %50") with no
// real price cut, so the per-card `pz-price.-retail` element (the old,
// struck-through price) is what actually finds genuine discounts, not the
// page's own framing (same lesson as Zara/LCWaikiki/Koton's own gates).
// Pagination is `<pz-pagination type="infinite" per-page="20">` — confirmed
// live that a programmatic scrollTo()/scrollIntoView() never triggers its
// loader at all (stuck at the first 20 items); only a real page.mouse.wheel()
// does, and even then the DOM is a virtualized ~20-item window, not an
// ever-growing list, so every round's cards must be read and kept rather
// than trusting final DOM size.
const KIKO_DISCOUNT_LISTING_URL = 'https://www.kikomilano.com.tr/kampanyali-urunler/';
const KIKO_MAX_SCROLL_ROUNDS = 40; // ~800 of the 2216 total per run — genuine discounts are a minority scattered throughout, this is a safety cap, not an exhaustive crawl
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

// Scrolls the discount/catalog listing, reading each card's url + whether it
// carries a genuine `pz-price.-retail` directly from the grid. See the big
// comment above KIKO_DISCOUNT_LISTING_URL for why this needs page.mouse.wheel()
// and why every round's cards get folded into `found` rather than reading
// the DOM's final size once at the end.
async function collectKikoDiscountedCandidates(pm) {
  const page = await pm.goto(KIKO_DISCOUNT_LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureKikoPageSetup(page);
  await new Promise(r => setTimeout(r, 1500));

  const found = new Map();
  for (let i = 0; i < KIKO_MAX_SCROLL_ROUNDS; i++) {
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
      images: [...new Set(prod.image || [])],
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

  for (const url of newUrls) {
    if (imported.filter(p => !p.error).length >= limit) break;
    if (consumedUrls.has(url)) continue;
    try {
      const data = await scrapeKikoProduct(pm, url);
      if (!data || !data.name) continue;
      if (!data.hasRetail) { notDiscounted++; continue; }

      const priceOriginal = parseTLPrice(data.originalText);
      const priceSite = parseTLPrice(data.currentText);
      if (!priceOriginal || priceSite == null || priceOriginal <= priceSite) { notDiscounted++; continue; }

      const finalDiscountedPrice = Math.round(priceSite * (1 + site.markup_percent / 100) * 100) / 100;
      const tag = resolveDiscountTag({
        discountPercentText: null,
        markupPercent: site.markup_percent,
        finalDiscountedPrice, priceOriginal,
      });
      if (!tag) { notDiscounted++; continue; }

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
          const sData = await scrapeKikoShade(pm, sUrl);
          if (sData) shades.push(sData);
        } catch (e) { /* skip a broken shade page, keep the rest of the group */ }
      }
      siblingUrls.forEach(u => consumedUrls.add(u));

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
  }

  return { imported, skipped: notDiscounted + (candidateUrls.length - newUrls.length) };
}

module.exports = {
  Defacto, MadameCoco, Zara, LCWaikiki, Koton, KikoMilano,
  // exported for backend/scripts/backfillMissingColors.js — reusing the
  // same lookup/create logic the live importers use, rather than
  // duplicating it in the backfill script.
  extractLeadingColorWord, getOrCreateColorId,
};
