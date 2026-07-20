const nodemailer = require('nodemailer');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '../../frontend/images');

const EMAIL_LOGO_URL      = 'cid:email-logo@shilista';
const EMAIL_ICON_TELEGRAM = 'cid:icon-telegram@shilista';
const EMAIL_ICON_INSTAGRAM= 'cid:icon-instagram@shilista';

const EMAIL_ATTACHMENTS = [
  { filename: 'shilista_email_logo.jpg', path: path.join(IMAGES_DIR, 'shilista_email_logo.jpg'), cid: 'email-logo@shilista' },
  { filename: 'icon_telegram.png',       path: path.join(IMAGES_DIR, 'icon_telegram.png'),       cid: 'icon-telegram@shilista' },
  { filename: 'icon_instagram.png',      path: path.join(IMAGES_DIR, 'icon_instagram.png'),      cid: 'icon-instagram@shilista' },
];

const FOOTER_TR = `
      <tr>
        <td style="background:#2d1a0e;padding:28px 32px 24px;border-top:2px solid #c0562a">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:center;padding-bottom:18px">
                <!-- Instagram -->
                <a href="https://instagram.com/shilistaa" style="display:inline-block;margin:0 8px;text-decoration:none;vertical-align:middle">
                  <table cellpadding="0" cellspacing="0" style="display:inline-table">
                    <tr>
                      <td style="vertical-align:middle">
                        <img src="${EMAIL_ICON_INSTAGRAM}" alt="Instagram" width="32" height="32" style="width:32px;height:32px;display:inline-block;vertical-align:middle;border-radius:8px">
                        <span style="color:#fff;font-size:13px;font-weight:700;font-family:Arial,sans-serif;vertical-align:middle;margin-left:6px">@shilistaa</span>
                      </td>
                    </tr>
                  </table>
                </a>
                <!-- Telegram -->
                <a href="https://t.me/Shilistaa" style="display:inline-block;margin:0 8px;text-decoration:none;vertical-align:middle">
                  <table cellpadding="0" cellspacing="0" style="display:inline-table">
                    <tr>
                      <td style="vertical-align:middle">
                        <img src="${EMAIL_ICON_TELEGRAM}" alt="Telegram" width="32" height="32" style="width:32px;height:32px;display:inline-block;vertical-align:middle">
                        <span style="color:#fff;font-size:13px;font-weight:700;font-family:Arial,sans-serif;vertical-align:middle;margin-left:6px">@Shilistaa</span>
                      </td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>
            <tr>
              <td style="text-align:center;padding-top:4px">
                <!-- Email -->
                <a href="mailto:sales@shilista.com" style="display:inline-block;margin:0 6px;text-decoration:none;vertical-align:middle">
                  <table cellpadding="0" cellspacing="0" style="display:inline-table">
                    <tr>
                      <td style="vertical-align:middle">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f0a070" stroke-width="2" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <span style="color:#f0a070;font-size:12px;font-family:Arial,sans-serif;vertical-align:middle;margin-left:4px">sales@shilista.com</span>
                      </td>
                    </tr>
                  </table>
                </a>
                <span style="color:#555;margin:0 4px;vertical-align:middle">&middot;</span>
                <!-- Website -->
                <a href="https://shilista.com" style="display:inline-block;margin:0 6px;text-decoration:none;vertical-align:middle">
                  <table cellpadding="0" cellspacing="0" style="display:inline-table">
                    <tr>
                      <td style="vertical-align:middle">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f0a070" stroke-width="2" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                        <span style="color:#f0a070;font-size:12px;font-family:Arial,sans-serif;vertical-align:middle;margin-left:4px">www.shilista.com</span>
                      </td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

function fmt(amount) {
  return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
}

// ─── Multilingual labels ───────────────────────────────────────────────────────
const L = {
  fa: {
    order_num:       'شماره سفارش',
    order_date:      'تاریخ سفارش',
    product:         'محصول',
    color:           'رنگ',
    size:            'سایز',
    qty:             'تعداد',
    unit_price:      'قیمت واحد',
    total:           'مجموع',
    order_total:     'جمع کل سفارش',
    bank_name:       'بانک',
    account_holder:  'صاحب حساب',
    iban:            'شماره حساب / IBAN',
    carrier:         'شرکت پست',
    tracking:        'کد رهگیری',
    reject_reason:   'دلیل رد',
    thanks:          'با تشکر از خرید شما',
    dir:             'rtl',

    preorder_subject:  'تایید دریافت سفارش — Shilista #{{id}}',
    preorder_title:    'سفارش شما دریافت شد',
    preorder_body:     'سفارش شما با موفقیت ثبت شد و در حال بررسی است. به زودی اطلاعات پرداخت برای شما ارسال می‌شود.',

    payment_needed_subject: 'اطلاعات پرداخت سفارش — Shilista #{{id}}',
    payment_needed_title:   'لطفاً وجه سفارش را واریز کنید',
    payment_needed_body:    'لطفاً مبلغ سفارش را به حساب زیر واریز کنید و سپس رسید پرداخت را در سایت بارگذاری کنید.',

    receipt_received_subject: 'رسید پرداخت دریافت شد — Shilista #{{id}}',
    receipt_received_title:   'رسید پرداخت شما دریافت شد',
    receipt_received_body:    'رسید پرداخت شما دریافت و در دست بررسی است. نتیجه به زودی اطلاع داده می‌شود.',

    preparing_subject: 'پرداخت تایید شد — Shilista #{{id}}',
    preparing_title:   'پرداخت تایید شد، در حال آماده‌سازی',
    preparing_body:    'پرداخت شما تایید شد و سفارشتان در حال آماده‌سازی برای ارسال است.',

    rejected_subject: 'رسید پرداخت رد شد — Shilista #{{id}}',
    rejected_title:   'رسید پرداخت تایید نشد',
    rejected_body:    'متأسفانه رسید پرداخت شما تایید نشد. لطفاً مجدداً رسید را بارگذاری کنید.',

    delivery_subject: 'سفارش شما ارسال شد — Shilista #{{id}}',
    delivery_title:   'سفارش شما ارسال شد!',
    delivery_body:    'سفارش شما ارسال شد. می‌توانید با اطلاعات زیر مرسوله خود را ردیابی کنید.',

    delivered_subject: 'سفارش شما تحویل داده شد — Shilista #{{id}}',
    delivered_title:   'سفارش شما تحویل داده شد!',
    delivered_body:    'سفارش شما با موفقیت تحویل داده شد. از خرید از Shilista متشکریم!',

    cancelled_subject: 'سفارش لغو شد — Shilista #{{id}}',
    cancelled_title:   'سفارش شما لغو شد',
    cancelled_body:    'سفارش شما لغو شد. در صورت پرداخت وجه، مبلغ ظرف ۷۲ ساعت بازگشت داده می‌شود.',

    preorder_rejected_subject: 'پیش‌سفارش رد شد — Shilista #{{id}}',
    preorder_rejected_title:   'پیش‌سفارش شما تأیید نشد',
    preorder_rejected_body:    'متأسفانه پیش‌سفارش شما پس از بررسی تأیید نشد. در صورت نیاز به اطلاعات بیشتر با ما تماس بگیرید.',
  },
  en: {
    order_num:       'Order Number',
    order_date:      'Order Date',
    product:         'Product',
    color:           'Color',
    size:            'Size',
    qty:             'Qty',
    unit_price:      'Unit Price',
    total:           'Total',
    order_total:     'Order Total',
    bank_name:       'Bank',
    account_holder:  'Account Holder',
    iban:            'Account No. / IBAN',
    carrier:         'Carrier',
    tracking:        'Tracking Code',
    reject_reason:   'Reason',
    thanks:          'Thank you for shopping with us',
    dir:             'ltr',

    preorder_subject:  'Order Received — Shilista #{{id}}',
    preorder_title:    'Your order has been received',
    preorder_body:     'Your order has been successfully placed and is under review. Payment details will be sent to you shortly.',

    payment_needed_subject: 'Payment Details — Shilista #{{id}}',
    payment_needed_title:   'Please complete your payment',
    payment_needed_body:    'Please transfer the order amount to the account below, then upload your payment receipt on the website.',

    receipt_received_subject: 'Receipt Received — Shilista #{{id}}',
    receipt_received_title:   'Your payment receipt has been received',
    receipt_received_body:    'Your payment receipt has been received and is under review. We will notify you shortly.',

    preparing_subject: 'Payment Approved — Shilista #{{id}}',
    preparing_title:   'Payment approved — preparing your order',
    preparing_body:    'Your payment has been approved and your order is being prepared for shipping.',

    rejected_subject: 'Receipt Rejected — Shilista #{{id}}',
    rejected_title:   'Payment receipt was not approved',
    rejected_body:    'Unfortunately your payment receipt was not approved. Please re-upload a valid receipt.',

    delivery_subject: 'Your Order Has Shipped — Shilista #{{id}}',
    delivery_title:   'Your order is on its way!',
    delivery_body:    'Your order has been shipped. Use the details below to track your package.',

    delivered_subject: 'Order Delivered — Shilista #{{id}}',
    delivered_title:   'Your order has been delivered!',
    delivered_body:    'Your order has been successfully delivered. Thank you for shopping with Shilista!',

    cancelled_subject: 'Order Cancelled — Shilista #{{id}}',
    cancelled_title:   'Your order has been cancelled',
    cancelled_body:    'Your order has been cancelled. If payment was made, a refund will be issued within 72 hours.',

    preorder_rejected_subject: 'Pre-order Rejected — Shilista #{{id}}',
    preorder_rejected_title:   'Your pre-order was not approved',
    preorder_rejected_body:    'Unfortunately your pre-order was not approved after review. Please contact us for more information.',
  },
  tr: {
    order_num:       'Sipariş Numarası',
    order_date:      'Sipariş Tarihi',
    product:         'Ürün',
    color:           'Renk',
    size:            'Beden',
    qty:             'Adet',
    unit_price:      'Birim Fiyat',
    total:           'Toplam',
    order_total:     'Sipariş Toplamı',
    bank_name:       'Banka',
    account_holder:  'Hesap Sahibi',
    iban:            'Hesap No. / IBAN',
    carrier:         'Kargo Firması',
    tracking:        'Takip Kodu',
    reject_reason:   'Red Sebebi',
    thanks:          'Alışverişiniz için teşekkür ederiz',
    dir:             'ltr',

    preorder_subject:  'Sipariş Alındı — Shilista #{{id}}',
    preorder_title:    'Siparişiniz alındı',
    preorder_body:     'Siparişiniz başarıyla oluşturuldu ve inceleniyor. Ödeme bilgileri yakında gönderilecektir.',

    payment_needed_subject: 'Ödeme Bilgileri — Shilista #{{id}}',
    payment_needed_title:   'Lütfen ödemenizi tamamlayın',
    payment_needed_body:    'Sipariş tutarını aşağıdaki hesaba havale edin, ardından ödeme dekontunuzu siteye yükleyin.',

    receipt_received_subject: 'Dekont Alındı — Shilista #{{id}}',
    receipt_received_title:   'Ödeme dekontunuz alındı',
    receipt_received_body:    'Ödeme dekontunuz alındı ve inceleniyor. Sonuç en kısa sürede bildirilecektir.',

    preparing_subject: 'Ödeme Onaylandı — Shilista #{{id}}',
    preparing_title:   'Ödeme onaylandı — sipariş hazırlanıyor',
    preparing_body:    'Ödemeniz onaylandı ve siparişiniz kargoya hazırlanıyor.',

    rejected_subject: 'Dekont Reddedildi — Shilista #{{id}}',
    rejected_title:   'Ödeme dekontu onaylanmadı',
    rejected_body:    'Maalesef ödeme dekontunuz onaylanmadı. Lütfen geçerli bir dekont tekrar yükleyin.',

    delivery_subject: 'Siparişiniz Kargoya Verildi — Shilista #{{id}}',
    delivery_title:   'Siparişiniz yola çıktı!',
    delivery_body:    'Siparişiniz kargoya verildi. Aşağıdaki bilgilerle takip edebilirsiniz.',

    delivered_subject: 'Sipariş Teslim Edildi — Shilista #{{id}}',
    delivered_title:   'Siparişiniz teslim edildi!',
    delivered_body:    'Siparişiniz başarıyla teslim edildi. Shilista\'dan alışveriş ettiğiniz için teşekkürler!',

    cancelled_subject: 'Sipariş İptal Edildi — Shilista #{{id}}',
    cancelled_title:   'Siparişiniz iptal edildi',
    cancelled_body:    'Siparişiniz iptal edildi. Ödeme yapıldıysa 72 saat içinde iade edilecektir.',

    preorder_rejected_subject: 'Ön Sipariş Reddedildi — Shilista #{{id}}',
    preorder_rejected_title:   'Ön siparişiniz onaylanmadı',
    preorder_rejected_body:    'Maalesef ön siparişiniz inceleme sonucunda onaylanmadı. Daha fazla bilgi için bizimle iletişime geçin.',
  },
};

// ─── Build items table HTML ────────────────────────────────────────────────────
function buildItemsTable(order, lang, l) {
  const rows = order.order_items.map(function(item) {
    const p    = item.products || {};
    const name = p['name_' + lang] || p.name_fa || '';
    const color = item.colors ? (item.colors['name_' + lang] || item.colors.name_fa || '') : '—';
    const size  = item.size_label || '—';
    const price = fmt(item.unit_price);
    const total = fmt(Number(item.unit_price) * item.qty);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:14px;color:#2d1a0e">
          ${name}${p.code ? '<br><span style="font-size:11px;color:#aaa;font-family:monospace">' + p.code + '</span>' : ''}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:13px;color:#666;text-align:center">${color}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:13px;color:#666;text-align:center">${size}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:13px;color:#666;text-align:center">${item.qty}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:13px;color:#666;text-align:center;direction:ltr">${price}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0e8df;font-size:13px;font-weight:700;color:#c0562a;text-align:center;direction:ltr">${total}</td>
      </tr>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #f0e8df;border-radius:8px;overflow:hidden;margin-bottom:20px">
      <thead>
        <tr style="background:#fdf5ed">
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:${lang === 'fa' ? 'right' : 'left'}">${l.product}</th>
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:center">${l.color}</th>
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:center">${l.size}</th>
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:center">${l.qty}</th>
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:center">${l.unit_price}</th>
          <th style="padding:10px 12px;font-size:12px;color:#a07050;font-weight:600;text-align:center">${l.total}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Extra info block (bank, tracking, reject reason) ─────────────────────────
function buildInfoBlock(items) {
  if (!items || !items.length) return '';
  const rows = items.filter(function(r) { return r.value; }).map(function(r) {
    return `<tr>
      <td style="padding:8px 12px;font-size:13px;color:#888;width:40%">${r.label}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2d1a0e;direction:${r.dir || 'ltr'}">${r.value}</td>
    </tr>`;
  }).join('');
  if (!rows) return '';
  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="border-collapse:collapse;background:#fdf5ed;border:1px solid #f0e8df;border-radius:8px;margin-bottom:20px">
    ${rows}
  </table>`;
}

