// Free machine translation via MyMemory (no API key, ~5000 words/day).
// Used to backfill name_fa/name_en (and desc_fa/desc_en) when a product is
// imported from a site that only has one language.
async function translateText(text, sourceLang, targetLang) {
  if (!text?.trim()) return '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(`translate failed: ${data.responseDetails || data.responseStatus}`);
  return data.responseData.translatedText;
}

module.exports = { translateText };
