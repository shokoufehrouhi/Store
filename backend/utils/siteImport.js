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

// Turkish color name (as it appears in "<Color> Kadın ..." page titles) -> our colors.id
const TR_COLOR_TO_ID = {
  'siyah': 1, 'beyaz': 2, 'kırmızı': 3, 'kirmizi': 3, 'mavi': 4, 'lacivert': 5,
  'yeşil': 6, 'yesil': 6, 'gri': 7, 'turuncu': 8, 'sarı': 9, 'sari': 9,
  'mor': 10, 'pembe': 11, 'turkuaz': 12, 'kahverengi': 13, 'bej': 17,
};

// Turkish keyword (in the product name) -> our subcategories.id, within
// category_id 1 (Clothing). Falls back to null (no subcategory) if nothing matches.
const TR_KEYWORD_TO_SUBCATEGORY = [
  [/tişört|tshirt|t-shirt/i, 1],
  [/şort|bermuda/i, 2],
  [/pantolon/i, 3],
  [/tayt/i, 4],
  [/sweatshirt|hırka|kazak|triko/i, 5],
  [/mont|ceket|yelek|kaban|trençkot|yağmurluk/i, 6],
];

// Same idea, within category_id 7 (Sports) — the "Fit" listing's own
// subcategory taxonomy differs from regular clothing's.
const TR_KEYWORD_TO_SPORT_SUBCATEGORY = [
  [/tişört|tshirt|t-shirt/i, 26],
  [/şort/i, 27],
  [/\bset\b|takım/i, 28],
  [/tayt|leg\b/i, 29],
  [/gömlek|sweatshirt/i, 30],
  [/eşofman|jogger/i, 31],
  [/ayakkabı|sneaker/i, 32],
  [/şapka|bere/i, 33],
  [/eldiven/i, 34],
  [/mont|yelek|ceket/i, 35],
  [/atlet|kolsuz|bralet/i, 36],
];

// category_id 10 (Cosmetics).
const TR_KEYWORD_TO_COSMETIC_SUBCATEGORY = [
  [/ruj|dudak/i, 44],
  [/rimel|göz kalemi|eyeliner|maskara|kaş/i, 43],
  [/fondöten|allık|far|kapatıcı|bb krem/i, 42],
  [/oje|tırnak/i, 49],
  [/parfüm|deodorant|koku/i, 48],
  [/şampuan|saç|conditioner/i, 46],
  [/vücut|body/i, 47],
  [/fırça|sünger|aparat|cihaz/i, 50],
  [/serum|krem|maske|tonik|nemlendirici|temizleyici|peeling|esans/i, 45],
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
  const firstWord = title.trim().split(' ')[0]?.toLowerCase();
  return firstWord && TR_COLOR_TO_ID[firstWord] || null;
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

      const [name_fa, name_en, desc_fa, desc_en] = await Promise.all([
        translateText(data.name, 'tr', 'fa').catch(() => ''),
        translateText(data.name, 'tr', 'en').catch(() => ''),
        data.description ? translateText(data.description, 'tr', 'fa').catch(() => '') : '',
        data.description ? translateText(data.description, 'tr', 'en').catch(() => '') : '',
      ]);
      // name_fa/name_en/name_tr are VARCHAR(120) — machine translation (and
      // some Turkish product names themselves, especially kids' items) can
      // run longer than the source and blow past that, failing the insert.
      const nameTr = data.name.slice(0, 120);
      const nameFa = name_fa.slice(0, 120);
      const nameEn = name_en.slice(0, 120);

      const mediaUrls = [];
      for (const imgUrl of data.images.slice(0, 8)) {
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

module.exports = { Defacto };
