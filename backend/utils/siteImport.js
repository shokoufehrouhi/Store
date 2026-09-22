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
  [/mont|ceket|yelek|kaban|trençkot|yağmurluk|parka/i, 6],
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
  if (/Kız Çocuk|Kız Bebek/i.test(title)) return 'female';
  if (/Erkek Çocuk|Erkek Bebek/i.test(title)) return 'male';
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
  { path: 'cocuk-bebek-indirimli-urunler',     gender: 'unisex', categoryId: 1 },
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

// Madame Coco (home textiles/decor) has no clothing-store equivalent
// category in our taxonomy at all — everything here goes under the existing
// Lifestyle category (id 8), split into subcategories that mirror Madame
// Coco's own top-level nav (Yatak Odası, Banyo, ...). All 9 are seeded
// unconditionally at the start of every run (see seedMcSubcategories) rather
// than created lazily per matched product — so they show up in admin (and
// can be reviewed/toggled/published) even on a run that imports nothing.
const MC_LIFESTYLE_CATEGORY_ID = 8;
const MC_SUBCATEGORY_DEFS = {
  'yatak-odasi':    { key: 'bedroom',        label_tr: 'Yatak Odası',    label_fa: 'اتاق خواب',               label_en: 'Bedroom' },
  'banyo':          { key: 'bathroom',       label_tr: 'Banyo',          label_fa: 'حمام',                     label_en: 'Bathroom' },
  'mutfak':         { key: 'kitchen',        label_tr: 'Mutfak',         label_fa: 'آشپزخانه',                 label_en: 'Kitchen' },
  'sofra':          { key: 'tableware',      label_tr: 'Sofra',          label_fa: 'سفره و ظروف',              label_en: 'Tableware' },
  'hali-kilim':     { key: 'rugs',           label_tr: 'Halı & Kilim',   label_fa: 'فرش و قالی',               label_en: 'Rugs & Carpets' },
  'dekorasyon':     { key: 'decoration',     label_tr: 'Dekorasyon',     label_fa: 'دکوراسیون',                label_en: 'Decoration' },
  'kozmetik':       { key: 'home_cosmetics', label_tr: 'Kozmetik',       label_fa: 'عطر، شمع و بهداشت خانه',   label_en: 'Home Fragrance & Care' },
  'ev-yasam':       { key: 'home_living',    label_tr: 'Ev & Yaşam',     label_fa: 'خانه و زندگی',             label_en: 'Home & Living' },
  'ceyiz-urunleri': { key: 'trousseau',      label_tr: 'Çeyiz Ürünleri', label_fa: 'جهیزیه',                   label_en: 'Trousseau' },
};
const mcSubcategoryCache = new Map(); // slug -> subcategory id, memoized for one import run

// Idempotent: findFirst-then-create per slug, safe to call on every sync.
async function seedMcSubcategories() {
  for (const [slug, def] of Object.entries(MC_SUBCATEGORY_DEFS)) {
    if (mcSubcategoryCache.has(slug)) continue;
    let sub = await prisma.subcategories.findFirst({ where: { category_id: MC_LIFESTYLE_CATEGORY_ID, key: def.key } });
    if (!sub) {
      sub = await prisma.subcategories.create({
        data: { category_id: MC_LIFESTYLE_CATEGORY_ID, key: def.key, label_tr: def.label_tr, label_fa: def.label_fa, label_en: def.label_en },
      });
    }
    mcSubcategoryCache.set(slug, sub.id);
  }
}

function getMcSubcategoryId(slug) {
  return mcSubcategoryCache.get(slug) || null;
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
  await seedMcSubcategories();
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

      const subcategoryId = data.categorySlug ? getMcSubcategoryId(data.categorySlug) : null;

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
          category_id: MC_LIFESTYLE_CATEGORY_ID,
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

module.exports = { Defacto, MadameCoco };