// ─── Referral section labels ──────────────────────────────────────────────────
const REFER = {
  fa: {
    heading: '🎁 دوستانتان را به Shilista دعوت کنید!',
    body:    'اگر دوستی دارید که دوست دارد از Shilista خرید کند، ایمیل او را با ما در میان بگذارید. ما یک کد تخفیف ویژه برای خرید اول او ارسال می‌کنیم!',
    btn:     'دعوت از دوست',
  },
  en: {
    heading: '🎁 Share Shilista with a friend!',
    body:    'Know someone who would love shopping at Shilista? Share their email with us and we\'ll send them an exclusive discount code for their first purchase!',
    btn:     'Refer a Friend',
  },
  tr: {
    heading: '🎁 Arkadaşını Shilista\'ya davet et!',
    body:    'Shilista\'dan alışveriş etmekten keyif alacak bir arkadaşın var mı? E-postasını bizimle paylaş, ilk alışverişi için özel bir indirim kodu gönderelim!',
    btn:     'Arkadaşını Davet Et',
  },
};

function buildReferralBlock(lang, referralUrl, dir) {
  const r = REFER[lang] || REFER.en;
  return `
<tr>
  <td style="padding:0 32px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:linear-gradient(135deg,#fff8f3,#fdeee3);border:1.5px solid #f0c8a0;border-radius:12px;padding:22px 24px">
      <tr>
        <td style="text-align:center">
          <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#c0562a">${r.heading}</p>
          <p style="margin:0 0 18px;font-size:13px;color:#666;line-height:1.7;direction:${dir}">${r.body}</p>
          <a href="${referralUrl}"
            style="display:inline-block;background:#c0562a;color:#fff;font-size:14px;font-weight:700;
                   padding:11px 28px;border-radius:8px;text-decoration:none;letter-spacing:.3px">
            ${r.btn}
          </a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

// ─── Build full HTML email ─────────────────────────────────────────────────────
function buildHtml(type, order, customer, extraInfo) {
  const lang = (order.lang || customer.preferred_lang || 'fa').substring(0, 2);
  const l    = L[lang] || L.fa;
  const dir  = l.dir;

  const subject = (l[type + '_subject'] || '').replace('{{id}}', order.id);
  const title   = l[type + '_title']   || '';
  const body    = l[type + '_body']    || '';
  const dateStr = new Date(order.created_at).toLocaleDateString(
    lang === 'fa' ? 'fa-IR' : lang === 'tr' ? 'tr-TR' : 'en-US'
  );

  const itemsTable  = buildItemsTable(order, lang, l);
  const infoBlock   = buildInfoBlock(extraInfo);
  const totalAmount = fmt(order.total_amount);

  let referralBlock = '';
  if (type === 'delivered' && process.env.SITE_URL) {
    const { signReferralToken } = require('../controllers/referralController');
    const refToken = signReferralToken(customer.id, order.id);
    const referralUrl = `${process.env.SITE_URL}/refer.html?t=${refToken}`;
    referralBlock = buildReferralBlock(lang, referralUrl, dir);
  }

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

      <!-- Header -->
      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>

      <!-- Status banner -->
      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:20px 32px;text-align:center">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:.5px">${title}</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:28px 32px">

          <!-- Order meta -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            <tr>
              <td style="font-size:13px;color:#888">${l.order_num}</td>
              <td style="font-size:13px;font-weight:700;color:#2d1a0e;text-align:${dir === 'rtl' ? 'left' : 'right'}">#${order.id}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#888;padding-top:4px">${l.order_date}</td>
              <td style="font-size:13px;color:#666;text-align:${dir === 'rtl' ? 'left' : 'right'};padding-top:4px">${dateStr}</td>
            </tr>
          </table>

          <!-- Body text -->
          <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">${body}</p>

          <!-- Extra info (bank/tracking/reason) -->
          ${infoBlock}

          <!-- Items table -->
          ${itemsTable}

          <!-- Total -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            <tr>
              <td style="font-size:15px;font-weight:700;color:#2d1a0e">${l.order_total}</td>
              <td style="font-size:18px;font-weight:700;color:#c0562a;text-align:${dir === 'rtl' ? 'left' : 'right'};direction:ltr">${totalAmount}</td>
            </tr>
          </table>

        </td>
      </tr>

      <!-- Referral block (delivered only) -->
      ${referralBlock}

      <!-- Footer -->
      ${FOOTER_TR}

    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html };
}

// ─── sendOrderEmail ────────────────────────────────────────────────────────────
async function sendOrderEmail(customer, order, type, extraInfo, attachFiles) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;

  const { subject, html } = buildHtml(type, order, customer, extraInfo);

  const attachments = [...EMAIL_ATTACHMENTS, ...(attachFiles || [])];

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject,
    html,
    attachments,
  });
}

// ─── Friend invite email (BESTIE5 referral) ───────────────────────────────────
const INVITE = {
  fa: {
    subject: 'یک هدیه ویژه برای شما از طرف {{referrer}} — Shilista',
    title:   '🎁 یک هدیه ویژه منتظر شماست!',
    body1:   '{{referrer}} شما را به Shilista دعوت کرده است.',
    body2:   'Shilista مقصد شما برای خرید محصولات باکیفیت است. همین حالا ثبت‌نام کنید و از کد تخفیف اختصاصی خود برای اولین خرید لذت ببرید!',
    code_label: 'کد تخفیف اختصاصی شما:',
    body3:   'این کد فقط یک‌بار قابل استفاده است. عجله کنید و از تخفیف خود استفاده کنید!',
    btn:     'خرید کنید',
    footer:  'اگر به این ایمیل اهمیت نمی‌دهید، آن را نادیده بگیرید.',
    dir:     'rtl',
  },
  en: {
    subject: 'A special gift for you from {{referrer}} — Shilista',
    title:   '🎁 You\'ve got a special gift!',
    body1:   '{{referrer}} thought you\'d love Shilista.',
    body2:   'Shilista is your destination for premium quality products. Sign up now and enjoy an exclusive discount on your first purchase!',
    code_label: 'Your exclusive discount code:',
    body3:   'This code can be used only once. Don\'t miss out!',
    btn:     'Shop Now',
    footer:  'If you didn\'t expect this email, you can safely ignore it.',
    dir:     'ltr',
  },
  tr: {
    subject: '{{referrer}} sana özel bir hediye gönderdi — Shilista',
    title:   '🎁 Sana özel bir hediye var!',
    body1:   '{{referrer}}, seni Shilista ile tanıştırmak istedi.',
    body2:   'Shilista, kaliteli ürünler için doğru adresiniz. Hemen üye olun ve ilk alışverişinizde özel indirim kodunuzun keyfini çıkarın!',
    code_label: 'Özel indirim kodunuz:',
    body3:   'Bu kod yalnızca bir kez kullanılabilir. Kaçırmayın!',
    btn:     'Alışverişe Başla',
    footer:  'Bu e-postayı beklemediyseniz dikkate almayabilirsiniz.',
    dir:     'ltr',
  },
};

async function sendFriendInviteEmail({ toName, toEmail, referrerName, lang, trackingToken, couponValue, couponType }) {
  const transporter = getTransporter();
  if (!transporter) return;
  const ll  = INVITE[lang] || INVITE.en;
  const dir = ll.dir;
  const ref = referrerName || 'A friend';
  const discountText = couponType === 'percent'
    ? `%${couponValue}`
    : `${Number(couponValue).toFixed(2)} TL`;
  const siteUrl = process.env.SITE_URL || 'https://shilista.com';
  const trackPixel = trackingToken
    ? `<img src="${siteUrl}/api/refer/track/${trackingToken}" width="1" height="1" style="display:block;border:0" alt="">`
    : '';

  const subject = ll.subject.replace('{{referrer}}', ref);
  const body1   = ll.body1.replace('{{referrer}}', ref);

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <span style="font-size:26px;font-weight:700;color:#c0562a;letter-spacing:1px;font-family:Arial,sans-serif">Shilista</span>
        </td>
      </tr>

      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:22px 32px;text-align:center">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff">${ll.title}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:32px 32px 0">
          ${toName ? `<p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#2d1a0e">${toName},</p>` : ''}
          <p style="margin:0 0 12px;font-size:14px;color:#555;line-height:1.75">${body1}</p>
          <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.75">${ll.body2}</p>

          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#fdf5ed;border:2px dashed #e07a40;border-radius:12px;margin-bottom:20px">
            <tr>
              <td style="padding:20px;text-align:center">
                <p style="margin:0 0 10px;font-size:13px;color:#a07050;font-weight:600">${ll.code_label}</p>
                <p style="margin:0 0 8px;font-size:32px;font-weight:800;color:#c0562a;letter-spacing:4px;font-family:monospace">BESTIE</p>
                <p style="margin:0;font-size:13px;color:#e07a40;font-weight:700">${discountText} ${lang === 'fa' ? 'تخفیف' : lang === 'tr' ? 'indirim' : 'off'}</p>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.6">${ll.body3}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
            <tr>
              <td style="text-align:center">
                <a href="${siteUrl}?lang=tr"
                  style="display:inline-block;background:#c0562a;color:#fff;font-size:15px;font-weight:700;
                         padding:13px 36px;border-radius:9px;text-decoration:none;letter-spacing:.3px">
                  ${ll.btn}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${FOOTER_TR}
      ${trackPixel ? `<tr><td style="line-height:0;font-size:0">${trackPixel}</td></tr>` : ''}

    </table>
  </td></tr>
</table>
</body></html>`;

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          toEmail,
    subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

async function sendRawEmail(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter || !to) return;
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

function label(key, lang) {
  const l = L[lang] || L.fa;
  return l[key] || key;
}

const REPLY_L = {
  fa: { subject: 'پاسخ به پیام شما — Shilista #{{id}}', intro: 'پاسخ تیم پشتیبانی Shilista به پیام شما:' },
  en: { subject: 'Reply to your message — Shilista #{{id}}', intro: 'Reply from Shilista support team to your message:' },
  tr: { subject: 'Mesajınıza yanıt — Shilista #{{id}}', intro: 'Shilista destek ekibinden mesajınıza yanıt:' },
};

async function sendReplyEmail(customer, order, replyText) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;
  const lang = (order.lang || customer.preferred_lang || 'fa').substring(0, 2);
  const l    = REPLY_L[lang] || REPLY_L.fa;
  const dir  = lang === 'fa' ? 'rtl' : 'ltr';
  const subject = l.subject.replace('{{id}}', order.id);
  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      <tr><td style="background:#fff;padding:24px 32px 16px;border-bottom:2px solid #f0e8df;text-align:center">
        <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
      </td></tr>
      <tr><td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:16px 32px;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:700;color:#fff">${subject}</p>
      </td></tr>
      <tr><td style="padding:28px 32px">
        <p style="margin:0 0 12px;font-size:14px;color:#555">${l.intro}</p>
        <div style="background:#f9f5f2;border-left:4px solid #c0562a;padding:14px 18px;border-radius:6px;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${replyText}</div>
      </td></tr>
      ${FOOTER_TR}
    </table>
  </td></tr>
</table>
</body></html>`;
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: customer.email, subject, html, attachments: EMAIL_ATTACHMENTS });
}

