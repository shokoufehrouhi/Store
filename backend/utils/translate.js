// Machine translation with a fallback chain: MyMemory (free, no account
// needed, but a 5,000-10,000 word/day quota) first, then Azure Translator
// (F0 free tier, 2M characters/month, needs AZURE_TRANSLATOR_KEY/REGION in
// .env) when MyMemory is exhausted or otherwise unavailable. A self-hosted
// LibreTranslate fallback was tried first but dropped — its bundled Argos
// models were unreliable on clothing/fashion vocabulary (see project notes).
// Used to backfill name_fa/name_en (and desc_fa/desc_en) when a product is
// imported from a single-language site.
const MYMEMORY_CONTACT_EMAIL = 'shokoufehrouhi@gmail.com';
const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION;
const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// MyMemory returns HTTP 429 for two very different situations that look
// identical at the status-code level: a transient per-second burst limit
// (retrying after a short backoff fixes it) and the daily word quota being
// fully spent (retrying does nothing until it resets — the body says
// "NEXT AVAILABLE IN <n> HOURS..."). Only the first is worth retrying; the
// second should fall through to Azure instead.
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

async function translateAzure(text, sourceLang, targetLang) {
  if (!AZURE_KEY || !AZURE_REGION) {
    throw new Error('Azure Translator not configured (missing AZURE_TRANSLATOR_KEY/AZURE_TRANSLATOR_REGION)');
  }
  const res = await fetch(`${AZURE_ENDPOINT}/translate?api-version=3.0&from=${sourceLang}&to=${targetLang}`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_KEY,
      'Ocp-Apim-Subscription-Region': AZURE_REGION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: text }]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const translated = data?.[0]?.translations?.[0]?.text;
  if (!translated) throw new Error(`no translation in response: ${JSON.stringify(data)}`);
  return translated;
}

async function translateText(text, sourceLang, targetLang) {
  if (!text?.trim()) return '';
  try {
    return await translateMyMemory(text, sourceLang, targetLang);
  } catch (mmErr) {
    try {
      return await translateAzure(text, sourceLang, targetLang);
    } catch (azureErr) {
      throw new Error(`MyMemory failed (${mmErr.message}), Azure fallback also failed (${azureErr.message})`);
    }
  }
}

module.exports = { translateText, sleep, QuotaExhaustedError };
