require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── color key → DB id map (filled at runtime) ────────────────────────────────
let colorMap = {};

// ─── category key → DB id map ─────────────────────────────────────────────────
let categoryMap = {};

// ─── subcategory key → DB id map ──────────────────────────────────────────────
let subcategoryMap = {};

// ─── Products from frontend/products.js ───────────────────────────────────────
const PRODUCTS = [
  {
    id: 1, category: 'clothing', subcategory: 'tshirt',
    name: { fa: 'تیشرت ورزشی درای‌فیت', en: 'Dry-Fit Sports T-Shirt', tr: 'Dry-Fit Spor Tişört' },
    description: { fa: 'پارچه پلی‌استر | ضدعرق | سبک و تنفس‌پذیر', en: 'Polyester fabric | Anti-sweat | Lightweight & breathable', tr: 'Polyester kumaş | Ter önleyici | Hafif ve nefes alan' },
    colors: ['black', 'white', 'red', 'blue'], unavailableColors: ['red'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],     unavailableSizes: ['XXL'],
    emoji: '👕', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', tag: 'bestseller',
  },
  {
    id: 2, category: 'clothing', subcategory: 'pants', gender: 'male',
    name: { fa: 'شلوار گرمکن ویند', en: 'Wind Tracksuit Pants', tr: 'Wind Eşofman Altı' },
    description: { fa: 'پارچه نرم و گرم | مناسب فصل سرد | کش الاستیک', en: 'Soft warm fabric | Cold season | Elastic waistband', tr: 'Yumuşak ısıtıcı kumaş | Soğuk sezon | Elastik bel' },
    colors: ['black', 'gray', 'navy'], unavailableColors: ['gray'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'], unavailableSizes: ['S', 'XL'],
    emoji: '👖', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', tag: null,
  },
  {
    id: 3, category: 'clothing', subcategory: 'sweatshirt',
    name: { fa: 'سوئیشرت هودی', en: 'Hoodie Sweatshirt', tr: 'Kapüşonlu Sweatshirt' },
    description: { fa: 'فلیس داخلی | خارج ضدآب | کاپشن‌دار', en: 'Fleece interior | Water resistant | With hood', tr: 'Polar iç astar | Su dayanıklı | Kapüşonlu' },
    colors: ['black', 'gray', 'white', 'navy'], unavailableColors: [],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'], unavailableSizes: [],
    emoji: '🧥', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', tag: 'new',
  },
  {
    id: 4, category: 'clothing', subcategory: 'shorts', gender: 'male',
    name: { fa: 'شورت ورزشی سبک', en: 'Lightweight Sports Shorts', tr: 'Hafif Spor Şortu' },
    description: { fa: 'پارچه سبک | تهویه عالی | مناسب باشگاه و فضای باز', en: 'Lightweight fabric | Great ventilation | Gym & outdoors', tr: 'Hafif kumaş | İyi havalandırma | Spor salonu & açık hava' },
    colors: ['black', 'blue', 'red', 'gray'], unavailableColors: [],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'], unavailableSizes: [],
    emoji: '🩲', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', tag: null,
  },
  {
    id: 5, category: 'clothing', subcategory: 'leggings', gender: 'female',
    name: { fa: 'لگ ورزشی زنانه', en: "Women's Sports Leggings", tr: 'Kadın Spor Taytı' },
    description: { fa: 'فشرده اسپورتی | با پوشش ضدتابش | فیت بدن', en: 'Compression fit | UV protective | Body-hugging', tr: 'Sıkıştırma fit | UV koruyucu | Vücut şeklinde' },
    colors: ['black', 'navy', 'purple', 'pink'], unavailableColors: [],
    sizes: ['XS', 'S', 'M', 'L', 'XL'], unavailableSizes: [],
    emoji: '🧘', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', tag: null,
  },
  {
    id: 6, category: 'clothing', subcategory: 'jacket', gender: 'female',
    name: { fa: 'ژاکت بادگیر ورزشی', en: 'Sports Windbreaker Jacket', tr: 'Spor Rüzgarlık Ceket' },
    description: { fa: 'ضدباد و ضدآب | سبک | کاربرد بیرون و کوه', en: 'Windproof & waterproof | Lightweight | Outdoor & hiking', tr: 'Rüzgar & su geçirmez | Hafif | Açık hava & dağ' },
    colors: ['black', 'red', 'green', 'navy'], unavailableColors: [],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'], unavailableSizes: [],
    emoji: '🧥', gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', tag: null,
  },
  {
    id: 7, category: 'shoes', subcategory: 'running', gender: 'male',
    name: { fa: 'کفش دویدن حرفه‌ای', en: 'Professional Running Shoes', tr: 'Profesyonel Koşu Ayakkabısı' },
    description: { fa: 'زیره فومی ضدضربه | سبک | تهویه خوب در دویدن', en: 'Foam sole, shock-absorbing | Lightweight | Great ventilation', tr: 'Köpük taban, darbe emici | Hafif | İyi havalandırma' },
    colors: ['black', 'white', 'blue', 'orange'], unavailableColors: ['orange'],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴', '۴۵'], unavailableSizes: ['۳۹', '۴۵'],
    emoji: '👟', gradient: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', tag: 'bestseller',
  },
  {
    id: 8, category: 'shoes', subcategory: 'football', gender: 'male',
    name: { fa: 'کفش فوتبال چمن مصنوعی', en: 'Football Shoes (Artificial Turf)', tr: 'Halı Saha Futbol Ayakkabısı' },
    description: { fa: 'کف آجی لاستیک | گل میخ‌دار | کنترل سرعت', en: 'Rubber sole | Studded | Speed control', tr: 'Kauçuk taban | Çivili | Hız kontrolü' },
    colors: ['black', 'red', 'green', 'white'], unavailableColors: [],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'], unavailableSizes: [],
    emoji: '⚽', gradient: 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)', tag: null,
  },
  {
    id: 9, category: 'shoes', subcategory: 'basketball', gender: 'male',
    name: { fa: 'کفش بسکتبال ویستا', en: 'Vista Basketball Shoes', tr: 'Vista Basketbol Ayakkabısı' },
    description: { fa: 'زیره لاستیک | کف ماهوتی | دوام مطمئن', en: 'Rubber sole | Suede upper | Reliable durability', tr: 'Kauçuk taban | Süet üst | Güvenilir dayanıklılık' },
    colors: ['black', 'white', 'yellow', 'red'], unavailableColors: ['yellow'],
    sizes: ['۴۰', '۴۱', '۴۲', '۴۳', '۴۴', '۴۵'], unavailableSizes: ['۴۴', '۴۵'],
    emoji: '🏀', gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', tag: 'new',
  },
  {
    id: 10, category: 'shoes', subcategory: 'tennis',
    name: { fa: 'کفش تنیس حرفه‌ای', en: 'Professional Tennis Shoes', tr: 'Profesyonel Tenis Ayakkabısı' },
    description: { fa: 'زیره گربه‌ای | تهویه جانبی | پایداری بالا', en: 'Herringbone sole | Side ventilation | High stability', tr: 'Balıksırtı taban | Yan havalandırma | Yüksek stabilite' },
    colors: ['white', 'blue', 'gray', 'black'], unavailableColors: [],
    sizes: ['۳۸', '۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'], unavailableSizes: [],
    emoji: '🎾', gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)', tag: null,
  },
  {
    id: 11, category: 'shoes', subcategory: 'sandals',
    name: { fa: 'دمپایی ورزشی سبک', en: 'Lightweight Sports Sandals', tr: 'Hafif Spor Terlik' },
    description: { fa: 'فوم ممبوری | ضدآب | مناسب استخر و ساحل', en: 'Memory foam | Waterproof | Pool & beach', tr: 'Hafıza köpüğü | Su geçirmez | Havuz & plaj' },
    colors: ['black', 'white', 'orange', 'blue'], unavailableColors: [],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'], unavailableSizes: [],
    emoji: '🩴', gradient: 'linear-gradient(135deg, #56ccf2 0%, #2f80ed 100%)', tag: null,
  },
  {
    id: 12, category: 'accessories', subcategory: 'gloves',
    name: { fa: 'دستکش بدنسازی حرفه‌ای', en: 'Professional Gym Gloves', tr: 'Profesyonel Spor Eldiveni' },
    description: { fa: 'آستر معدنی ضدزنگ | کف فومی ضدتاول | بند مچ‌بند', en: 'Anti-rust metal rivets | Foam grip, anti-blister | Wrist support', tr: 'Paslanmaz metal perçin | Köpük kavrama | Bilek desteği' },
    colors: ['black', 'red', 'blue'], unavailableColors: [],
    sizes: ['S', 'M', 'L'], unavailableSizes: ['S'],
    emoji: '🥊', gradient: 'linear-gradient(135deg, #f2994a 0%, #f2c94c 100%)', tag: 'bestseller',
  },
  {
    id: 13, category: 'accessories', subcategory: 'bag',
    name: { fa: 'کوله پشتی ورزشی حجیم', en: 'Large Sports Backpack', tr: 'Büyük Spor Sırt Çantası' },
    description: { fa: '۳۰ لیتری | دارای کفش‌دون | پارچه ضدآب | پشتیبان ارگونومیک', en: '30L | Shoe compartment | Waterproof fabric | Ergonomic back pad', tr: '30 litre | Ayakkabı bölmesi | Su geçirmez | Ergonomik sırt' },
    colors: ['black', 'navy', 'gray'], unavailableColors: [],
    sizes: null, unavailableSizes: [],
    emoji: '🎒', gradient: 'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)', tag: 'new',
  },
  {
    id: 14, category: 'accessories', subcategory: 'bag',
    name: { fa: 'ساک ورزشی دافل', en: 'Sports Duffel Bag', tr: 'Spor Çantası' },
    description: { fa: 'ظرفیت بزرگ | دافل محکم | مناسب باشگاه و سفر', en: 'Large capacity | Strong zipper | Gym & travel', tr: 'Büyük kapasite | Güçlü fermuar | Spor & seyahat' },
    colors: ['black', 'gray', 'navy'], unavailableColors: [],
    sizes: null, unavailableSizes: [],
    emoji: '💼', gradient: 'linear-gradient(135deg, #141e30 0%, #243b55 100%)', tag: null,
  },
  {
    id: 15, category: 'accessories', subcategory: 'headband', gender: 'female',
    name: { fa: 'هدبند ورزشی', en: 'Sports Headband', tr: 'Spor Kafa Bandı' },
    description: { fa: 'جذب عرق | نگه‌دارنده مو | مناسب دویدن و ترینینگ', en: 'Sweat absorbing | Hair holder | Running & training', tr: 'Ter emici | Saç tutucu | Koşu & antrenman' },
    colors: ['black', 'white', 'blue', 'red'], unavailableColors: [],
    sizes: null, unavailableSizes: [],
    emoji: '🤸', gradient: 'linear-gradient(135deg, #f953c6 0%, #b91d73 100%)', tag: null,
  },
  {
    id: 16, category: 'accessories', subcategory: 'wristband',
    name: { fa: 'مچ‌بند ورزشی', en: 'Sports Wristband', tr: 'Spor Bilekliği' },
    description: { fa: 'جذب عرق | محافظ مچ | بسته دوتایی', en: 'Sweat absorbing | Wrist protector | Double pack', tr: 'Ter emici | Bilek koruyucu | İkili paket' },
    colors: ['black', 'white', 'blue', 'red'], unavailableColors: [],
    sizes: ['S', 'M', 'L'], unavailableSizes: [],
    emoji: '⚡', gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', tag: null,
  },
  {
    id: 17, category: 'accessories', subcategory: 'socks',
    name: { fa: 'جوراب ورزشی ضدعرق', en: 'Anti-Sweat Sports Socks', tr: 'Ter Önleyici Spor Çorabı' },
    description: { fa: 'نخ بامبو | ضدعرق | انعطاف‌دار | پاکیج دوتایی', en: 'Bamboo fiber | Anti-sweat | Flexible | Double pack', tr: 'Bambu fiber | Ter önleyici | Esnek | İkili paket' },
    colors: ['black', 'white', 'gray'], unavailableColors: [],
    sizes: ['۳۹–۴۲', '۴۳–۴۶'], unavailableSizes: [],
    emoji: '🧦', gradient: 'linear-gradient(135deg, #fc5c7d 0%, #6a3093 100%)', tag: null,
  },
  {
    id: 18, category: 'accessories', subcategory: 'bottle',
    name: { fa: 'بطری آب ورزشی استیل', en: 'Steel Sports Water Bottle', tr: 'Çelik Spor Matarası' },
    description: { fa: 'ظرفیت ۷۵۰ میلی‌لیتر | ضدزنگ | در ۴ رنگ', en: '750 ml | Anti-rust stainless steel | 4 colors', tr: '750 ml | Paslanmaz çelik | 4 farklı renk' },
    colors: ['black', 'blue', 'red', 'green'], unavailableColors: [],
    sizes: null, unavailableSizes: [],
    emoji: '💧', gradient: 'linear-gradient(135deg, #2980b9 0%, #6dd5fa 100%)', tag: null,
  },
];

