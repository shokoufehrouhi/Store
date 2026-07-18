const { PrismaClient } = require('@prisma/client');
const { sendBirthdayEmail } = require('../utils/mailer');

const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  // Send 1 day before birthday — find customers whose birthday is TOMORROW
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowMonth = tomorrow.getMonth() + 1;
  const tomorrowDay   = tomorrow.getDate();
  const thisYear      = now.getFullYear();

  const customers = await prisma.$queryRaw`
    SELECT id, full_name, email, preferred_lang, birth_date, birthday_email_year
    FROM customers
    WHERE email IS NOT NULL
      AND is_active = true
      AND birth_date IS NOT NULL
      AND EXTRACT(MONTH FROM birth_date) = ${tomorrowMonth}
      AND EXTRACT(DAY   FROM birth_date) = ${tomorrowDay}
      AND (birthday_email_year IS NULL OR birthday_email_year < ${thisYear})
  `;

  console.log(`[birthday] ${now.toISOString()} — ${customers.length} customer(s) have birthday tomorrow`);

  for (const customer of customers) {
    try {
      // Birthday = tomorrow; valid until birthday + 10 days
      const birthdayDate = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
      const validUntil   = new Date(birthdayDate);
      validUntil.setDate(validUntil.getDate() + 10);

      await sendBirthdayEmail(customer, birthdayDate, validUntil);
      await prisma.customers.update({
        where: { id: customer.id },
        data:  { birthday_email_year: thisYear, birthday_email_sent_at: now },
      });
      console.log(`[birthday] sent to ${customer.email}`);
    } catch (err) {
      console.error(`[birthday] failed for ${customer.email}:`, err.message);
    }
  }
}

main().finally(() => prisma.$disconnect());
