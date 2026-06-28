# ShilFit — فروشگاه تخصصی ورزشی

وبسایت فروشگاهی چندزبانه برای ShilFit.  
فرانت‌اند: HTML/CSS/JS خالص — بدون فریم‌ورک، بدون build tool.  
بک‌اند: Node.js + Express + Prisma + PostgreSQL.

---

## ویژگی‌های فرانت‌اند

- **چندزبانه** — فارسی / انگلیسی / ترکی با RTL/LTR خودکار
- **فیلتر محصولات** — drawer کشویی با فیلتر رنگ (multi-select) و سایز
- **مرتب‌سازی** — جدیدترین / قیمت صعودی-نزولی / پرفروش‌ترین
- **منوی Mega** — زیر "همه محصولات" ستون‌های داینامیک از API
- **منوی زنانه/مردانه** — زیردسته‌ها با label دسته‌بندی
- **پنهان‌سازی هوشمند** — subcategory بدون موجودی از منو پنهان می‌شود
- **سبد خرید** — slide-in panel با انتخاب رنگ و سایز، ذخیره در localStorage
- **علاقه‌مندی‌ها** — panel جداگانه با empty state
- **Modal محصول** — گالری تصویر/ویدیو، انتخاب رنگ و سایز، دکمه سفارش
- **Quick Add** — افزودن سریع بدون باز کردن modal کامل
- **سفارش واتساپ و تلگرام** — پیام آماده به فروشنده
- **ریسپانسیو** — موبایل، تبلت و دسکتاپ

## ویژگی‌های پنل ادمین (`admin.html`)

- ورود با نام کاربری و رمز عبور (JWT)
- مدیریت محصولات — افزودن، ویرایش، حذف، آپلود تصویر/ویدیو
- مدیریت دسته‌بندی‌ها و زیردسته‌ها
- مدیریت رنگ‌ها و سایزها
- مدیریت مشتریان و سفارش‌ها
- سوییچ زبان (FA / EN / TR)

---

## ساختار پروژه

```
Store/
├── backend/
│   ├── controllers/
│   │   ├── adminController.js
│   │   ├── productsController.js
│   │   ├── customersController.js
│   │   ├── ordersController.js
│   │   └── paymentsController.js
│   ├── middleware/
│   │   ├── adminAuth.js       # JWT authentication
│   │   ├── errorHandler.js
│   │   └── upload.js          # multer — تصویر و ویدیو
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── client.js
│   │   └── seed.js
│   ├── routes/
│   │   ├── admin.js
│   │   ├── products.js
│   │   ├── customers.js
│   │   ├── orders.js
│   │   └── payments.js
│   ├── public/uploads/        # فایل‌های آپلودشده
│   ├── server.js
│   └── package.json
│
└── frontend/
    ├── index.html             # صفحه اصلی (RTL، فونت Vazirmatn)
    ├── admin.html             # پنل مدیریت
    ├── style.css              # تمام استایل‌ها (CSS variables، ریسپانسیو)
    ├── main.js                # رندر، فیلتر، سبد خرید، مدال
    ├── i18n.js                # ترجمه‌ها (FA / EN / TR)
    └── products.js            # (legacy — داده از API می‌آید)
```

---

## راه‌اندازی

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
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/shilfit"
JWT_SECRET="your-secret-key"
PORT=3001
```

```bash
# ساخت جداول دیتابیس
npx prisma migrate dev

# (اختیاری) پر کردن داده اولیه
node prisma/seed.js

# اجرای سرور
node server.js
```

سرور روی `http://localhost:3001` بالا می‌آید.

فرانت‌اند را در مرورگر باز کنید — یا با یک سرور ساده:

```bash
cd frontend
npx serve .
```

---

## API — مسیرهای اصلی

| Method | Route | توضیح |
|--------|-------|--------|
| `GET` | `/api/products` | لیست محصولات (با فیلتر category/subcategory/gender) |
| `GET` | `/api/products/:id` | جزئیات یک محصول |
| `GET` | `/api/categories` | دسته‌بندی‌ها و زیردسته‌ها |
| `GET` | `/api/colors` | لیست رنگ‌ها |
| `GET` | `/api/sizes` | لیست سایزها |
| `POST` | `/api/admin/login` | ورود ادمین — دریافت JWT |
| `POST` | `/api/products` | افزودن محصول (نیاز به JWT) |
| `PUT` | `/api/products/:id` | ویرایش محصول (نیاز به JWT) |
| `DELETE` | `/api/products/:id` | حذف محصول (نیاز به JWT) |

---

## سیستم طراحی

| متغیر | مقدار | کاربرد |
|-------|-------|--------|
| `--primary` | `#FF6200` | رنگ اصلی (نارنجی) |
| `--dark` | `#111111` | پس‌زمینه تیره |
| `--bg` | `#f5f5f5` | پس‌زمینه صفحه |
| `--radius` | `14px` | گوشه کارت‌ها |

فونت: [Vazirmatn](https://fonts.google.com/specimen/Vazirmatn) از Google Fonts

---

## تکنولوژی‌ها

**فرانت‌اند:** HTML5 / CSS3 / JavaScript (ES5+) — بدون فریم‌ورک  
**بک‌اند:** Node.js / Express.js  
**ORM:** Prisma  
**دیتابیس:** PostgreSQL  
**آپلود فایل:** multer  
**احراز هویت:** JWT  
**ذخیره محلی:** localStorage (سبد خرید، علاقه‌مندی‌ها، زبان)

---

## مرورگرهای پشتیبانی‌شده

Chrome 90+ / Firefox 88+ / Safari 14+ / Edge 90+