// ─── Loyalty milestone email ────────────────────────────────────────────────────
const LOYALTY_L = {
  fa: {
    dir: 'rtl',
    prize1_subject: '🎁 جایزه اولت آماده‌ست! — Shilista',
    prize1_title:   '🎁 جایزه اول باشگاه وفاداری فعال شد!',
    prize1_body:    'به خاطر {{count}} خرید موفق در Shilista، جایزه اول دوره فعلی باشگاه وفاداری برای شما فعال شده است.\n\nبرای دریافت کد تخفیف اختصاصی‌تان وارد پروفایل خود شوید و روی دکمه «🎉 دریافت!» در کارت وفاداری کلیک کنید.',
    prize2_subject: '🏆 جایزه ویژه‌ات آماده‌ست! — Shilista',
    prize2_title:   '🏆 جایزه ویژه باشگاه وفاداری فعال شد!',
    prize2_body:    'با تکمیل ۶ خرید موفق در این دوره، جایزه ویژه باشگاه وفاداری Shilista برای شما فعال شد!\n\nوارد پروفایل خود شوید تا جایزه ویژه‌تان را دریافت کنید.',
    btn:            'مشاهده پروفایل',
  },
  en: {
    dir: 'ltr',
    prize1_subject: '🎁 Your Prize is Ready! — Shilista',
    prize1_title:   '🎁 Loyalty Club Prize 1 Unlocked!',
    prize1_body:    "You've completed {{count}} successful purchases at Shilista! Your first prize for this loyalty cycle is now ready to claim.\n\nVisit your profile and click \"🎉 Claim!\" on your loyalty card to get your exclusive discount code.",
    prize2_subject: '🏆 Your Special Prize is Ready! — Shilista',
    prize2_title:   '🏆 Loyalty Club Special Prize Unlocked!',
    prize2_body:    "Amazing! You've completed 6 purchases in this loyalty cycle — your special prize is now ready!\n\nVisit your profile to claim your special reward.",
    btn:            'View Profile',
  },
  tr: {
    dir: 'ltr',
    prize1_subject: '🎁 Ödülün Hazır! — Shilista',
    prize1_title:   '🎁 Sadakat Kulübü 1. Ödül Açıldı!',
    prize1_body:    "Shilista'da {{count}} başarılı alışveriş tamamladınız! Bu dönemin ilk ödülünüz hazır.\n\nProfilinize gidin ve sadakat kartınızdaki \"🎉 Al!\" düğmesine tıklayarak özel indirim kodunuzu alın.",
    prize2_subject: '🏆 Özel Ödülün Hazır! — Shilista',
    prize2_title:   '🏆 Sadakat Kulübü Özel Ödül Açıldı!',
    prize2_body:    "Harika! Bu dönemde 6 alışveriş tamamladınız — özel ödülünüz hazır!\n\nÖzel ödülünüzü almak için profilinizi ziyaret edin.",
    btn:            'Profile Git',
  },
};

