// Free machine translation via MyMemory (no API key). Passing a contact
// email (`de=`) roughly doubles the daily quota from 5,000 to 10,000 words
// and is MyMemory's own documented way to raise the limit — done here with
// the user's explicit permission (they own this address, see project memory).
// Used to backfill name_fa/name_en (and desc_fa/desc_en) when a product is
// imported from a site that only has one language.
const CONTACT_EMAIL = 'shokoufehrouhi@gmail.com';

async function translateText(text, sourceLang, targetLang) {
  if (!text?.trim()) return '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}&de=${encodeURIComponent(CONTACT_EMAIL)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(`translate failed: ${data.responseDetails || data.responseStatus}`);
  return data.responseData.translatedText;
}

module.exports = { translateText };
