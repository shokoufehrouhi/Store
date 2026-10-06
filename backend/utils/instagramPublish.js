// Instagram Graph API -- Content Publishing for Stories.
// Two-step flow: create a media container from a publicly-reachable image
// URL, then publish that container. The image must already be served at a
// public https URL (Instagram's servers fetch it themselves) -- callers save
// the generated story JPEG into backend/public/uploads/ first.
const fs = require('fs');
const path = require('path');

const GRAPH_BASE = 'https://graph.instagram.com/v21.0';
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

async function graphFetch(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Instagram API error: ${JSON.stringify(data)}`);
    err.igError = data?.error || null;
    throw err;
  }
  return data;
}

// Meta's throttling error codes: 4 = app-level ("Application request limit
// reached", hit live 2026-09-30), 9 = "User is performing too many
// actions" (subcode 2207042, the account's rolling-24h content-publishing
// cap -- also hit live 2026-09-30, and marked is_transient:false by Meta even
// though it clears on its own), 17 = per-user, 32 = per-page, 613 = calls
// within a time window. These say nothing about the post itself -- retrying
// the same post later is expected to work.
const RATE_LIMIT_CODES = [4, 9, 17, 32, 613];
function isRateLimitError(err) {
  return RATE_LIMIT_CODES.includes(err?.igError?.code);
}

// Errors about the whole account/app rather than one post: 200 = permission
// denied / "API access blocked." (Meta blocked the app's API access -- hit
// live 2026-10-01, every call failing until Meta lifts it), 190 = access
// token invalid/expired, 10 = permission not granted. Like a rate limit,
// nothing is wrong with the post itself, but retrying soon is pointless.
const ACCOUNT_BLOCK_CODES = [10, 190, 200];
function isAccountBlockedError(err) {
  return ACCOUNT_BLOCK_CODES.includes(err?.igError?.code);
}

// Same check against a stored error_message (the JSON graphFetch embeds in
// it), for rows that already failed in an earlier tick or process.
function isRateLimitMessage(message) {
  const m = (message || '').match(/"code":(\d+)/);
  return !!m && RATE_LIMIT_CODES.includes(Number(m[1]));
}

function saveStoryImage(buffer, name) {
  const filename = `story-${Date.now()}-${name}.jpg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return { filename, url: `${requireEnv('FRONTEND_URL')}/uploads/${filename}` };
}

// Note: Meta's Graph API does not support attaching a link sticker (or any
// sticker) to a Story published this way -- confirmed against a real post,
// the `link` field is silently ignored, no error, no tappable link anywhere
// on the story. Adding a real link requires manually placing a link sticker
// in the Instagram app after this posts. Don't re-add a `link` param here.
async function createStoryContainer(imageUrl) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const params = { image_url: imageUrl, media_type: 'STORIES', access_token: accessToken };
  const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
  return data.id;
}

// A regular feed (grid) post, not a Story -- unlike Stories, feed posts
// accept a real `caption` field via the API, so the bilingual product title
// goes here directly instead of being drawn onto the image.
async function createFeedContainer(imageUrl, caption) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const params = { image_url: imageUrl, caption, access_token: accessToken };
  const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
  return data.id;
}

// One image of a carousel (2-10 required by the API) -- no caption on the
// child, that goes on the parent CAROUSEL container below. Each child must
// finish processing (waitUntilContainerReady) before the parent can
// reference it in `children`.
async function createCarouselChildContainer(imageUrl) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const params = { image_url: imageUrl, is_carousel_item: 'true', access_token: accessToken };
  const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
  return data.id;
}

// The parent carousel container, referencing already-created (and already
// finished-processing) child container ids.
async function createCarouselContainer(childIds, caption) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const params = { media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: accessToken };
  const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
  return data.id;
}