async function sendLoyaltyEmail(customer, deliveredCount) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;

  const lang = (customer.preferred_lang || 'fa').substring(0, 2);
  const ll   = LOYALTY_L[lang] || LOYALTY_L.fa;
  const dir  = ll.dir;

  const isPrize2   = deliveredCount % 6 === 0;
  const subject    = isPrize2 ? ll.prize2_subject : ll.prize1_subject;
  const title      = isPrize2 ? ll.prize2_title   : ll.prize1_title;
  const body       = (isPrize2 ? ll.prize2_body : ll.prize1_body).replace('{{count}}', deliveredCount);
  const siteUrl    = process.env.SITE_URL || 'https://shilista.com';
  const profileUrl = `${siteUrl}/profile.html?tab=loyalty`;

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>

      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:20px 32px;text-align:center">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px">${title}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:32px 32px 24px">
          <p style="margin:0 0 28px;font-size:15px;color:#444;line-height:1.9;white-space:pre-line">${body}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${profileUrl}"
                  style="display:inline-block;background:#c0562a;color:#fff;font-size:15px;font-weight:700;
                         padding:13px 36px;border-radius:8px;text-decoration:none;letter-spacing:.3px">
                  ${ll.btn}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${FOOTER_TR}

    </table>
  </td></tr>
