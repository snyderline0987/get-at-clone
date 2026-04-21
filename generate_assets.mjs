#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

const KEY = process.env.KIE_API_KEY;
const KIE = 'https://api.kie.ai';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(__dirname, 'assets');

async function createTask(model, input) {
  console.log(`\n📤 Submitting ${model}...`);
  const res = await fetch(`${KIE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input })
  });
  const json = await res.json();
  if (json.code !== 200 || !json.data?.taskId) throw new Error(JSON.stringify(json));
  return json.data.taskId;
}

async function pollTask(taskId, label) {
  let delay = 5000;
  const start = Date.now();
  console.log(`\n⏳ Polling ${label} (taskId: ${taskId})`);
  while (Date.now() - start < 600_000) {
    await new Promise(r => setTimeout(r, delay));
    const res = await fetch(`${KIE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${KEY}` }
    });
    const json = await res.json();
    const task = json.data || {};
    const state = task.state || '?';

    if (state === 'success') return task;
    if (['fail', 'error'].includes(state)) throw new Error(`Failed: ${JSON.stringify(task)}`);

    console.log(`   [${Math.round((Date.now()-start)/1000)}s] ${state}`);
    delay = Math.min(delay * 1.5, 15000);
  }
  throw new Error('Timeout');
}

function extractUrl(task) {
  const c = [
    task.resultUrl, task.videoUrl, task.imageUrl, task.url,
    ...(Array.isArray(task.resultUrls) ? task.resultUrls : [])
  ];
  return c.find(url => typeof url === 'string' && url.startsWith('http')) || null;
}

async function download(url, filename) {
  const outPath = path.join(OUT_DIR, filename);
  console.log(`\n💾 Downloading → ${filename}`);
  const res = await fetch(url);
  await pipeline(res.body, createWriteStream(outPath));
  console.log(`   ✅ Saved ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ═══ IMAGE ═══
  const prompt = "Cinematic ultra-wide shot of a professional video production studio with multiple cameras, lighting equipment, and LED screens. Dark moody atmosphere with red accent lighting. Professional broadcast equipment visible. 8k quality, no text, no watermark, dramatic composition";
  const imgTaskId = await createTask('flux/flux-1.1-pro', {
    prompt, aspect_ratio: '16:9'
  });
  const imgResult = await pollTask(imgTaskId, 'Image');
  const imgUrl = extractUrl(imgResult);
  if (!imgUrl) throw new Error('No image URL');
  await download(imgUrl, 'hero_bg.jpg');

  // ═══ VIDEO (kling-2-6 — NOT seedance-2) ═══
  try {
    const vidTaskId = await createTask('kling/kling-2-6', {
      prompt: "Slow cinematic camera push through a professional video production studio, subtle ambient motion, red accent lighting, professional broadcast equipment, dramatic atmosphere, no text",
      image_url: imgUrl,
      duration: '5'
    });
    const vidResult = await pollTask(vidTaskId, 'Video');
    const vidUrl = extractUrl(vidResult);
    if (vidUrl) await download(vidUrl, 'hero_bg.mp4');
    else console.warn('⚠️  Video generation succeeded but no URL found');
  } catch (e) {
    console.warn('⚠️  Video failed, image-only hero:', e.message);
  }

  console.log('\n🎉 Assets complete!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