// Instagram processes an uploaded image asynchronously after container
// creation -- publishing immediately can 400 with "Media ID is not
// available" (code 9007 / subcode 2207027) even though the container itself
// was created successfully. Poll status_code until it's FINISHED (usually
// a few seconds for an image) before calling media_publish. Every poll is
// its own API call against the same hourly budget as the posts themselves
// (a 10-image carousel polls each child plus the parent) -- 5s rather than
// 2s roughly halves that overhead for a few extra seconds of wall time.
async function waitUntilContainerReady(creationId, { timeoutMs = 90000, intervalMs = 5000 } = {}) {
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const data = await graphFetch(
      `${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${accessToken}`,
      { method: 'GET' }
    );
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Instagram container failed processing: ${JSON.stringify(data)}`);
    if (Date.now() >= deadline) throw new Error(`Instagram container still ${data.status_code} after ${timeoutMs}ms`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// err.stage says which of the two calls failed ('status_check' or
// 'media_publish') -- the error text alone doesn't, and on 2026-10-03 a
// story's "media not found" (code 24) left no way to tell which it was.
async function publishContainer(creationId) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  try {
    await waitUntilContainerReady(creationId);
  } catch (err) {
    throw Object.assign(err, { stage: 'status_check', creationId });
  }
  const params = { creation_id: creationId, access_token: accessToken };
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media_publish?${new URLSearchParams(params)}`, { method: 'POST' });
      return data.id;
    } catch (err) {
      if (isMediaNotReadyError(err) && attempt < MEDIA_NOT_READY_RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, MEDIA_NOT_READY_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw Object.assign(err, { stage: 'media_publish', creationId });
    }
  }
}

// Code 9007 / subcode 2207027 ("Media ID is not available" -- "Medya
// yayınlanmaya hazır değil. Lütfen biraz bekle") from media_publish even
// AFTER status_code said FINISHED -- seen on product posts 2026-10-06
// (Meta marks it is_transient:false, but it only means "not yet"). Nothing
// was published, so publishing the same container again a bit later is
// safe; before this the post went straight to 'failed'.
const MEDIA_NOT_READY_RETRY_DELAYS_MS = [15000, 30000, 45000];
function isMediaNotReadyError(err) {
  return err?.igError?.code === 9007 && err?.igError?.error_subcode === 2207027;
}

// Code 24 / subcode 2207006 ("The requested resource does not exist" --
// "Medya Bulunamadı") for a container Instagram itself created seconds
// earlier. Hit live on 2026-10-03's 19:00 story; the exact same image
// posted fine with a fresh container when re-deployed later, and the 19:30
// story went up normally in between -- a Meta-side glitch with that one
// container, not a problem with the post. Marked is_transient:false by Meta
// regardless.
function isMissingContainerError(err) {
  return err?.igError?.code === 24 && err?.igError?.error_subcode === 2207006;
}

// Instagram's own count of how much of its rolling-24h publishing cap is
// used -- authoritative, unlike counting our own DB rows: on 2026-10-02 our
// DB showed 45 posts in the last 24h (cap 50) while Instagram still refused
// with "User is performing too many actions" (code 9 / 2207042).
// Returns { used, total } (total falls back to 50 if config is missing).
async function getPublishingQuota() {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const data = await graphFetch(
    `${GRAPH_BASE}/${igUserId}/content_publishing_limit?fields=quota_usage,config&access_token=${accessToken}`,
    { method: 'GET' }
  );
  const row = data?.data?.[0] || {};
  return { used: Number(row.quota_usage) || 0, total: Number(row.config?.quota_total) || 50 };
}

async function postStory(imageBuffer, { name }) {
  const { filename, url } = saveStoryImage(imageBuffer, name);
  try {
    const creationId = await createStoryContainer(url);
    const mediaId = await publishContainer(creationId);
    return { mediaId };
  } finally {
    fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
  }
}

module.exports = {
  postStory, createStoryContainer, publishContainer, waitUntilContainerReady,
  createFeedContainer, createCarouselChildContainer, createCarouselContainer,
  isRateLimitError, isRateLimitMessage, isAccountBlockedError, isMissingContainerError, getPublishingQuota,
};
