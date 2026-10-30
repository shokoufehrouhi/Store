// Translates the products waiting in the Awaiting Review tab (new products in
// a category the admin excluded from auto-publish -- the cosmetics) with an
// the ChatGPT plan (Codex CLI, no API cost) instead of the free machine translators in translate.js,
// which were unreliable on product vocabulary: name + description into
// Persian, Turkish and English, brand names left in Latin letters.
//
// Each product is done exactly once. The ai_translated_products row is both
// the "already done" memory (so a review edit is never overwritten by a later
// run) and the claim (INSERT .. ON CONFLICT DO NOTHING) that stops the
// production and staging processes, which share the DB, from translating the
// same product twice. The table is created here on first use so there is no
// manual ALTER to run on prod before a push.
const { Prisma } = require('@prisma/client');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prisma = require('../prisma/client');
const execFileAsync = promisify(execFile);

const CODEX_TIMEOUT_MS = 3 * 60 * 1000;
const NAME_MAX = 120; // products.name_* are VarChar(120)

const SYSTEM_PROMPT = `You translate cosmetics/beauty product listings for an online shop. Input is JSON with a product name and an optional description, written in Turkish or English (the fields name_tr/name_en/name_fa may hold machine-translated drafts of the same text; use them only as hints).
Return JSON with exactly these string keys: name_fa, name_tr, name_en, desc_fa, desc_tr, desc_en.
Rules:
- Persian (fa): natural, fluent Persian as used in Iranian beauty shops, not word-for-word. Use common Persian product terms (e.g. رژلب, کرم پودر, سرم, ماسک مو), not literal calques.
- Turkish (tr) and English (en): natural wording a native shopper expects. If the original is already in that language, keep it as is, only fixing obvious typos.
- Never translate or transliterate brand names or product line names (e.g. Tint Lab, Flormar, Kiko Milano, MISSHA); keep them in Latin letters exactly as given, in all three languages. Shade/colour names that are part of the product name may be translated if they are ordinary words.
- Keep sizes and numbers as given (30 ml, SPF 50, 12 g) and keep the same order of information.
- Names stay short like a product title (max ${NAME_MAX} characters). Descriptions keep their meaning and any line breaks; do not add claims that are not in the original.
- If description is empty, return empty strings for desc_*.
Output only the JSON object.`;

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS ai_translated_products (
        product_id INTEGER PRIMARY KEY,
        translated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.catch(err => { tableReady = null; throw err; });
  }
  return tableReady;
}

// Runs the prompt through the Codex CLI signed in with the ChatGPT plan
// (`codex login`), so it costs no API credit -- it uses the plan's own
// allowance. Needs the `codex` binary on PATH (npm i -g @openai/codex) and a
// one-time login on the machine that runs it.
async function callCodex(input) {
  const prompt = `${SYSTEM_PROMPT}\n\nInput:\n${JSON.stringify(input)}`;
  const outFile = path.join(os.tmpdir(), `held-translate-${process.pid}-${Date.now()}.txt`);
  try {
    // stdin must be closed: with a piped stdin `codex exec` waits for EOF
    // to append it to the prompt and never returns.
    const run = execFileAsync(process.env.CODEX_BIN || 'codex', [
      'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-C', os.tmpdir(), '--output-last-message', outFile, prompt,
    ], { timeout: CODEX_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
    run.child.stdin.end();
    await run;
    const text = fs.readFileSync(outFile, 'utf8');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(json);
  } catch (err) {
    throw new Error(`codex failed: ${(err.stderr || err.message || '').toString().slice(-300)}`);
  } finally {
    fs.rm(outFile, () => {});
  }
}

const clean = v => (typeof v === 'string' ? v.trim() : '');

async function translateProduct(p) {
  const out = await callCodex({
    brand: p.brand || '',
    name: p.name_tr,
    description: p.desc_tr || '',
    name_en_draft: p.name_en !== p.name_tr ? p.name_en : '',
    name_fa_draft: p.name_fa !== p.name_tr ? p.name_fa : '',
  });
  const names = { name_fa: clean(out.name_fa), name_tr: clean(out.name_tr), name_en: clean(out.name_en) };
  // A missing name means a broken answer: keep the product's current text
  // and let the caller treat it as a failure rather than save blanks.
  if (!names.name_fa || !names.name_en) throw new Error('incomplete translation in response');
  const data = {
    name_fa: names.name_fa.slice(0, NAME_MAX),
    name_en: names.name_en.slice(0, NAME_MAX),
    is_dirty: true,
    updated_at: new Date(),
  };
  if (names.name_tr) data.name_tr = names.name_tr.slice(0, NAME_MAX);
  if (p.desc_tr) {
    for (const k of ['desc_fa', 'desc_tr', 'desc_en']) if (clean(out[k])) data[k] = clean(out[k]);
  }
  return data;
}

let running = false;

// Held products (never published, category excluded from auto-publish) that
// have not been through the translator yet. Returns { candidates, done, failed }.
async function translateHeldProducts({ log = console.log, limit = 100 } = {}) {
  const result = { candidates: 0, done: 0, failed: 0 };
  if (running) return result;
  running = true;
  try {
    await ensureTable();
    const settings = await prisma.sync_settings.findUnique({ where: { id: 1 }, select: { auto_publish_excluded_category_ids: true } });
    const heldCategoryIds = settings?.auto_publish_excluded_category_ids || [];
    if (!heldCategoryIds.length) return result;

    const products = await prisma.$queryRaw`
      SELECT p.id FROM products p
      WHERE p.published_data IS NULL
        AND p.category_id IN (${Prisma.join(heldCategoryIds)})
        AND p.name_tr <> ''
        AND NOT EXISTS (SELECT 1 FROM ai_translated_products t WHERE t.product_id = p.id)
      ORDER BY p.id
      LIMIT ${limit}`;
    result.candidates = products.length;

    for (const { id } of products) {
      const claimed = await prisma.$executeRaw`
        INSERT INTO ai_translated_products (product_id) VALUES (${id}) ON CONFLICT DO NOTHING`;
      if (!claimed) continue; // another process has it
      try {
        const p = await prisma.products.findUnique({ where: { id } });
        if (!p) continue;
        const data = await translateProduct(p);
        await prisma.products.update({ where: { id }, data });
        result.done++;
        log(`[held-translate] #${id} ${data.name_en}`);
      } catch (err) {
        // Release the claim so the next run retries (quota, network blip).
        await prisma.$executeRaw`DELETE FROM ai_translated_products WHERE product_id = ${id}`.catch(() => {});
        result.failed++;
        log(`[held-translate] #${id} failed: ${err.message}`);
        if (/usage limit|rate limit|not logged in|login|ENOENT/i.test(err.message)) break; // no point continuing
      }
    }
    return result;
  } finally {
    running = false;
  }
}

module.exports = { translateHeldProducts, translateProduct };