</table>
</body></html>`;

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

// ─── Prize earned email ──────────────────────────────────────────────────────────
const PRIZE_EARNED_L = {
  fa: {
    dir:     'rtl',
    subject: '🏆 جایزه شما آماده ارسال است! — Shilista',
    title:   '🏆 تبریک! جایزه وفاداری شما ثبت شد',
    body:    'شما موفق به کسب جایزه وفاداری Shilista شدید!\n\nبه زودی هدیه‌ای از طرف ما به آدرس پیش‌فرض شما ارسال خواهد شد.\n\nوضعیت ارسال را می‌توانید در لیست سفارشات خود مشاهده کنید.',
    btn:     'مشاهده سفارشات',
  },
  en: {
    dir:     'ltr',
    subject: '🏆 Your Loyalty Prize is on its way! — Shilista',
    title:   '🏆 Congratulations! Your Prize is Registered',
    body:    "You've earned a loyalty prize from Shilista!\n\nA gift will be sent to your default address soon.\n\nYou can track the shipping status in your orders list.",
    btn:     'View Orders',
  },
  tr: {
    dir:     'ltr',
    subject: '🏆 Sadakat Ödülünüz Yolda! — Shilista',
    title:   '🏆 Tebrikler! Ödülünüz Kaydedildi',
    body:    "Shilista sadakat ödülünüzü kazandınız!\n\nYakında varsayılan adresinize bir hediye gönderilecek.\n\nKargo durumunu sipariş listenizden takip edebilirsiniz.",
    btn:     'Siparişleri Görüntüle',
  },
};

async function sendPrizeEarnedEmail(customer) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;
  const lang    = (customer.preferred_lang || 'fa').substring(0, 2);
  const ll      = PRIZE_EARNED_L[lang] || PRIZE_EARNED_L.fa;
  const siteUrl = process.env.SITE_URL || 'https://shilista.com';
  const ordersUrl = `${siteUrl}/profile.html?tab=orders`;

  const html = `<!DOCTYPE html>
