// Color names -> a real hex for the swatch circle. New colors used to be
// created with the placeholder #CCCCCC (a name alone gave no color), and
// by 2026-10-06 340 of 403 colors were grey. Turkish and English words
// (clothing colors and cosmetic shade names) map to a hex; "açık/light"
// lightens it, "koyu/dark" darkens it. Names that aren't a color (prints,
// "multicolor", product types) give null and keep the placeholder.

const PLACEHOLDER_HEX = '#CCCCCC';

// Lowercase (Turkish rules), no accents/combining dots ("Si̇yah"), ASCII
// letters only, single spaces.
function normalizeColorName(name) {
  return String(name || '')
    .toLocaleLowerCase('tr')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// The color word that comes FIRST in the name wins ("Mavi/Beyaz" -> blue,
// "Vizon Melanj" -> mink), the longer one on a tie ("zeytin yesili" over
// "zeytin", "kirli beyaz" over "kirli"...). Keys are normalized (see above).
const COLOR_WORDS = {
  // black / white / grey
  'siyah': '#1A1A1A', 'black': '#1A1A1A', 'komur karasi': '#1C1C1C', 'kara': '#1A1A1A',
  'beyaz': '#FFFFFF', 'white': '#FFFFFF', 'kirli beyaz': '#F2EFE6', 'buz beyazi': '#F1F5F5', 'buxe beyazi': '#F1F5F5',
  'ekru': '#EDE6D6', 'ecru': '#EDE6D6', 'ivory': '#FFFFF0', 'fildisi': '#FFFFF0', 'pearl': '#EAE0C8', 'inci': '#EAE0C8',
  'gri': '#9CA3AF', 'grey': '#9CA3AF', 'gray': '#9CA3AF', 'kar melanj': '#E5E5E5', 'grimelanj': '#B8B8B8',
  'antrasit': '#383E42', 'anthracite': '#383E42', 'fume': '#5A5A5A', 'smoke': '#6E6E6E', 'silver': '#C0C0C0', 'gumus': '#C0C0C0',
  'translucent': '#F2F2F2', 'transparent': '#F2F2F2', 'seffaf': '#F2F2F2',
  // beige / brown
  'bej': '#E3D3B8', 'beige': '#E3D3B8', 'krem': '#F3E9D2', 'krema': '#F3E9D2', 'cream': '#F3E9D2', 'vanilya': '#F3E5AB', 'vanilla': '#F3E5AB',
  'kum': '#D8C3A5', 'sand': '#D8C3A5', 'tas': '#C9BFAE', 'stone': '#C9BFAE', 'nude': '#E3BC9A', 'neutral': '#D8B79A', 'fair': '#F3D5C0',
  'taupe': '#8B7D6B', 'vizon': '#A39382', 'deve tuyu': '#C19A6B', 'devetuyu': '#C19A6B', 'camel': '#C19A6B',
  'taba': '#A0662E', 'tan': '#A0662E', 'karamel': '#A0663A', 'caramel': '#A0663A', 'toffee': '#9C6B3C', 'tarcin': '#A0522D', 'cinnamon': '#A0522D',
  'kahve': '#6B4423', 'kahverengi': '#6B4423', 'brown': '#6B4423', 'aci kahve': '#4A2E1A', 'cikolata': '#5C3A21', 'chocolate': '#5C3A21',
  'mocha': '#8B6A55', 'coffee': '#6F4E37', 'cocoa': '#6B4226', 'cacao': '#6B4226', 'kakao': '#6B4226', 'hazel': '#8E6B47', 'findik': '#8E6B47',
  'bronze': '#CD7F32', 'bronz': '#CD7F32', 'almond': '#EFDECD', 'badem': '#EFDECD', 'pecan': '#7B4A2D', 'sienna': '#A0522D', 'viski': '#B5651D', 'whiskey': '#B5651D', 'honey': '#E0A84E', 'bal': '#E0A84E',
  'deri': '#8B5A2B', 'leather': '#8B5A2B', 'kiremit': '#B5543B', 'tile': '#B5543B', 'terracotta': '#C2603F', 'clay': '#B66A50',
  'haki': '#7A7449', 'khaki': '#7A7449',
  // red / pink / purple
  'kirmizi': '#C62828', 'red': '#C62828', 'scarlet': '#D7263D', 'cilek': '#D7263D', 'strawberry': '#D7263D', 'cherry': '#9E1B32', 'kiraz': '#9E1B32',
  'nar': '#C0392B', 'pomegranate': '#C0392B', 'bordo': '#7B1E2B', 'burgundy': '#7B1E2B', 'sarap': '#722F37', 'wine': '#722F37', 'marsala': '#955251',
  'berry': '#8E2C48', 'murdum': '#5E2750', 'damson': '#5E2750', 'erik': '#6E2D4F', 'plum': '#6E2D4F',
  'pembe': '#F4A6B7', 'pink': '#F4A6B7', 'gul kurusu': '#C08081', 'dusty rose': '#C08081', 'rose': '#D98B8B', 'rosy': '#D98B8B', 'gul': '#D98B8B',
  'pudra': '#E8C4B8', 'powder': '#E8C4B8', 'fusya': '#C2185B', 'fuchsia': '#C2185B', 'magenta': '#C2185B', 'orchid': '#DA70D6',
  'mor': '#7C3AED', 'purple': '#7C3AED', 'eflatun': '#B57EDC', 'lila': '#C8A2C8', 'lilac': '#C8A2C8', 'leylak': '#C8A2C8',
  'lavanta': '#B57EDC', 'lavender': '#B57EDC', 'mauve': '#B784A7', 'iris': '#5A4FCF', 'pansy': '#78184A',
  'violet': '#8B5CF6', 'menekse': '#8B5CF6', 'peony': '#E8A0B4', 'sakayik': '#E8A0B4', 'ballet': '#F4C2C2',
  // orange / yellow
  'turuncu': '#F97316', 'orange': '#F97316', 'mandalina': '#F28500', 'tangerine': '#F28500', 'mandarine': '#F28500',
  'mercan': '#F08070', 'coral': '#F08070', 'somon': '#FA8072', 'salmon': '#FA8072', 'seftali': '#F6B48F', 'peach': '#F6B48F',
  'kayisi': '#FBCEB1', 'apricot': '#FBCEB1', 'grapefruit': '#F87666',
  'sari': '#FACC15', 'yellow': '#FACC15', 'limon': '#FFF44F', 'lemon': '#FFF44F', 'hardal': '#C9A227', 'mustard': '#C9A227',
  'altin': '#D4AF37', 'gold': '#D4AF37',
  // green
  'yesil': '#16A34A', 'green': '#16A34A', 'zeytin': '#708238', 'olive': '#708238', 'zeytin yesili': '#708238',
  'nane': '#98E2C6', 'mint': '#98E2C6', 'nane yesili': '#98E2C6', 'su yesili': '#7FD1B9', 'cim': '#4CAF50', 'grass': '#4CAF50',
  'cucumber': '#A8D5A2', 'salatalik': '#A8D5A2', 'tea': '#B5C99A', 'cay': '#B5C99A', 'petrol': '#1F5F6B', 'teal': '#14808A',
  // blue
  'mavi': '#3B82F6', 'blue': '#3B82F6', 'lacivert': '#1E3A5F', 'navy': '#1E3A5F', 'denizci mavisi': '#1E3A5F', 'gece mavisi': '#191970', 'midnight blue': '#191970',
  'indigo': '#3F51B5', 'civit': '#3F51B5', 'kot': '#4A6FA5', 'denim': '#4A6FA5', 'indigo denim': '#3D5A80',
  'saks': '#2E5AAC', 'saxe': '#2E5AAC', 'cobalt': '#0047AB', 'kobalt': '#0047AB',
  'gok mavisi': '#87CEEB', 'sky blue': '#87CEEB', 'bebek mavisi': '#A7C7E7', 'su mavisi': '#7FDBFF', 'aqua': '#7FDBFF',
  'turkuaz': '#14B8A6', 'turquoise': '#14B8A6', 'murekkep mavisi': '#2C3E66', 'ink blue': '#2C3E66',
};

// Prints, mixes and non-colors stay grey rather than getting a guess.
const NOT_A_SINGLE_COLOR = /\b(cok renk|cokrenkli|multi|multicolou?r|karisik|mix|mixed|desen|desenli|pattern|patterned|baski|baskili|print|printed|cizgili|stripe|striped|stripes|ekose|plaid|gingham|potikare|kontrast|contrast|renkli|coloured|colored)\b/;

// Only when the name has no real color word: "Vizon Melanj" is mink.
const FALLBACK_WORDS = { 'melanj': '#B8B8B8', 'melange': '#B8B8B8' };

const LIGHTER = /\b(acik|light|pale|soft|baby|bebek|soluk)\b/;
const DARKER = /\b(koyu|dark|deep|mat|matte)\b/;

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (amount > 0 ? v + (255 - v) * amount : v * (1 + amount)));
  return '#' + ch.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function findColorWord(words, table) {
  let best = null;
  for (const [key, hex] of Object.entries(table)) {
    const at = words.indexOf(` ${key} `);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && key.length > best.key.length)) best = { key, hex, at };
  }
  return best;
}

// Hex for a color name (tries each given name, e.g. Turkish then English),
// or null when it can't tell.
function guessColorHex(...names) {
  for (const raw of names) {
    const full = normalizeColorName(raw);
    if (!full || NOT_A_SINGLE_COLOR.test(full)) continue;
    const words = ` ${full} `;
    const best = findColorWord(words, COLOR_WORDS) || findColorWord(words, FALLBACK_WORDS);
    if (!best) continue;
    const before = full.slice(0, Math.max(0, best.at)); // modifiers only count before the color word
    if (LIGHTER.test(before)) return shade(best.hex, 0.35);
    if (DARKER.test(before)) return shade(best.hex, -0.3);
    return best.hex;
  }
  return null;
}

module.exports = { PLACEHOLDER_HEX, normalizeColorName, guessColorHex };
