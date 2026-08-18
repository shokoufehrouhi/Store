// Runs once a day via cron. A customer has 14 days to approve/reject a price
// we announced for their link-based pre-order request (see
// controllers/adminController.js#announceQuotePrice and
// controllers/ordersController.js#approveQuote/#rejectQuote). If they never
// respond, this auto-declines the request the same way an explicit customer
// rejection would, so it drops out of every "active order" list identically.
const { PrismaClient } = require('@prisma/client');
const { sendOrderEmail, label } = require('../utils/mailer');

const prisma = new PrismaClient();

const DEADLINE_DAYS = 14;

const AUTO_DECLINE_REASON = {
  fa: 'مشتری ظرف مهلت ۱۴ روزه به قیمت اعلام‌شده پاسخ نداد — به‌طور خودکار رد شد.',
  en: 'Customer did not respond to the quoted price within the 14-day deadline — automatically declined.',
  tr: 'Müşteri, 14 günlük süre içinde teklif edilen fiyata yanıt vermedi — otomatik olarak reddedildi.',
};

async function main() {
  const now     = new Date();
  const cutoff  = new Date(now.getTime() - DEADLINE_DAYS * 24 * 60 * 60 * 1000);

  const stale = await prisma.orders.findMany({
    where: { status: 'price_quoted', quoted_at: { lte: cutoff } },
    include: { customers: { select: { id: true, full_name: true, email: true, preferred_lang: true } } },
  });

  console.log(`[decline-stale-quotes] ${now.toISOString()} — ${stale.length} quote(s) past the ${DEADLINE_DAYS}-day deadline`);

  for (const order of stale) {
    try {
      const ol     = order.lang || 'fa';
      const reason = AUTO_DECLINE_REASON[ol] || AUTO_DECLINE_REASON.fa;

      const updated = await prisma.orders.update({
        where: { id: order.id },
        data:  { status: 'rejected', payment_rejection_reason: reason, rejected_at: now, updated_at: now },
      });

      if (order.customers?.email) {
        const extraInfo = [{ label: label('reject_reason', ol), value: reason }];
        await sendOrderEmail(order.customers, updated, 'preorder_rejected', extraInfo);
      }
      console.log(`[decline-stale-quotes] order #${order.id} auto-declined (quoted_at: ${order.quoted_at?.toISOString()})`);
    } catch (err) {
      console.error(`[decline-stale-quotes] failed for order #${order.id}:`, err.message);
    }
  }
}

main().finally(() => prisma.$disconnect());
