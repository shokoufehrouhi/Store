// The daily AI reel (user's choice, 2026-10-07): one ~15s reel a day at
// 08:00 in which a real-looking person wears/uses one discounted product and
// moves — on top of the two regular product reels (utils/reelPlan.js),
// which stay as they are. Built from the user's own avatars (family members,
// consent given — kept out of git, see AVATARS_DIR) with two free Hugging
// Face Spaces (utils/hfSpaces.js):
//   1. FLUX.1 Kontext puts the product on the avatar (one input image: the
//      avatar on the left, the product photo on the right);
//   2. Wan 2.2 animates that picture into one 5s clip (the Space's
//      maximum; it was two chained clips until 2026-10-13);
// then reelBuilder.js#buildAiReel adds the logo, the discount, the price
// slide and the outro. Kids' clothes get an AI child instead of an avatar.
// Tested by hand 2026-10-07: ~30s for the picture and ~1-1.5 min per clip.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const hf = require('./hfSpaces');

const KONTEXT = 'black-forest-labs/FLUX.1-Kontext-Dev';
const WAN = 'zerogpu-aoti/wan2-2-fp8da-aoti-faster';
// The Space's own default negative prompt (it has to be passed in order).
const WAN_NEGATIVE = '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走';
const CLIP_SECONDS = 5;

// <AVATARS_DIR>/female/*.{jpg,jpeg,png} and <AVATARS_DIR>/male/*: the
// photos never go in git (they're real people), so they're copied to the
// server by hand.
const AVATARS_DIR = process.env.AVATARS_DIR || path.join(__dirname, '../assets/avatars');
function pickAvatar(gender) {
  const dir = path.join(AVATARS_DIR, gender === 'male' ? 'male' : 'female');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)) : [];
  if (!files.length) throw new Error(`no avatars in ${dir}`);
  return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

// What the person does with the product, by kind (see aiReelKind).
// The second clip used to turn the person around, and Wan made up the
// back of the product (another product, in effect): the product stays in
// view now and is said to stay the same (user's request, 2026-10-13).
const SAFE = 'the same person wearing exactly the same product the whole time, modest, elegant and natural, static camera, bright clean studio, realistic smooth natural motion';
const SCENES = {
  clothing: {
    edit: (item) => `The person on the left is now wearing the ${item} shown on the right, reproduced exactly (same color, pattern, fabric, cut and details), styled with simple neutral matching clothes and shoes. Keep their face, hair, skin tone and body identical. Remove the separate product image on the right and replace the whole background with a bright clean minimal light grey studio. Full body from head to toe, realistic fashion lookbook photo.`,
    clip: `The person walks a few confident steps toward the camera, then does a slow half turn so the outfit is seen from the side, natural arm movement, gentle smile, ${SAFE}`,
  },
  kids: {
    edit: (item) => `A cheerful child model about seven years old is wearing the ${item} shown in this image, reproduced exactly (same color, print and details), with simple matching clothes and sneakers. Bright clean minimal light grey studio background. Full body from head to toe, realistic kids fashion catalogue photo.`,
    clip: `The child walks happily toward the camera and does a little playful spin, smiling, ${SAFE}`,
  },
  bag: {
    edit: (item) => `The person on the left is now carrying the ${item} shown on the right, reproduced exactly (same color, shape, material and hardware), with a simple neutral outfit. Keep their face, hair, skin tone and body identical. Remove the separate product image on the right and replace the whole background with a bright clean minimal light grey studio. Full body, the bag clearly visible, realistic fashion lookbook photo.`,
    clip: `The person walks toward the camera carrying the bag, then stops and lifts it slightly to show it, smiling, ${SAFE}`,
  },
  shoes: {
    edit: (item) => `The person on the left is now wearing the ${item} shown on the right on their feet, reproduced exactly (same color, shape and details), with a simple neutral outfit that leaves the shoes fully visible. Keep their face, hair, skin tone and body identical. Remove the separate product image on the right and replace the whole background with a bright clean minimal light grey studio. Full body from head to toe, shoes clearly visible, realistic fashion lookbook photo.`,
    clip: `The person walks a few relaxed steps toward the camera so the shoes are clearly seen, then stops and turns one foot to show the side of the shoe, ${SAFE}`,
  },
  cosmetics: {
    edit: (item) => `Beauty portrait: the woman on the left is holding the ${item} shown on the right near her face, the product reproduced exactly and clearly visible. Keep her face, hair and skin tone identical, natural makeup. Remove the separate product image on the right and replace the whole background with a soft clean light studio background. Upper body, vertical framing, realistic beauty campaign photo.`,
    clip: `The woman smiles, brings the product closer to the camera to show it, then gently turns her head, ${SAFE}`,
  },
};

