// =====================================================
// اطلاعات تماس
// =====================================================
const CONTACT = {
  phone: '905550401737',
  phoneDisplay:      '+۹۰ ۵۵۵ ۰۴۰ ۱۷۳۷',
  phoneDisplayLatin: '+90 555 040 1737',
  whatsapp: '905550401737',
  telegram: 'akhgar_sport',
};

// =====================================================
// رنگ‌های مشترک
// =====================================================
const COLORS = {
  black:  { hex: '#1a1a1a', name: { fa: 'مشکی',    en: 'Black',  tr: 'Siyah'    }},
  white:  { hex: '#e8e8e8', name: { fa: 'سفید',     en: 'White',  tr: 'Beyaz'    }},
  red:    { hex: '#e63946', name: { fa: 'قرمز',     en: 'Red',    tr: 'Kırmızı'  }},
  blue:   { hex: '#2563eb', name: { fa: 'آبی',      en: 'Blue',   tr: 'Mavi'     }},
  navy:   { hex: '#1e3a5f', name: { fa: 'سرمه‌ای',  en: 'Navy',   tr: 'Lacivert' }},
  green:  { hex: '#16a34a', name: { fa: 'سبز',      en: 'Green',  tr: 'Yeşil'    }},
  gray:   { hex: '#6b7280', name: { fa: 'خاکستری',  en: 'Gray',   tr: 'Gri'      }},
  orange: { hex: '#f97316', name: { fa: 'نارنجی',   en: 'Orange', tr: 'Turuncu'  }},
  yellow: { hex: '#eab308', name: { fa: 'زرد',      en: 'Yellow', tr: 'Sarı'     }},
  purple: { hex: '#7c3aed', name: { fa: 'بنفش',     en: 'Purple', tr: 'Mor'      }},
  pink:   { hex: '#ec4899', name: { fa: 'صورتی',    en: 'Pink',   tr: 'Pembe'    }},
};

// =====================================================
// زیردسته‌بندی‌ها
// =====================================================
const SUBCATEGORIES = {
  clothing: [
    { key: null,         label: { fa: 'همه',      en: 'All',        tr: 'Tümü'       }},
    { key: 'tshirt',     label: { fa: 'تیشرت',    en: 'T-Shirt',    tr: 'Tişört'     }},
    { key: 'shorts',     label: { fa: 'شورت',     en: 'Shorts',     tr: 'Şort'       }},
    { key: 'pants',      label: { fa: 'شلوار',    en: 'Pants',      tr: 'Eşofman'    }},
    { key: 'leggings',   label: { fa: 'تایت',     en: 'Leggings',   tr: 'Tayt'       }},
    { key: 'sweatshirt', label: { fa: 'سوئیشرت',  en: 'Sweatshirt', tr: 'Sweatshirt' }},
    { key: 'jacket',     label: { fa: 'ژاکت',     en: 'Jacket',     tr: 'Ceket'      }},
  ],
  shoes: [
    { key: null,         label: { fa: 'همه',      en: 'All',        tr: 'Tümü'       }},
    { key: 'running',    label: { fa: 'دویدن',    en: 'Running',    tr: 'Koşu'       }},
    { key: 'football',   label: { fa: 'فوتبال',   en: 'Football',   tr: 'Futbol'     }},
    { key: 'basketball', label: { fa: 'بسکتبال',  en: 'Basketball', tr: 'Basketbol'  }},
    { key: 'tennis',     label: { fa: 'تنیس',     en: 'Tennis',     tr: 'Tenis'      }},
    { key: 'sandals',    label: { fa: 'دمپایی',   en: 'Sandals',    tr: 'Terlik'     }},
  ],
  accessories: [
    { key: null,         label: { fa: 'همه',      en: 'All',        tr: 'Tümü'       }},
    { key: 'gloves',     label: { fa: 'دستکش',    en: 'Gloves',     tr: 'Eldiven'    }},
    { key: 'bag',        label: { fa: 'کیف و ساک', en: 'Bags',      tr: 'Çantalar'   }},
    { key: 'headband',   label: { fa: 'هدبند',    en: 'Headband',   tr: 'Kafa Bandı' }},
    { key: 'wristband',  label: { fa: 'مچ‌بند',   en: 'Wristband',  tr: 'Bileklik'   }},
    { key: 'socks',      label: { fa: 'جوراب',    en: 'Socks',      tr: 'Çorap'      }},
    { key: 'bottle',     label: { fa: 'بطری آب',  en: 'Water Bottle', tr: 'Matara'  }},
  ],
};

