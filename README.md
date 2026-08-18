# Shilista — فروشگاه لباس، کیف، کفش و اکسسوری

وبسایت فروشگاهی چندزبانه برای Shilista.
فرانت‌اند: HTML/CSS/JS خالص — بدون فریم‌ورک، بدون build tool.
بک‌اند: Node.js + Express + Prisma + PostgreSQL.

سایت زنده: [shilista.com](https://www.shilista.com)

---

## ویژگی‌های فرانت‌اند

- **چندزبانه** — فارسی / انگلیسی / ترکی با RTL/LTR خودکار (`i18n.js`)
- **فیلتر و مرتب‌سازی محصولات** — رنگ (multi-select)، سایز، جدیدترین/قیمت/پرفروش‌ترین
- **منوی Mega** — ستون‌های داینامیک از API؛ زیردسته‌ی بدون موجودی خودکار از منو پنهان می‌شود
- **سبد خرید و علاقه‌مندی‌ها** — ذخیره در localStorage، sync با حساب کاربری
- **پیش‌سفارش (preorder)** — سفارش از محصولات موجود سایت، با آدرس/کد تخفیف
- **سفارش با لینک محصول خارجی** — مشتری می‌تواند تا ۵ لینک از سایت‌های دیگر بفرستد (هرکدام با سایز/رنگ/تعداد/توضیح جدا)؛ ادمین برای هرکدام قیمت اعلام می‌کند؛ مشتری هنگام تایید می‌تواند **تعداد نهایی هر لینک را جدا تنظیم کند** (افزایش/کاهش یا صفر برای انصراف از یک مورد) — قیمت کل بر اساس انتخاب نهایی محاسبه می‌شود. عدم پاسخ ظرف ۱۴ روز → رد خودکار (`declineStaleQuotes.js`, کرون روزانه)
- **مرجوعی و کالای معیوب** — درخواست مرجوع، آپلود رسید ارسال، اطلاعات بازپرداخت
- **عکس خریداران** — مشتری می‌تواند عکس محصول خریداری‌شده را برای صفحه محصول بفرستد (نیازمند تایید ادمین)
- **کارت وفاداری، کد تخفیف، معرفی دوستان (referral/leads)**
- **پروفایل مشتری** — صفحه‌ی مستقل (`profile.html`) با تب سفارش‌ها (دکمه‌ی بروزرسانی دستی)، آدرس‌ها، اطلاعات حساب
- **ریسپانسیو کامل** — موبایل، تبلت، دسکتاپ

## ویژگی‌های پنل ادمین (`admin.html`، مسیر واقعی: `/mp`)

- ورود با نام کاربری/رمز عبور → توکن ثابت مشترک (نه JWT per-session)، محافظت‌شده با IP allowlist در nginx
- مدیریت کامل محصولات، دسته/زیردسته، رنگ، سایز، جدول سایز
- مدیریت سفارش‌ها — تایید/رد پرداخت، ثبت اطلاعات ارسال، **قیمت‌گذاری جداگانه‌ی هر لینک** در سفارش‌های لینکی، رد تک‌تک لینک‌ها
- مدیریت مرجوعی‌ها، جوایز (prizes)، تامین‌کنندگان، حساب‌های بانکی، کد تخفیف
- گزارش‌ها — فروش، مشتریان، مالی، کد تخفیف، بازدید سایت (هرکدام زیرمنوی جمع‌شونده)
- سوییچ زبان پنل (FA / EN / TR)
- تب **استقرار (Deploy)** — نمایش وضعیت staging/production و دکمه‌ی یک‌کلیکی استقرار (پایین‌تر توضیح داده شده)

---

## ساختار پروژه

```
Store/
├── backend/
│   ├── controllers/
│   │   ├── adminController.js       # کاتالوگ، سفارش‌ها، گزارش‌ها، deploy
│   │   ├── productsController.js
│   │   ├── customersController.js
│   │   ├── ordersController.js      # پیش‌سفارش، سفارش با لینک، تایید قیمت
│   │   ├── paymentsController.js
│   │   ├── returnsController.js
│   │   ├── couponsController.js
│   │   ├── suppliersController.js
│   │   ├── productPhotosController.js
│   │   ├── messagesController.js    # چت سفارش (مشتری ↔ ادمین)
│   │   └── referralController.js
│   ├── middleware/
│   │   ├── adminAuth.js             # Bearer token ثابت (ADMIN_TOKEN)
│   │   ├── errorHandler.js
│   │   └── upload.js                # multer — تصویر و ویدیو
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── client.js
│   ├── scripts/
│   │   └── declineStaleQuotes.js    # کرون: رد خودکار قیمت‌های بی‌پاسخ بعد از ۱۴ روز
│   ├── routes/
│   ├── public/uploads/
│   └── server.js
│
├── frontend/
│   ├── index.html                   # صفحه اصلی
│   ├── product.html                 # صفحه محصول
│   ├── profile.html                 # پروفایل مشتری (سفارش‌ها، آدرس‌ها)
│   ├── admin.html                   # پنل مدیریت (خودکفا، یک فایل)
│   ├── refer.html                   # لندینگ معرفی دوستان
│   ├── style.css
│   ├── main.js                      # رندر، فیلتر، سبد خرید، سفارش، پروفایل
│   ├── i18n.js                      # ترجمه‌ها (FA / EN / TR)
│   └── products.js                  # (legacy — داده از API می‌آید)
│
└── deploy/
    └── auto-pull-staging.sh         # نسخه‌ی repo-تراک‌شده‌ی اسکریپت auto-pull روی VPS
```

---

## راه‌اندازی محلی

### پیش‌نیازها

- Node.js 18+
- PostgreSQL

### نصب و اجرا

```bash
cd backend
npm install
```

یک فایل `.env` در پوشه `backend` بسازید:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/shilista"
PORT=3001
FRONTEND_URL="http://localhost:8080"

ADMIN_USER="..."
ADMIN_PASS="..."
ADMIN_TOKEN="..."          # توکن ثابتی که بعد از لاگین موفق برگردانده می‌شود

SMTP_HOST="..."
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="..."
SMTP_PASS="..."
SMTP_FROM="Shilista <noreply@shilista.com>"

REFERRAL_SECRET="..."
SITE_URL="https://www.shilista.com"
```

```bash
npx prisma generate
node server.js
```

سرور روی `http://localhost:3001` بالا می‌آید.

فرانت‌اند را با یک سرور استاتیک ساده باز کنید (نه مستقیم از فایل، چون fetch نسبت به `file://` کار نمی‌کند):

```bash
cd frontend
python3 -m http.server 8080
```

> ⚠️ اسکیمای دیتابیس با `prisma/migrations` مدیریت نمی‌شود — تغییرات جدول به‌صورت دستی (`ALTER TABLE`/`ALTER TYPE`) روی دیتابیس اعمال می‌شوند، سپس `npx prisma generate`.

---

## API — خلاصه مسیرها

| بخش | نمونه مسیر | توضیح |
|-----|-----------|--------|
| محصولات | `GET /api/products`, `GET /api/products/:id` | لیست/جزئیات، فیلتر category/subcategory/gender |
| مشتری | `POST /api/customers/register`, `/login`, `/profile`, `/addresses`, `/favorites`, `/cart/sync` | احراز هویت با session token (هدر `x-session-token`) |
| سفارش | `POST /api/orders`, `POST /api/orders/link-request`, `GET /api/orders/my` | ثبت پیش‌سفارش / سفارش با لینک، لیست سفارش‌های من |
| تایید قیمت | `POST /api/orders/:id/quote/approve`, `/quote/reject` | تایید (با انتخاب/تعداد نهایی هر لینک) یا رد کامل قیمت اعلام‌شده |
| مرجوعی | `POST /api/orders/:id/returns`, `/defective` | درخواست مرجوع، گزارش کالای معیوب |
| ادمین | `POST /api/admin/login` | ورود، دریافت `ADMIN_TOKEN` |
| ادمین | `GET/POST/PUT/DELETE /api/admin/products` و مشابه برای دسته‌ها، رنگ، سایز | نیازمند هدر `Authorization: Bearer <ADMIN_TOKEN>` |
| ادمین | `PATCH /api/admin/orders/:orderId/link-items/:itemId/price` | قیمت‌گذاری یک لینک مشخص در سفارش چندلینکی |
| ادمین | `GET/POST /api/admin/deploy(/status)` | وضعیت/اجرای استقرار staging → production |

---

## استقرار (Deploy) — VPS

سایت روی یک VPS با `nginx` + `pm2` اجرا می‌شود. **پوش به `main` به‌تنهایی سایت زنده را آپدیت نمی‌کند.**

جریان کار:

```
git push main
     │
     ▼ (کرون هر ۲ دقیقه روی VPS)
/home/admin/Store-staging   ──git pull──▶   pm2: shilista-api-staging (:3002)
     │
     ▼  فقط از رنج داخلی/VPN با hosts-file entry (staging.internal) قابل مشاهده
پیش‌نمایش داخلی
     │  بعد از بررسی، ادمین از پنل واقعی (تنها روی production) دکمه را می‌زند
     ▼
POST /api/admin/deploy  ──▶  /home/admin/Store (git pull → rsync frontend → pm2 restart در صورت تغییر backend)
     ▼
production (shilista.com)
```

نکات مهم:
- **پنل ادمین (`/mp`, `admin.html`) روی staging وجود ندارد** — `nginx` روی staging عمداً همان مسیرها را ۴۰۴ می‌کند؛ تنها راه تست تغییرات `admin.html` خود production است.
- بعد از هر تغییری که `backend/schema.prisma` را لمس می‌کند، `npx prisma generate` باید اجرا شود (`npm install` به‌تنهایی کلاینت Prisma را رجنریت نمی‌کند) — هم در `auto-pull-staging.sh` و هم در `deployToProduction` این مرحله جدا انجام می‌شود.
- staging دیتابیس را با production **مشترک** دارد (نه دیسک را) — یک symlink بین `backend/public/uploads` این دو، هر بار توسط اسکریپت auto-pull دوباره برقرار می‌شود چون `git reset --hard` آن را حذف می‌کند.

---

## سیستم طراحی

| متغیر | مقدار | کاربرد |
|-------|-------|--------|
| `--primary` | `#FF5C00` | رنگ اصلی (نارنجی) |
| `--dark` | `#111111` | پس‌زمینه تیره (هدر، هیرو) |
| `--bg` | `#f5f5f5` | پس‌زمینه صفحه |
| `--radius` | `14px` | گوشه کارت‌ها |

فونت: [Vazirmatn](https://fonts.google.com/specimen/Vazirmatn) از Google Fonts
لوگو: نسخه‌ی روشن (پس‌زمینه سفید) در هدر سایت، نسخه‌ی تیره (`images/shilista_og_dark.jpg`) برای پیش‌نمایش لینک هنگام share

---

## تکنولوژی‌ها

**فرانت‌اند:** HTML5 / CSS3 / JavaScript (بدون فریم‌ورک، بدون build step) — cache-busting دستی با `?v=N` روی `main.js`/`i18n.js`/`style.css`
**بک‌اند:** Node.js / Express.js
**ORM:** Prisma (بدون migrations — DDL دستی روی دیتابیس)
**دیتابیس:** PostgreSQL
**آپلود فایل:** multer + sharp (پردازش تصویر)
**ایمیل:** nodemailer (SMTP)
**رمزنگاری رمز عبور:** bcrypt
**Rate limiting:** express-rate-limit (لاگین/ثبت‌نام/فراموشی رمز)
**Geo:** geoip-lite
**احراز هویت مشتری:** session token (جدول `sessions`، هدر `x-session-token`)
**احراز هویت ادمین:** Bearer token ثابت (`ADMIN_TOKEN`)، محدودشده با IP allowlist در nginx
**استقرار:** nginx + pm2 روی یک VPS، پایپ‌لاین staging → production داخل پنل ادمین

---

## مرورگرهای پشتیبانی‌شده

Chrome 90+ / Firefox 88+ / Safari 14+ / Edge 90+