<html dir="${ll.dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${ll.dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>
      <tr>
        <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:20px 32px;text-align:center">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px">${ll.title}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 24px">
          <p style="margin:0 0 28px;font-size:15px;color:#444;line-height:1.9;white-space:pre-line">${ll.body}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${ordersUrl}" style="display:inline-block;background:#7c3aed;color:#fff;font-size:15px;font-weight:700;padding:13px 36px;border-radius:8px;text-decoration:none;letter-spacing:.3px">${ll.btn}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${FOOTER_TR}
    </table>
  </td></tr>
</table>
</body></html>`;

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject:     ll.subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

// ─── Birthday email ─────────────────────────────────────────────────────────────
const BIRTHDAY_L = {
  fa: {
    dir:        'rtl',
    subject:    '🎂 Tavallodet Mobarak! — Shilista',
    title:      '🎂 Tavallod-e Shad!',
    body:       'Farda rouze tavallode shomast va ma mikhaim in rouz ro baraye shoma khasstani tar konim!\n\nBa in kod takhfif 10% baraye kharideto hadye bede:',
    code_label: 'Kod Takhfif:',
    note:       (from, to) => `In kod az ${from} ta ${to} etebare dare (10 rouz).`,
    btn:        'Kharid Kon',
  },
  en: {
    dir:        'ltr',
    subject:    '🎂 Happy Birthday! — Shilista',
    title:      '🎂 Happy Birthday!',
    body:       "Tomorrow is your special day and we want to make it even better!\n\nEnjoy 10% off your next order with this exclusive birthday gift:",
    code_label: 'Your Discount Code:',
    note:       (from, to) => `Valid from ${from} until ${to} (10 days).`,
    btn:        'Shop Now',
  },
  tr: {
    dir:        'ltr',
    subject:    '🎂 Doğum Günün Kutlu Olsun! — Shilista',
    title:      '🎂 Doğum Günün Kutlu Olsun!',
    body:       "Yarın senin özel günün ve biz de onu daha da güzel yapmak istiyoruz!\n\nBu özel doğum günü hediyeyle bir sonraki siparişinde %10 indirim kazan:",
    code_label: 'İndirim Kodun:',
    note:       (from, to) => `${from} tarihinden ${to} tarihine kadar geçerlidir (10 gün).`,
    btn:        'Alışverişe Başla',
  },
};

function formatDate(date, lang) {
  if (lang === 'fa') return date.toLocaleDateString('fa-IR');
  if (lang === 'tr') return date.toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' });
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function sendBirthdayEmail(customer, birthdayDate, validUntil) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;

  const lang       = (customer.preferred_lang || 'fa').substring(0, 2);
  const ll         = BIRTHDAY_L[lang] || BIRTHDAY_L.fa;
  const dir        = ll.dir;
  const siteUrl    = process.env.SITE_URL || 'https://shilista.com';
  const name       = customer.full_name || '';
  const fromStr    = birthdayDate ? formatDate(birthdayDate, lang) : '';
  const untilStr   = validUntil   ? formatDate(validUntil,   lang) : '';
  const noteText   = typeof ll.note === 'function' ? ll.note(fromStr, untilStr) : ll.note;

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>

      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:22px 32px;text-align:center">
          <p style="margin:0 0 4px;font-size:28px">🎂🎉🎈</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px">${ll.title}</p>
          ${name ? `<p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,.85)">${name}</p>` : ''}
        </td>
      </tr>

      <tr>
        <td style="padding:32px 32px 24px">
          <p style="margin:0 0 28px;font-size:15px;color:#444;line-height:1.9;white-space:pre-line">${ll.body}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
            <tr>
              <td style="text-align:center">
                <p style="margin:0 0 10px;font-size:13px;color:#888">${ll.code_label}</p>
                <div style="display:inline-block;background:#fdf5ed;border:2px dashed #c0562a;border-radius:10px;padding:14px 32px">
                  <span style="font-family:monospace;font-size:26px;font-weight:800;color:#c0562a;letter-spacing:3px">BIRTHDAY</span>
                </div>
                <p style="margin:10px 0 0;font-size:12px;color:#aaa">${noteText}</p>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${siteUrl}"
                  style="display:inline-block;background:#c0562a;color:#fff;font-size:15px;font-weight:700;
                         padding:13px 40px;border-radius:8px;text-decoration:none;letter-spacing:.3px">
                  ${ll.btn}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${FOOTER_TR}

    </table>
  </td></tr>
