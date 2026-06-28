# MayaFit — فروشگاه تخصصی ورزشی

وبسایت فروشگاهی استاتیک برای فروشگاه ورزشی MayaFit / Akhgar Sport.
ساخته‌شده با HTML، CSS و JavaScript خالص — بدون فریم‌ورک، بدون build tool.

---

## ویژگی‌ها

- **چندزبانه** — فارسی / انگلیسی / ترکی (RTL/LTR خودکار)
- **فیلتر محصولات** — بر اساس دسته، زیردسته و جنسیت (زنانه/مردانه)
- **سبد خرید** — افزودن محصول با انتخاب رنگ و سایز، ذخیره در localStorage
- **علاقه‌مندی‌ها** — ذخیره محصولات مورد علاقه
- **ثبت‌نام / ورود** — modal احراز هویت ساده (client-side)
- **سفارش واتساپ و تلگرام** — ارسال پیام آماده به فروشنده
- **ریسپانسیو** — موبایل، تبلت و دسکتاپ
- **Quick Add popup** — افزودن سریع بدون باز کردن modal کامل
- **Modal محصول** — جزئیات، انتخاب رنگ، سایز و دکمه سفارش

---

## ساختار فایل‌ها

```
Store/
├── index.html      # صفحه اصلی (RTL، فونت Vazirmatn)
├── style.css       # تمام استایل‌ها (CSS variables، ریسپانسیو)
├── products.js     # داده محصولات + تنظیمات تماس (CONTACT)
├── main.js         # رندر، فیلتر، سبد خرید، مدال، علاقه‌مندی‌ها
├── i18n.js         # ترجمه‌ها (FA / EN / TR)
└── README.md
```

---

## تنظیم اطلاعات تماس

در بالای فایل `products.js`:

```js
const CONTACT = {
  phone:            '05392184323',
  phoneDisplay:     '+۰-۵۳۹۲۱۸۴۳۲۳',
  phoneDisplayLatin:'+0-5392184323',
  whatsapp:         '905392184323',   // کد کشور + شماره (بدون +)
  telegram:         'akhgar_sport',   // یوزرنیم تلگرام
};
```

تمام لینک‌های واتساپ، تلگرام و شماره تلفن به‌صورت خودکار از این آبجکت پر می‌شوند.

---

## اجرا

چون فایل‌ها استاتیک هستند، کافیه مستقیم `index.html` را در مرورگر باز کنید
یا یک سرور ساده راه‌اندازی کنید:

```bash
# با Python
python3 -m http.server 8080

# با Node.js / npx
npx serve .
```

سپس آدرس `http://localhost:8080` را باز کنید.

---

## اضافه کردن محصول جدید

در فایل `products.js` به آرایه `products` یک آبجکت اضافه کنید:

```js
{
  id: 19,
  category: 'clothing',          // 'clothing' | 'shoes' | 'accessories'
  subcategory: 'tshirt',
  gender: 'male',                // 'male' | 'female' | حذف کنید برای همه
  name: {
    fa: 'نام محصول',
    en: 'Product Name',
    tr: 'Ürün Adı',
  },
  description: {
    fa: 'توضیح فارسی',
    en: 'English description',
    tr: 'Türkçe açıklama',
  },
  colors: [COLORS.black, COLORS.white],
  sizes: ['S', 'M', 'L', 'XL'],  // null برای محصولات بدون سایز
  unavailableSizes: ['XL'],       // اختیاری
  unavailableColors: [],          // اختیاری
  emoji: '👕',
  gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  tag: 'new',                     // 'new' | 'bestseller' | null
}
```

---

## سیستم طراحی

| متغیر | مقدار | کاربرد |
|---|---|---|
| `--primary` | `#FF5C00` | رنگ اصلی (نارنجی) |
| `--dark` | `#111111` | پس‌زمینه تیره |
| `--bg` | `#f5f5f5` | پس‌زمینه صفحه |
| `--radius` | `14px` | گوشه کارت‌ها |

فونت: [Vazirmatn](https://fonts.google.com/specimen/Vazirmatn) از Google Fonts

---

## تکنولوژی‌ها

- HTML5 / CSS3 / JavaScript (ES5+)
- Google Fonts — Vazirmatn
- localStorage برای ذخیره سبد خرید، علاقه‌مندی‌ها و زبان
- WhatsApp API و Telegram deep link برای سفارش‌گیری

---

## مرورگرهای پشتیبانی‌شده

Chrome 90+، Firefox 88+، Safari 14+، Edge 90+
