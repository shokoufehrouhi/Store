// Machine translation with a fallback chain: MyMemory (free, no self-hosting,
// but a 5,000-10,000 word/day quota) first, then a self-hosted LibreTranslate
// instance (see deploy/README notes for the docker run command) when MyMemory
// is exhausted or otherwise unavailable. Used to backfill name_fa/name_en
// (and desc_fa/desc_en) when a product is imported from a single-language site.
const MYMEMORY_CONTACT_EMAIL = 'shokoufehrouhi@gmail.com';
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || 'http://localhost:5000';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// MyMemory returns HTTP 429 for two very different situations that look
// identical at the status-code level: a transient per-second burst limit
// (retrying after a short backoff fixes it) and the daily word quota being
// fully spent (retrying does nothing until it resets — the body says
// "NEXT AVAILABLE IN <n> HOURS..."). Only the first is worth retrying; the
// second should fall through to LibreTranslate instead.
class QuotaExhaustedError extends Error {}

async function translateMyMemory(text, sourceLang, targetLang, retries = 4) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}&de=${encodeURIComponent(MYMEMORY_CONTACT_EMAIL)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const data = await res.json().catch(() => null);
      const detail = data?.responseDetails || data?.responseData?.translatedText || '';
      if (/USED ALL AVAILABLE FREE TRANSLATIONS/i.test(detail)) {
        throw new QuotaExhaustedError(detail);
      }
      if (attempt >= retries) throw new Error(`HTTP 429 (still rate-limited after ${retries} retries)`);
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.responseStatus !== 200) throw new Error(data.responseDetails || String(data.responseStatus));
    return data.responseData.translatedText;
  }
}

async function translateLibre(text, sourceLang, targetLang) {
  const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.translatedText) throw new Error(data.error || JSON.stringify(data));
  return data.translatedText;
}

async function translateText(text, sourceLang, targetLang) {
  if (!text?.trim()) return '';
  try {
    return await translateMyMemory(text, sourceLang, targetLang);
  } catch (mmErr) {
    try {
      return await translateLibre(text, sourceLang, targetLang);
    } catch (libreErr) {
      throw new Error(`MyMemory failed (${mmErr.message}), LibreTranslate fallback also failed (${libreErr.message})`);
    }
  }
}

module.exports = { translateText, sleep, QuotaExhaustedError };