function aiReelKind(product, groupKey) {
  if (groupKey === 'kids') return 'kids';
  if (groupKey === 'cosmetics') return 'cosmetics';
  if (groupKey === 'bagsShoes') return product.category_id === 2 ? 'shoes' : 'bag';
  return 'clothing';
}

// The free Spaces fail now and then (busy, restarting) — a few tries each.
async function withRetries(label, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= tries) throw new Error(`${label}: ${err.message}`);
      console.warn(`[aiReel] ${label} attempt ${i} failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 30 * 1000));
    }
  }
}

// Avatar (height 1024) with the product photo beside it, or the product
// alone for kids.
async function buildEditInput(avatarPath, productPhotoPath) {
  const productBuf = await sharp(productPhotoPath).resize(512, 512, { fit: 'contain', background: '#ffffff' }).toBuffer();
  if (!avatarPath) return sharp(productPhotoPath).resize(768, 768, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  const avatarBuf = await sharp(avatarPath).rotate().resize({ height: 1024 }).toBuffer();
  const { width } = await sharp(avatarBuf).metadata();
  return sharp({ create: { width: width + 512, height: 1024, channels: 3, background: '#ffffff' } })
    .composite([{ input: avatarBuf, left: 0, top: 0 }, { input: productBuf, left: width, top: 256 }])
    .jpeg({ quality: 92 }).toBuffer();
}

// A 9:16 crop around the middle (the edit centres the person).
async function portraitCrop(buf) {
  const { width, height } = await sharp(buf).metadata();
  const w = Math.min(width, Math.round(height * 9 / 16));
  const h = Math.min(height, Math.round(w * 16 / 9));
  return sharp(buf).extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h })
    .jpeg({ quality: 95 }).toBuffer();
}

async function animate(imageBuf, prompt, seed) {
  const input = await hf.uploadFile(WAN, imageBuf, 'frame.jpg');
  const out = await hf.callSpace(WAN, 'generate_video', [input, prompt, 6, WAN_NEGATIVE, CLIP_SECONDS, 1, 1, seed, false]);
  return hf.downloadOutput(out[0]);
}

// Writes the AI clip (~5s) for `product` to
// `outFile`. `productPhotoPath` is the product's photo on disk. Also
// returns `look`: the try-on picture (9:16 JPEG) the clip starts from, so
// the rest of the reel shows the same person with the same product.
async function makeAiClip(product, groupKey, productPhotoPath, outFile) {
  const kind = aiReelKind(product, groupKey);
  const scene = SCENES[kind];
  const avatarPath = kind === 'kids' ? null : pickAvatar(product.gender === 'male' ? 'male' : 'female');
  const item = String(product.name_en || 'item').replace(/\s+/g, ' ').trim().slice(0, 80);
  const seed = Math.floor(Math.random() * 1e6);
  const editInput = await buildEditInput(avatarPath, productPhotoPath);
  const edited = await withRetries('try-on', async () => {
    const input = await hf.uploadFile(KONTEXT, editInput, 'input.jpg');
    const out = await hf.callSpace(KONTEXT, 'infer', [input, scene.edit(item), seed, false, 2.5, 28]);
    return hf.downloadOutput(out[0]);
  });
  const firstFrame = await portraitCrop(edited);

  // One clip: the reel's AI part is 5s since 2026-10-13 (it was two
  // chained clips, ~10s).
  fs.writeFileSync(outFile, await withRetries('clip', () => animate(firstFrame, scene.clip, seed)));
  return { kind, avatar: avatarPath ? path.basename(avatarPath) : null, look: firstFrame };
}

module.exports = { makeAiClip, aiReelKind };
