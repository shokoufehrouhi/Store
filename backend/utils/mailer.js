const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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
          ${process.env.SITE_URL
            ? `<img src="${process.env.SITE_URL}/images/shilista_6_light_full_transparent.png" alt="Shilista" height="52" style="height:52px;width:auto;display:inline-block">`
            : `<span style="font-size:26px;font-weight:700;color:#c0562a;letter-spacing:1px;font-family:Arial,sans-serif">Shilista</span>`}
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

      <!-- Footer -->
      <tr>
        <td style="background:#fdf5ed;padding:20px 32px;border-top:1px solid #f0e8df;text-align:center">
          <p style="margin:0;font-size:12px;color:#aaa">${l.thanks} — shilista.com</p>
        </td>
      </tr>

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

  const attachments = [];
  if (attachFiles && attachFiles.length) {
    for (const f of attachFiles) {
      attachments.push(f);
    }
  }

  await transporter.sendMail({
    from:        process.env.SMTP_FROM || process.env.SMTP_USER,
    to:          customer.email,
    subject,
    html,
    attachments,
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

module.exports = { sendOrderEmail, sendRawEmail, label };
