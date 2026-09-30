// One-off: before 2026-09-30, a rate-limit error from Instagram ("Application
// request limit reached", code 4) marked a queued product post 'failed', and
// the scheduler immediately moved on to the next row, which failed the same
// way — the whole queue (24 rows) burned through to 'failed' in ~24 minutes
// without any of those products ever being the actual problem. scheduler.js
// now requeues + pauses on that error instead; this puts the rows already
// stuck as 'failed' for that reason back in the queue. Also covers code 9
// ("User is performing too many actions", the rolling-24h publishing cap). Only rate-limit
// failures are touched — any other failure reason stays 'failed' for review.
// Run manually once: node scripts/requeueRateLimitedIgPosts.js
const prisma = require('../prisma/client');

(async () => {
  const rows = await prisma.instagram_product_posts.findMany({
    where: { status: 'failed' },
    select: { id: true, product_id: true, error_message: true },
  });
  const rateLimited = rows.filter(r => {
    const m = (r.error_message || '').match(/"code":(\d+)/);
    return m && [4, 9, 17, 32, 613].includes(Number(m[1]));
  });
  if (rateLimited.length) {
    await prisma.instagram_product_posts.updateMany({
      where: { id: { in: rateLimited.map(r => r.id) } },
      data: { status: 'queued' },
    });
  }
  for (const r of rateLimited) console.log(`#${r.id} (product ${r.product_id}) failed -> queued`);
  console.log(`requeued ${rateLimited.length} of ${rows.length} failed rows`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