</table>
</body></html>`;

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject:     ll.subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

// ─── Welcome email (sent immediately after registration) ──────────────────────
const WELCOME_L = {
  fa: {
    dir:        'rtl',
    subject:    '🎉 خوش آمدی به Shilista — هدیه اول خرید',
    title:      '🎉 خوش آمدی به Shilista!',
    body:       'حساب شما با موفقیت ایجاد شد.\n\nبه‌عنوان هدیه خوش‌آمدگویی، یک کد تخفیف ویژه برای اولین خرید شما در نظر گرفته‌ایم:',
    code_label: 'کد تخفیف خوش‌آمدگویی:',
    note:       'این کد فقط یک‌بار قابل استفاده است. همین حالا خرید کنید!',
    btn:        'خرید کنید',
  },
  en: {
    dir:        'ltr',
    subject:    '🎉 Welcome to Shilista — Your First Order Gift',
    title:      '🎉 Welcome to Shilista!',
    body:       'Your account has been created successfully.\n\nAs a welcome gift, here\'s an exclusive discount code for your first order:',
    code_label: 'Your Welcome Discount Code:',
    note:       'This code can be used only once. Start shopping now!',
    btn:        'Shop Now',
  },
  tr: {
    dir:        'ltr',
    subject:    '🎉 Shilista\'ya Hoş Geldin — İlk Sipariş Hediyesi',
    title:      '🎉 Shilista\'ya Hoş Geldiniz!',
    body:       'Hesabınız başarıyla oluşturuldu.\n\nHoş geldin hediyesi olarak ilk siparişiniz için özel bir indirim kodu hazırladık:',
    code_label: 'Hoş Geldin İndirim Kodunuz:',
    note:       'Bu kod yalnızca bir kez kullanılabilir. Hemen alışverişe başlayın!',
    btn:        'Alışverişe Başla',
  },
};

async function sendWelcomeEmail(customer) {
  if (!customer.email) return;
  const transporter = getTransporter();
  if (!transporter) return;

  const lang    = (customer.preferred_lang || 'fa').substring(0, 2);
  const ll      = WELCOME_L[lang] || WELCOME_L.fa;
  const siteUrl = process.env.SITE_URL || 'https://shilista.com';
  const name    = customer.full_name || '';

  const html = `<!DOCTYPE html>
