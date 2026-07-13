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
// داده محصولات — از API بارگذاری می‌شه
// =====================================================
var products = [];
