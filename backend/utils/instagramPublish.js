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

async function createStoryContainer(imageUrl, { link } = {}) {
  const igUserId = requireEnv('INSTAGRAM_USER_ID');
  const accessToken = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const params = { image_url: imageUrl, media_type: 'STORIES', access_token: accessToken };
  if (link) params.link = link;

  try {
    const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
    return data.id;
  } catch (err) {
    if (!link) throw err;
    console.warn('[instagram] story container with link sticker failed, retrying without it:', err.message);
    delete params.link;
    const data = await graphFetch(`${GRAPH_BASE}/${igUserId}/media?${new URLSearchParams(params)}`, { method: 'POST' });
    return data.id;
  }
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

async function postStory(imageBuffer, { name, link }) {
  const { filename, url } = saveStoryImage(imageBuffer, name);
  try {
    const creationId = await createStoryContainer(url, { link });
    const mediaId = await publishContainer(creationId);
    return { mediaId };
  } finally {
    fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
  }
}

module.exports = { postStory, createStoryContainer, publishContainer, waitUntilContainerReady };