<html dir="${ll.dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${ll.dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>

      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:22px 32px;text-align:center">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px">${ll.title}</p>
          ${name ? `<p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,.85)">${name}</p>` : ''}
        </td>
      </tr>

      <tr>
        <td style="padding:32px 32px 24px">
          <p style="margin:0 0 28px;font-size:15px;color:#444;line-height:1.9;white-space:pre-line">${ll.body}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            <tr>
              <td style="text-align:center">
                <p style="margin:0 0 10px;font-size:13px;color:#a07050;font-weight:600">${ll.code_label}</p>
                <div style="display:inline-block;background:#fdf5ed;border:2px dashed #c0562a;border-radius:12px;padding:18px 40px">
                  <span style="font-family:monospace;font-size:34px;font-weight:800;color:#c0562a;letter-spacing:5px">FOD</span>
                </div>
                <p style="margin:12px 0 0;font-size:13px;color:#888">${ll.note}</p>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px">
            <tr>
              <td align="center">
                <a href="${siteUrl}"
                  style="display:inline-block;background:#c0562a;color:#fff;font-size:15px;font-weight:700;
                         padding:13px 40px;border-radius:8px;text-decoration:none;letter-spacing:.3px">
                  ${ll.btn}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${FOOTER_TR}

    </table>
  </td></tr>
</table>
</body></html>`;

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject:     ll.subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

// ─── Verification code email ──────────────────────────────────────────────────
const VERIFY_L = {
  fa: { dir:'rtl', subject:'کد تأیید ثبت‌نام Shilista', intro:'کد تأیید ثبت‌نام شما:', note:'این کد تا ۱۰ دقیقه دیگر معتبر است.' },
  en: { dir:'ltr', subject:'Shilista — Email Verification Code', intro:'Your verification code:', note:'This code is valid for 10 minutes.' },
  tr: { dir:'ltr', subject:'Shilista — E-posta Doğrulama Kodu', intro:'Doğrulama kodunuz:', note:'Bu kod 10 dakika geçerlidir.' },
};

async function sendVerificationEmail(toEmail, code, lang) {
  const transporter = getTransporter();
  if (!transporter) return;
  const ll  = VERIFY_L[lang] || VERIFY_L.fa;
  const html = `<!DOCTYPE html>
<html dir="${ll.dir}" lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Tahoma,sans-serif;direction:${ll.dir}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      <tr>
        <td style="background:#fff;padding:28px 32px 20px;border-bottom:2px solid #f0e8df;text-align:center">
          <img src="${EMAIL_LOGO_URL}" alt="Shilista" width="200" style="width:200px;max-width:90%;height:auto;display:inline-block">
        </td>
      </tr>
      <tr>
        <td style="background:linear-gradient(135deg,#c0562a,#e07a40);padding:20px 32px;text-align:center">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:.5px">${ll.intro}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 32px;text-align:center">
          <div style="display:inline-block;background:#fff5f0;border:2px solid #c0562a;border-radius:14px;padding:20px 40px;margin-bottom:20px">
            <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#c0562a;font-family:monospace">${code}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#aaa">${ll.note}</p>
        </td>
      </tr>
      ${FOOTER_TR}
    </table>
  </td></tr>
</table>
</body></html>`;
  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          toEmail,
    subject:     ll.subject,
    html,
    attachments: EMAIL_ATTACHMENTS,
  });
}

module.exports = { sendOrderEmail, sendRawEmail, sendReplyEmail, sendFriendInviteEmail, sendLoyaltyEmail, sendBirthdayEmail, sendPrizeEarnedEmail, sendWelcomeEmail, sendVerificationEmail, label };