async function main() {
  console.log('Loading reference data...');

  const categories    = await prisma.categories.findMany();
  const subcategories = await prisma.subcategories.findMany();
  const colors        = await prisma.colors.findMany();

  categories.forEach(c    => { categoryMap[c.key]    = c.id; });
  subcategories.forEach(s => { subcategoryMap[s.key] = s.id; });
  colors.forEach(c        => { colorMap[c.key]        = c.id; });

  console.log('Seeding 18 products...');

  for (const p of PRODUCTS) {
    const product = await prisma.products.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id:             p.id,
        category_id:    categoryMap[p.category],
        subcategory_id: subcategoryMap[p.subcategory] || null,
        gender:         p.gender || 'unisex',
        name_fa:        p.name.fa,
        name_en:        p.name.en,
        name_tr:        p.name.tr,
        desc_fa:        p.description.fa,
        desc_en:        p.description.en,
        desc_tr:        p.description.tr,
        emoji:          p.emoji,
        gradient:       p.gradient,
        tag:            p.tag || null,
        price:          0,
        stock:          100,
      },
    });

    // product_colors
    for (const colorKey of p.colors) {
      const colorId = colorMap[colorKey];
      if (!colorId) continue;
      await prisma.product_colors.upsert({
        where:  { product_id_color_id: { product_id: product.id, color_id: colorId } },
        update: {},
        create: {
          product_id:   product.id,
          color_id:     colorId,
          is_available: !p.unavailableColors.includes(colorKey),
        },
      });
    }

    // product_sizes
    if (p.sizes) {
      for (const sizeLabel of p.sizes) {
        await prisma.product_sizes.upsert({
          where:  { product_id_size_label: { product_id: product.id, size_label: sizeLabel } },
          update: {},
          create: {
            product_id:   product.id,
            size_label:   sizeLabel,
            is_available: !p.unavailableSizes.includes(sizeLabel),
          },
        });
      }
    }

    console.log('  seeded:', p.name.fa);
  }

  console.log('Done. 18 products seeded.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
