const { PrismaClient } = require('@prisma/client');
const { sendBirthdayEmail } = require('../utils/mailer');

const prisma = new PrismaClient();

async function main() {
  const now       = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDay   = now.getDate();
  const thisYear   = now.getFullYear();

  const customers = await prisma.$queryRaw`
    SELECT id, full_name, email, preferred_lang, birthday_email_year
    FROM customers
    WHERE email IS NOT NULL
      AND is_active = true
      AND birth_date IS NOT NULL
      AND EXTRACT(MONTH FROM birth_date) = ${todayMonth}
      AND EXTRACT(DAY   FROM birth_date) = ${todayDay}
      AND (birthday_email_year IS NULL OR birthday_email_year < ${thisYear})
  `;

  console.log(`[birthday] ${now.toISOString()} — ${customers.length} customer(s) have birthday today`);

  for (const customer of customers) {
    try {
      await sendBirthdayEmail(customer);
      await prisma.customers.update({
        where: { id: customer.id },
        data:  { birthday_email_year: thisYear },
      });
      console.log(`[birthday] sent to ${customer.email}`);
    } catch (err) {
      console.error(`[birthday] failed for ${customer.email}:`, err.message);
    }
  }
}

main().finally(() => prisma.$disconnect());
