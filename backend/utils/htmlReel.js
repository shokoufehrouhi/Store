// Renders a reel from an HTML template where every frame is a pure function
// of time: the page defines window.setup(data), window.seek(t) and
// window.DURATION; Puppeteer screenshots each frame and ffmpeg-static joins
// them into a 1080x1920 30fps MP4 (with a silent audio track, since some
// players refuse video-only files). Used by chatReelBuilder.js and
// brandReelBuilder.js.
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const FPS = 30;

async function renderHtmlReel(templatePath, data, outFile) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
  });
  let ff;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.goto('file://' + templatePath, { waitUntil: 'load' });
    await page.evaluate(async (d) => {
      await document.fonts.ready;
      window.setup(d);
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    }, data);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
    if (broken.length) throw new Error(`html reel: images failed to load: ${broken.join(', ')}`);

    const dur = await page.evaluate(() => window.DURATION);
    const frames = Math.round(dur * FPS);
    let stderr = '';
    ff = spawn(ffmpegPath, [
      '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-f', 'lavfi', '-t', dur.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v', '-map', '1:a',
      // 2 threads: the server also runs the site (same as reelBuilder.js).
      '-threads', '2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    const done = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-4).join(' | ')}`))));
    });
    // An ffmpeg that died mid-way would otherwise leave a drain wait hanging forever.
    const closed = done.catch(() => {});
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.seek(t), f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (ff.exitCode !== null) break;
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), closed]);
    }
    ff.stdin.end();
    await done;
  } catch (err) {
    if (ff && ff.exitCode === null) ff.kill('SIGKILL');
    fs.rmSync(outFile, { force: true });
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { renderHtmlReel };
