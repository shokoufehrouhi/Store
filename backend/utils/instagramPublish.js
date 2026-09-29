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
  if (!res.ok) throw new Error(`Instagram API error: ${JSON.stringify(data)}`);
  return data;
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
// a few seconds for an image) before calling media_publish.
async function waitUntilContainerReady(creationId, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
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

async function publishContainer(creationId) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  await waitUntilContainerReady(creationId);
  const params = { creation_id: creationId, access_token: accessToken };
  const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media_publish?${new URLSearchParams(params)}`, { method: 'POST' });
  return data.id;
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
};
