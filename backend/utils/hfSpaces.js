// Minimal client for public Hugging Face Gradio Spaces (the free ZeroGPU
// demos the daily AI reel uses, see aiReel.js). Plain fetch instead of the
// @gradio/client package: that one is ESM-only and wants a newer Node than
// the server's 18. HF_TOKEN (backend/.env) is sent so the GPU time counts
// against our own Hugging Face account's quota instead of the anonymous one.
//
// Gradio's HTTP API: upload input files, POST /call/<endpoint> with the
// inputs in order to get an event id, then read that event's server-sent
// events until "complete" (the outputs) or "error".

const authHeaders = () => (process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {});

// "owner/name" -> its *.hf.space address.
const spaceBase = (space) => `https://${space.toLowerCase().replace(/[/._]/g, '-')}.hf.space`;

// A short-lived token for the Space, sent as ?__sign= the way the official
// client does, so ZeroGPU charges the GPU time to our account's daily quota
// (the free account's is only a few minutes a day; PRO has 40).
async function spaceJwt(space) {
  if (!process.env.HF_TOKEN) return null;
  const res = await fetch(`https://huggingface.co/api/spaces/${space}/jwt`, { headers: authHeaders() });
  return res.ok ? (await res.json()).token || null : null;
}
const signed = (url, jwt) => (jwt ? `${url}${url.includes('?') ? '&' : '?'}__sign=${encodeURIComponent(jwt)}` : url);

async function uploadFile(space, buffer, filename) {
  const base = spaceBase(space);
  const form = new FormData();
  form.append('files', new Blob([buffer]), filename);
  const res = await fetch(signed(`${base}/gradio_api/upload`, await spaceJwt(space)), { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`HF upload to ${base} failed: HTTP ${res.status}`);
  const [serverPath] = await res.json();
  return { path: serverPath, orig_name: filename, meta: { _type: 'gradio.FileData' } };
}

// Runs one endpoint and returns its outputs array.
async function callSpace(space, endpoint, data) {
  const base = spaceBase(space);
  const jwt = await spaceJwt(space);
  const start = await fetch(signed(`${base}/gradio_api/call/${endpoint}`, jwt), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!start.ok) throw new Error(`HF call ${base}/${endpoint} failed: HTTP ${start.status}`);
  const { event_id: eventId } = await start.json();

  const res = await fetch(signed(`${base}/gradio_api/call/${endpoint}/${eventId}`, jwt), { headers: authHeaders() });
  if (!res.ok) throw new Error(`HF result ${base}/${endpoint} failed: HTTP ${res.status}`);
  const text = await res.text();
  let event = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:') && event === 'complete') return JSON.parse(line.slice(5));
    else if (line.startsWith('data:') && event === 'error') {
      // This API hides the real message ("null"); when it worked by hand
      // and then didn't, it was the daily ZeroGPU quota running out.
      const msg = line.slice(5).trim();
      throw new Error(`HF ${base}/${endpoint} error: ${msg && msg !== 'null' ? msg.slice(0, 300) : 'no details (often the daily ZeroGPU quota)'}`);
    }
  }
  throw new Error(`HF ${base}/${endpoint}: no result (${text.slice(-200)})`);
}

// An output file (image or video, possibly wrapped as { video: FileData }).
async function downloadOutput(output) {
  const file = output?.url ? output : output?.video || output?.image;
  if (!file?.url) throw new Error(`HF output has no file: ${JSON.stringify(output).slice(0, 200)}`);
  const res = await fetch(file.url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HF download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { uploadFile, callSpace, downloadOutput };