// =====================================================
// داده محصولات
// =====================================================
var products = [

  // ─── لباس ───────────────────────────────────────────
  {
    id: 1, category: 'clothing', subcategory: 'tshirt',
    name: { fa: 'تیشرت ورزشی درای‌فیت', en: 'Dry-Fit Sports T-Shirt', tr: 'Dry-Fit Spor Tişört' },
    description: { fa: 'پارچه پلی‌استر | ضدعرق | سبک و تنفس‌پذیر', en: 'Polyester fabric | Anti-sweat | Lightweight & breathable', tr: 'Polyester kumaş | Ter önleyici | Hafif ve nefes alan' },
    colors: [COLORS.black, COLORS.white, COLORS.red, COLORS.blue],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    unavailableSizes: ['XXL'], unavailableColors: ['red'],
    emoji: '👕', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', tag: 'bestseller',
  },
  {
    id: 2, category: 'clothing', subcategory: 'pants',
    name: { fa: 'شلوار گرمکن ویند', en: 'Wind Tracksuit Pants', tr: 'Wind Eşofman Altı' },
    gender: 'male',
    description: { fa: 'پارچه نرم و گرم | مناسب فصل سرد | کش الاستیک', en: 'Soft warm fabric | Cold season | Elastic waistband', tr: 'Yumuşak ısıtıcı kumaş | Soğuk sezon | Elastik bel' },
    colors: [COLORS.black, COLORS.gray, COLORS.navy],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    unavailableSizes: ['S', 'XL'], unavailableColors: ['gray'],
    emoji: '👖', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', tag: null,
  },
  {
    id: 3, category: 'clothing', subcategory: 'sweatshirt',
    name: { fa: 'سوئیشرت هودی', en: 'Hoodie Sweatshirt', tr: 'Kapüşonlu Sweatshirt' },
    description: { fa: 'فلیس داخلی | خارج ضدآب | کاپشن‌دار', en: 'Fleece interior | Water resistant | With hood', tr: 'Polar iç astar | Su dayanıklı | Kapüşonlu' },
    colors: [COLORS.black, COLORS.gray, COLORS.white, COLORS.navy],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    emoji: '🧥', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', tag: 'new',
  },
  {
    id: 4, category: 'clothing', subcategory: 'shorts',
    name: { fa: 'شورت ورزشی سبک', en: 'Lightweight Sports Shorts', tr: 'Hafif Spor Şortu' },
    gender: 'male',
    description: { fa: 'پارچه سبک | تهویه عالی | مناسب باشگاه و فضای باز', en: 'Lightweight fabric | Great ventilation | Gym & outdoors', tr: 'Hafif kumaş | İyi havalandırma | Spor salonu & açık hava' },
    colors: [COLORS.black, COLORS.blue, COLORS.red, COLORS.gray],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    emoji: '🩲', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', tag: null,
  },
  {
    id: 5, category: 'clothing', subcategory: 'leggings',
    name: { fa: 'لگ ورزشی زنانه', en: "Women's Sports Leggings", tr: 'Kadın Spor Taytı' },
    gender: 'female',
    description: { fa: 'فشرده اسپورتی | با پوشش ضدتابش | فیت بدن', en: 'Compression fit | UV protective | Body-hugging', tr: 'Sıkıştırma fit | UV koruyucu | Vücut şeklinde' },
    colors: [COLORS.black, COLORS.navy, COLORS.purple, COLORS.pink],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    emoji: '🧘‍♀️', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', tag: null,
  },
  {
    id: 6, category: 'clothing', subcategory: 'jacket',
    name: { fa: 'ژاکت بادگیر ورزشی', en: 'Sports Windbreaker Jacket', tr: 'Spor Rüzgarlık Ceket' },
    gender: 'female',
    description: { fa: 'ضدباد و ضدآب | سبک | کاربرد بیرون و کوه', en: 'Windproof & waterproof | Lightweight | Outdoor & hiking', tr: 'Rüzgar & su geçirmez | Hafif | Açık hava & dağ' },
    colors: [COLORS.black, COLORS.red, COLORS.green, COLORS.navy],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    emoji: '🧥', gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', tag: null,
  },

  // ─── کفش ────────────────────────────────────────────
  {
    id: 7, category: 'shoes', subcategory: 'running',
    name: { fa: 'کفش دویدن حرفه‌ای', en: 'Professional Running Shoes', tr: 'Profesyonel Koşu Ayakkabısı' },
    gender: 'male',
    description: { fa: 'زیره فومی ضدضربه | سبک | تهویه خوب در دویدن', en: 'Foam sole, shock-absorbing | Lightweight | Great ventilation', tr: 'Köpük taban, darbe emici | Hafif | İyi havalandırma' },
    colors: [COLORS.black, COLORS.white, COLORS.blue, COLORS.orange],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴', '۴۵'],
    unavailableSizes: ['۳۹', '۴۵'], unavailableColors: ['orange'],
    emoji: '👟', gradient: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', tag: 'bestseller',
  },
  {
    id: 8, category: 'shoes', subcategory: 'football',
    name: { fa: 'کفش فوتبال چمن مصنوعی', en: 'Football Shoes (Artificial Turf)', tr: 'Halı Saha Futbol Ayakkabısı' },
    gender: 'male',
    description: { fa: 'کف آجی لاستیک | گل میخ‌دار | کنترل سرعت', en: 'Rubber sole | Studded | Speed control', tr: 'Kauçuk taban | Çivili | Hız kontrolü' },
    colors: [COLORS.black, COLORS.red, COLORS.green, COLORS.white],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'],
    emoji: '⚽', gradient: 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)', tag: null,
  },
  {
    id: 9, category: 'shoes', subcategory: 'basketball',
    name: { fa: 'کفش بسکتبال ویستا', en: 'Vista Basketball Shoes', tr: 'Vista Basketbol Ayakkabısı' },
    gender: 'male',
    description: { fa: 'زیره لاستیک | کف ماهوتی | دوام مطمئن', en: 'Rubber sole | Suede upper | Reliable durability', tr: 'Kauçuk taban | Süet üst | Güvenilir dayanıklılık' },
    colors: [COLORS.black, COLORS.white, COLORS.yellow, COLORS.red],
    sizes: ['۴۰', '۴۱', '۴۲', '۴۳', '۴۴', '۴۵'],
    unavailableSizes: ['۴۴', '۴۵'], unavailableColors: ['yellow'],
    emoji: '🏀', gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', tag: 'new',
  },
  {
    id: 10, category: 'shoes', subcategory: 'tennis',
    name: { fa: 'کفش تنیس حرفه‌ای', en: 'Professional Tennis Shoes', tr: 'Profesyonel Tenis Ayakkabısı' },
    description: { fa: 'زیره گربه‌ای | تهویه جانبی | پایداری بالا', en: 'Herringbone sole | Side ventilation | High stability', tr: 'Balıksırtı taban | Yan havalandırma | Yüksek stabilite' },
    colors: [COLORS.white, COLORS.blue, COLORS.gray, COLORS.black],
    sizes: ['۳۸', '۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'],
    emoji: '🎾', gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)', tag: null,
  },
  {
    id: 11, category: 'shoes', subcategory: 'sandals',
    name: { fa: 'دمپایی ورزشی سبک', en: 'Lightweight Sports Sandals', tr: 'Hafif Spor Terlik' },
    description: { fa: 'فوم ممبوری | ضدآب | مناسب استخر و ساحل', en: 'Memory foam | Waterproof | Pool & beach', tr: 'Hafıza köpüğü | Su geçirmez | Havuz & plaj' },
    colors: [COLORS.black, COLORS.white, COLORS.orange, COLORS.blue],
    sizes: ['۳۹', '۴۰', '۴۱', '۴۲', '۴۳', '۴۴'],
    emoji: '🩴', gradient: 'linear-gradient(135deg, #56ccf2 0%, #2f80ed 100%)', tag: null,
  },

  // ─── اکسسوری ────────────────────────────────────────
  {
    id: 12, category: 'accessories', subcategory: 'gloves',
    name: { fa: 'دستکش بدنسازی حرفه‌ای', en: 'Professional Gym Gloves', tr: 'Profesyonel Spor Eldiveni' },
    description: { fa: 'آستر معدنی ضدزنگ | کف فومی ضدتاول | بند مچ‌بند', en: 'Anti-rust metal rivets | Foam grip, anti-blister | Wrist support', tr: 'Paslanmaz metal perçin | Köpük kavrama | Bilek desteği' },
    colors: [COLORS.black, COLORS.red, COLORS.blue],
    sizes: ['S', 'M', 'L'],
    unavailableSizes: ['S'], unavailableColors: [],
    emoji: '🥊', gradient: 'linear-gradient(135deg, #f2994a 0%, #f2c94c 100%)', tag: 'bestseller',
  },
  {
    id: 13, category: 'accessories', subcategory: 'bag',
    name: { fa: 'کوله پشتی ورزشی حجیم', en: 'Large Sports Backpack', tr: 'Büyük Spor Sırt Çantası' },
    description: { fa: '۳۰ لیتری | دارای کفش‌دون | پارچه ضدآب | پشتیبان ارگونومیک', en: '30L | Shoe compartment | Waterproof fabric | Ergonomic back pad', tr: '30 litre | Ayakkabı bölmesi | Su geçirmez | Ergonomik sırt' },
    colors: [COLORS.black, COLORS.navy, COLORS.gray],
    sizes: null,
    emoji: '🎒', gradient: 'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)', tag: 'new',
  },
  {
    id: 14, category: 'accessories', subcategory: 'bag',
    name: { fa: 'ساک ورزشی دافل', en: 'Sports Duffel Bag', tr: 'Spor Çantası' },
    description: { fa: 'ظرفیت بزرگ | دافل محکم | مناسب باشگاه و سفر', en: 'Large capacity | Strong zipper | Gym & travel', tr: 'Büyük kapasite | Güçlü fermuar | Spor & seyahat' },
    colors: [COLORS.black, COLORS.gray, COLORS.navy],
    sizes: null,
    emoji: '💼', gradient: 'linear-gradient(135deg, #141e30 0%, #243b55 100%)', tag: null,
  },
  {
    id: 15, category: 'accessories', subcategory: 'headband',
    name: { fa: 'هدبند ورزشی', en: 'Sports Headband', tr: 'Spor Kafa Bandı' },
    gender: 'female',
    description: { fa: 'جذب عرق | نگه‌دارنده مو | مناسب دویدن و ترینینگ', en: 'Sweat absorbing | Hair holder | Running & training', tr: 'Ter emici | Saç tutucu | Koşu & antrenman' },
    colors: [COLORS.black, COLORS.white, COLORS.blue, COLORS.red],
    sizes: null,
    emoji: '🤸', gradient: 'linear-gradient(135deg, #f953c6 0%, #b91d73 100%)', tag: null,
  },
  {
    id: 16, category: 'accessories', subcategory: 'wristband',
    name: { fa: 'مچ‌بند ورزشی', en: 'Sports Wristband', tr: 'Spor Bilekliği' },
    description: { fa: 'جذب عرق | محافظ مچ | بسته دوتایی', en: 'Sweat absorbing | Wrist protector | Double pack', tr: 'Ter emici | Bilek koruyucu | İkili paket' },
    colors: [COLORS.black, COLORS.white, COLORS.blue, COLORS.red],
    sizes: ['S', 'M', 'L'],
    emoji: '⚡', gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', tag: null,
  },
  {
    id: 17, category: 'accessories', subcategory: 'socks',
    name: { fa: 'جوراب ورزشی ضدعرق', en: 'Anti-Sweat Sports Socks', tr: 'Ter Önleyici Spor Çorabı' },
    description: { fa: 'نخ بامبو | ضدعرق | انعطاف‌دار | پاکیج دوتایی', en: 'Bamboo fiber | Anti-sweat | Flexible | Double pack', tr: 'Bambu fiber | Ter önleyici | Esnek | İkili paket' },
    colors: [COLORS.black, COLORS.white, COLORS.gray],
    sizes: ['۳۹–۴۲', '۴۳–۴۶'],
    emoji: '🧦', gradient: 'linear-gradient(135deg, #fc5c7d 0%, #6a3093 100%)', tag: null,
  },
  {
    id: 18, category: 'accessories', subcategory: 'bottle',
    name: { fa: 'بطری آب ورزشی استیل', en: 'Steel Sports Water Bottle', tr: 'Çelik Spor Matarası' },
    description: { fa: 'ظرفیت ۷۵۰ میلی‌لیتر | ضدزنگ | در ۴ رنگ', en: '750 ml | Anti-rust stainless steel | 4 colors', tr: '750 ml | Paslanmaz çelik | 4 farklı renk' },
    colors: [COLORS.black, COLORS.blue, COLORS.red, COLORS.green],
    sizes: null,
    emoji: '💧', gradient: 'linear-gradient(135deg, #2980b9 0%, #6dd5fa 100%)', tag: null,
  },
];
