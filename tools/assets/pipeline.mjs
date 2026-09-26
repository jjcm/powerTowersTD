#!/usr/bin/env node
// Resumable asset pipeline: diffui concept art -> Meshy image-to-3D -> rig/animate -> optimized GLBs.
// State lives in tools/assets/state.json so no paid step is ever run twice for the same asset.
//
//   node tools/assets/pipeline.mjs concepts [ids...]   diffui concept images for models (+ hud icons + art)
//   node tools/assets/pipeline.mjs icons [ids...]      diffui opaque command-card icons
//   node tools/assets/pipeline.mjs textures [ids...]   diffui seamless PBR textures
//   node tools/assets/pipeline.mjs models [ids...]     Meshy image-to-3D (needs concepts)
//   node tools/assets/pipeline.mjs rig [ids...]        Meshy rigging + extra animations for runners
//   node tools/assets/pipeline.mjs optimize [ids...]   gltf-transform -> public/assets/models
//   node tools/assets/pipeline.mjs sheet               contact sheet of concepts for review
//   node tools/assets/pipeline.mjs status
//   node tools/assets/pipeline.mjs redo-concept <id> [extra prompt]  clears a concept so it regenerates

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MODELS, TEXTURES, ICONS, HUD_ICONS, ART, SPRITES, CLUTTER } from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOLS = path.join(ROOT, 'tools/assets');
const RAW = path.join(TOOLS, 'raw');
const CONCEPTS = path.join(TOOLS, 'concepts');
const PUB = path.join(ROOT, 'public/assets');
const STATE_FILE = path.join(TOOLS, 'state.json');
const LOG_FILE = path.join(TOOLS, 'pipeline.log');

for (const d of [RAW, CONCEPTS, path.join(RAW, 'models'), path.join(PUB, 'models'), path.join(PUB, 'textures'),
  path.join(PUB, 'icons'), path.join(PUB, 'portraits'), path.join(PUB, 'ui')]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- env
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...readEnvFile(path.join(ROOT, '.env.local')), ...process.env };
const DIFFUI_TOKEN = env.DIFFUI_TOKEN;
const MESHY_KEY = env.MESHY_API_KEY || readEnvFile(env.MESHY_ENV_FILE || '').MESHY_API_KEY;

// ---------------------------------------------------------------- state
// Several pipeline processes may run at once (concepts, icons, models...). Every read goes to
// disk and every write is a shallow per-entry patch, so processes never clobber each other.
const readState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});
const get = (id) => readState()[id] ?? {};
function patch(id, obj) {
  const disk = readState();
  const cur = { ...(disk[id] ?? {}), ...obj };
  for (const k of Object.keys(cur)) if (cur[k] === undefined) delete cur[k];
  disk[id] = cur;
  fs.writeFileSync(STATE_FILE + '.tmp.' + process.pid, JSON.stringify(disk, null, 2));
  fs.renameSync(STATE_FILE + '.tmp.' + process.pid, STATE_FILE);
  return cur;
}

function log(...a) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  const q = [...items];
  const workers = Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) {
      const it = q.shift();
      try { await fn(it); } catch (e) { log('ERROR', it.id ?? it, e.message); }
    }
  });
  await Promise.all(workers);
}

async function download(url, file) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return file; }
    log('download retry', r.status, path.basename(file));
    await sleep(3000 * (i + 1));
  }
  throw new Error('download failed ' + url.slice(0, 80));
}

// ---------------------------------------------------------------- diffui
async function diffui(endpoint, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://diffui.ai/api/build/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: DIFFUI_TOKEN, ...body }),
    });
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    log(`diffui ${endpoint} ${r.status}: ${txt.slice(0, 200)}`);
    if (r.status === 400 || r.status === 403) throw new Error(`diffui ${r.status}`);
    await sleep(5000 * (i + 1));
  }
  throw new Error('diffui failed');
}
const png = (url) => url + (url.includes('?') ? '&' : '?') + 'format=png';

async function genConcept(spec, { transparent = true, width = 1024, height = 1024, quality = 'high' } = {}) {
  const s = get(spec.id);
  if (s.concept?.file && fs.existsSync(path.join(ROOT, s.concept.file))) return;
  log('concept ->', spec.id);
  const prompt = spec.prompt + (s.conceptExtra ? ' ' + s.conceptExtra : '');
  const res = await diffui('generate-image', {
    prompt, width, height, quality, ...(transparent && quality === 'high' ? { transparentBackground: true } : {}),
  });
  const file = path.join(CONCEPTS, `${spec.id}.png`);
  await download(png(res.url), file);
  patch(spec.id, { concept: { url: res.url, file: path.relative(ROOT, file), at: Date.now() } });
  log('concept ok', spec.id);
}

async function makePortrait(id) {
  const src = path.join(CONCEPTS, `${id}.png`);
  if (!fs.existsSync(src)) return;
  await sharp(src).trim({ threshold: 1 }).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88 }).toFile(path.join(PUB, 'portraits', `${id}.webp`));
}

async function cmdConcepts(ids) {
  const models = MODELS.filter((m) => !ids.length || ids.includes(m.id));
  const hud = HUD_ICONS.filter((m) => !ids.length || ids.includes(m.id));
  const art = ART.filter((m) => !ids.length || ids.includes(m.id));
  await pool([...models, ...hud], 8, async (m) => {
    await genConcept(m);
    if (m.id.startsWith('hud_') || m.id === 'checkpoint_rune') {
      const src = path.join(CONCEPTS, `${m.id}.png`);
      const size = m.id === 'checkpoint_rune' ? 512 : 96;
      await sharp(src).trim({ threshold: 1 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90 }).toFile(path.join(PUB, 'ui', `${m.id}.webp`));
    } else {
      await makePortrait(m.id);
    }
  });
  const sprites = SPRITES.filter((m) => !ids.length || ids.includes(m.id));
  await pool(sprites, 4, async (m) => {
    await genConcept(m);
    await sharp(path.join(CONCEPTS, `${m.id}.png`)).trim({ threshold: 1 }).resize(256, 256, { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toFile(path.join(PUB, 'ui', `${m.id}.png`));
  });
  await pool(art, 2, async (a) => {
    await genConcept(a, { transparent: false, width: a.width, height: a.height });
    await sharp(path.join(CONCEPTS, `${a.id}.png`)).webp({ quality: 85 }).toFile(path.join(PUB, 'ui', `${a.id}.webp`));
  });
}

async function cmdClutter(ids) {
  const list = CLUTTER.filter((m) => !ids.length || ids.includes(m.id));
  await pool(list, 5, async (m) => {
    await genConcept(m);
  });
  // pack atlases: 4 columns x 2 rows of 256px cells
  for (const flat of [true, false]) {
    const items = CLUTTER.filter((c) => c.flat === flat && get(c.id).concept);
    const extra = flat ? [] : ['grass_tuft', 'flower_clump', 'fern'].filter((id) => fs.existsSync(path.join(CONCEPTS, `${id}.png`)));
    const all = [...items.map((c) => c.id), ...extra].slice(0, 8);
    const comps = [];
    for (let i = 0; i < all.length; i++) {
      const buf = await sharp(path.join(CONCEPTS, `${all[i]}.png`)).trim({ threshold: 1 })
        .resize(248, 248, { fit: 'contain', position: flat ? 'centre' : 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      comps.push({ input: buf, left: (i % 4) * 256, top: Math.floor(i / 4) * 256 });
    }
    const name = flat ? 'clutter_flat' : 'clutter_upright';
    await sharp({ create: { width: 1024, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(comps).png().toFile(path.join(PUB, 'ui', `${name}.png`));
    fs.writeFileSync(path.join(PUB, 'ui', `${name}.json`), JSON.stringify(all));
    log('atlas', name, all.join(','));
  }
}

async function cmdIcons(ids) {
  const icons = ICONS.filter((m) => !ids.length || ids.includes(m.id));
  await pool(icons, 8, async (m) => {
    await genConcept(m, { transparent: false, width: 512, height: 512, quality: 'medium' });
    // the generator paints rounded "app icon" corners; crop to a full-bleed square
    const src = path.join(CONCEPTS, `${m.id}.png`);
    const meta = await sharp(src).metadata();
    const c = Math.round(meta.width * 0.13);
    await sharp(src).extract({ left: c, top: c, width: meta.width - 2 * c, height: meta.height - 2 * c })
      .resize(128, 128).webp({ quality: 88 }).toFile(path.join(PUB, 'icons', `${m.id}.webp`));
  });
}

async function cmdTextures(ids) {
  const list = TEXTURES.filter((t) => !ids.length || ids.includes(t.id));
  await pool(list, 4, async (t) => {
    const s = get('tex_' + t.id);
    if (s.done && (s.maps ?? []).length >= t.maps.length && s.v === 2) return;
    log('texture ->', t.id);
    const res = await diffui('create-texture', { prompt: t.prompt, tilingMode: 'both', maps: t.maps });
    const out = path.join(PUB, 'textures');
    const tmp = path.join(RAW, `tex_${t.id}.png`);
    await download(png(res.url), tmp);
    await sharp(tmp).resize(1024, 1024).jpeg({ quality: 88 }).toFile(path.join(out, `${t.id}_color.jpg`));
    for (const m of res.maps ?? []) {
      const f = path.join(RAW, `tex_${t.id}_${m.type}.png`);
      await download(png(m.url), f);
      await sharp(f).resize(1024, 1024).jpeg({ quality: 90 }).toFile(path.join(out, `${t.id}_${m.type}.jpg`));
    }
    const maps = (res.maps ?? []).map((m) => m.type);
    patch('tex_' + t.id, { done: true, maps, url: res.url, v: 2 });
    log('texture ok', t.id, maps.join(','));
  });
}

// ---------------------------------------------------------------- meshy
async function meshy(method, pathname, body) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`https://api.meshy.ai${pathname}`, {
      method, headers: { Authorization: `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    if (r.ok) return txt ? JSON.parse(txt) : {};
    if (r.status === 429 || r.status >= 500) { log(`meshy ${r.status} backoff`, txt.slice(0, 120)); await sleep(15000 * (i + 1)); continue; }
    throw new Error(`meshy ${method} ${pathname} ${r.status}: ${txt.slice(0, 300)}`);
  }
  throw new Error('meshy retries exhausted');
}

async function poll(kind, taskId, label) {
  let last = -1;
  for (;;) {
    const t = await meshy('GET', `/openapi/v1/${kind}/${taskId}`);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED' || t.status === 'EXPIRED') {
      throw new Error(`${label} ${t.status}: ${t.task_error?.message}`);
    }
    if (t.progress !== last) { last = t.progress; log(`${label} ${t.status} ${t.progress ?? 0}%`); }
    await sleep(12000);
  }
}

async function cmdModels(ids) {
  const list = MODELS.filter((m) => !ids.length || ids.includes(m.id));
  await pool(list, 9, async (m) => {
    let s = get(m.id);
    if (s.model?.file && fs.existsSync(path.join(ROOT, s.model.file))) return;
    if (!s.concept?.file) { log('skip (no concept)', m.id); return; }
    if (!s.meshyTask) {
      const b64 = fs.readFileSync(path.join(ROOT, s.concept.file)).toString('base64');
      const body = {
        image_url: `data:image/png;base64,${b64}`,
        ai_model: 'latest',
        should_texture: true,
        enable_pbr: true,
        should_remesh: true,
        topology: 'triangle',
        target_polycount: m.polycount,
        ...(m.kind === 'runner' ? { pose_mode: 'a-pose' } : {}),
      };
      const r = await meshy('POST', '/openapi/v1/image-to-3d', body);
      s = patch(m.id, { meshyTask: r.result });
      log('meshy task', m.id, r.result);
    }
    const t = await poll('image-to-3d', s.meshyTask, `i23d ${m.id}`);
    const file = path.join(RAW, 'models', `${m.id}.glb`);
    await download(t.model_urls.glb, file);
    if (t.thumbnail_url) await download(t.thumbnail_url, path.join(RAW, 'models', `${m.id}_thumb.png`)).catch(() => {});
    patch(m.id, { model: { file: path.relative(ROOT, file), credits: t.consumed_credits } });
    log('model ok', m.id, `${t.consumed_credits} credits`);
  });
}

async function cmdRig(ids) {
  const list = MODELS.filter((m) => m.rig && (!ids.length || ids.includes(m.id)));
  await pool(list, 6, async (m) => {
    let s = get(m.id);
    if (!s.meshyTask || !s.model) { log('skip rig (no model)', m.id); return; }
    if (!s.rig?.done) {
      if (!s.rig?.task) {
        const r = await meshy('POST', '/openapi/v1/rigging', { input_task_id: s.meshyTask, height_meters: m.rig.height });
        s = patch(m.id, { rig: { task: r.result } });
        log('rig task', m.id, r.result);
      }
      const t = await poll('rigging', s.rig.task, `rig ${m.id}`);
      const base = path.join(RAW, 'models', m.id);
      await download(t.result.rigged_character_glb_url, `${base}_rigged.glb`);
      await download(t.result.basic_animations.walking_glb_url, `${base}_walk.glb`);
      await download(t.result.basic_animations.running_glb_url, `${base}_run.glb`);
      s = patch(m.id, { rig: { ...get(m.id).rig, done: true } });
      log('rig ok', m.id);
    }
    if (m.rig.actions?.length && !s.anim?.done) {
      if (!s.anim?.task) {
        const r = await meshy('POST', '/openapi/v1/animations', { rig_task_id: s.rig.task, action_ids: m.rig.actions });
        s = patch(m.id, { anim: { task: r.result } });
        log('anim task', m.id, r.result);
      }
      const t = await poll('animations', s.anim.task, `anim ${m.id}`);
      await download(t.result.animation_glb_url, path.join(RAW, 'models', `${m.id}_extra.glb`));
      s = patch(m.id, { anim: { ...get(m.id).anim, done: true } });
      log('anim ok', m.id);
    }
  });
}

// ---------------------------------------------------------------- optimize
async function mergeRunner(id) {
  // Combine walk (mesh + skin + clip) with run and extra clips retargeted by node name.
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const base = path.join(RAW, 'models', id);
  const doc = await io.read(`${base}_walk.glb`);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  root.listAnimations().forEach((a) => a.setName('walk'));
  const extra = [[`${base}_run.glb`, 'run']];
  if (fs.existsSync(`${base}_extra.glb`)) extra.push([`${base}_extra.glb`, null]);
  for (const [file, rename] of extra) {
    const src = await io.read(file);
    for (const anim of src.getRoot().listAnimations()) {
      const out = doc.createAnimation(rename ?? anim.getName());
      for (const ch of anim.listChannels()) {
        const target = nodesByName.get(ch.getTargetNode()?.getName());
        if (!target) continue;
        const sm = ch.getSampler();
        const cp = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(cp(sm.getInput())).setOutput(cp(sm.getOutput()))
          .setInterpolation(sm.getInterpolation());
        out.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target)
          .setTargetPath(ch.getTargetPath()).setSampler(sampler));
      }
    }
  }
  // The rigging export drops the PBR maps and adds a white emissive. The rig keeps the static
  // model's UV atlas, so transplant normal + metallic/roughness maps from the static GLB.
  if (fs.existsSync(`${base}.glb`)) {
    const stat = await io.read(`${base}.glb`);
    const smat = stat.getRoot().listMaterials()[0];
    const copyTex = (t) => {
      if (!t) return null;
      return doc.createTexture(t.getName()).setImage(t.getImage().slice()).setMimeType(t.getMimeType());
    };
    for (const mat of root.listMaterials()) {
      mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
      if (smat) {
        const n = copyTex(smat.getNormalTexture());
        if (n) mat.setNormalTexture(n).setNormalScale(smat.getNormalScale());
        const mr = copyTex(smat.getMetallicRoughnessTexture());
        if (mr) mat.setMetallicRoughnessTexture(mr);
        mat.setMetallicFactor(smat.getMetallicFactor()).setRoughnessFactor(smat.getRoughnessFactor());
      }
    }
  }
  const merged = `${base}_merged.glb`;
  await io.write(merged, doc);
  return merged;
}

async function cmdOptimize(ids) {
  const list = MODELS.filter((m) => !ids.length || ids.includes(m.id));
  for (const m of list) {
    const s = get(m.id);
    let src = s.model?.file ? path.join(ROOT, s.model.file) : null;
    if (m.rig) {
      if (!s.rig?.done) { if (src) log('optimize: runner not rigged yet, using static', m.id); }
      else src = await mergeRunner(m.id);
    }
    if (!src || !fs.existsSync(src)) continue;
    const out = path.join(PUB, 'models', `${m.id}.glb`);
    const size = m.textureSize ?? (m.kind === 'structure' ? 1024 : 1024);
    const args = ['gltf-transform', 'optimize', src, out, '--compress', 'meshopt', '--texture-compress', 'webp',
      '--texture-size', String(size), '--simplify', 'false', '--palette', 'false', '--instance', 'false'];
    if (m.rig) args.push('--flatten', 'false', '--join', 'false');
    execFileSync('npx', args, { cwd: ROOT, stdio: 'pipe' });
    const kb = Math.round(fs.statSync(out).size / 1024);
    patch(m.id, { optimized: { file: path.relative(ROOT, out), kb, rigged: !!s.rig?.done } });
    log('optimized', m.id, `${kb}KB`);
  }
  writeRuntimeManifest();
}

function writeRuntimeManifest() {
  const state = readState();
  const models = {};
  for (const m of MODELS) {
    const s = state[m.id];
    if (s?.optimized) models[m.id] = { url: `assets/models/${m.id}.glb`, rigged: s.optimized.rigged, kind: m.kind };
  }
  const textures = {};
  for (const t of TEXTURES) {
    const s = state['tex_' + t.id];
    if (s?.done) textures[t.id] = { color: `assets/textures/${t.id}_color.jpg`, ...Object.fromEntries((s.maps ?? []).map((k) => [k, `assets/textures/${t.id}_${k}.jpg`])) };
  }
  const icons = {};
  for (const i of ICONS) if (fs.existsSync(path.join(PUB, 'icons', `${i.id}.webp`))) icons[i.id] = `assets/icons/${i.id}.webp`;
  const portraits = {};
  for (const m of MODELS) if (fs.existsSync(path.join(PUB, 'portraits', `${m.id}.webp`))) portraits[m.id] = `assets/portraits/${m.id}.webp`;
  const ui = {};
  for (const h of [...HUD_ICONS, ...ART]) if (fs.existsSync(path.join(PUB, 'ui', `${h.id}.webp`))) ui[h.id] = `assets/ui/${h.id}.webp`;
  for (const h of SPRITES) if (fs.existsSync(path.join(PUB, 'ui', `${h.id}.png`))) ui[h.id] = `assets/ui/${h.id}.png`;
  for (const a of ['clutter_flat', 'clutter_upright']) if (fs.existsSync(path.join(PUB, 'ui', `${a}.png`))) ui[a] = `assets/ui/${a}.png`;
  fs.writeFileSync(path.join(PUB, 'manifest.json'), JSON.stringify({ models, textures, icons, portraits, ui }, null, 2));
  log('wrote public/assets/manifest.json');
}

// ---------------------------------------------------------------- review helpers
async function cmdSheet(ids) {
  const state = readState();
  const list = [...MODELS, ...HUD_ICONS, ...ICONS].filter((m) => (!ids.length || ids.includes(m.id)) && state[m.id]?.concept);
  const cell = 256, cols = 8, rows = Math.ceil(list.length / cols);
  const composites = [];
  for (let i = 0; i < list.length; i++) {
    const f = path.join(ROOT, state[list[i].id].concept.file);
    const img = await sharp(f).flatten({ background: '#3a4150' }).resize(cell, cell, { fit: 'contain', background: '#3a4150' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${cell}" height="22"><rect width="100%" height="100%" fill="#000a"/><text x="4" y="16" font-size="14" fill="#fff" font-family="sans-serif">${list[i].id}</text></svg>`);
    composites.push({ input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
    composites.push({ input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  }
  const out = path.join(RAW, 'sheet.png');
  await sharp({ create: { width: cols * cell, height: Math.max(1, rows) * cell, channels: 3, background: '#222' } })
    .composite(composites).png().toFile(out);
  log('sheet ->', out);
}

function cmdStatus() {
  const state = readState();
  const rows = MODELS.map((m) => {
    const s = state[m.id] ?? {};
    return `${m.id.padEnd(18)} concept:${s.concept ? 'Y' : '-'} meshy:${s.model ? 'Y' : s.meshyTask ? '…' : '-'} rig:${m.rig ? (s.rig?.done ? 'Y' : s.rig?.task ? '…' : '-') : ' '} opt:${s.optimized ? s.optimized.kb + 'KB' : '-'}`;
  });
  console.log(rows.join('\n'));
  console.log('textures:', TEXTURES.map((t) => `${t.id}:${state['tex_' + t.id]?.done ? 'Y' : '-'}`).join(' '));
  console.log('icons:', ICONS.filter((i) => state[i.id]?.concept).length, '/', ICONS.length,
    ' hud:', HUD_ICONS.filter((i) => state[i.id]?.concept).length, '/', HUD_ICONS.length);
}

async function balance() {
  const r = await meshy('GET', '/openapi/v1/balance');
  log('meshy balance', r.balance);
}

// ---------------------------------------------------------------- main
const [cmd, ...ids] = process.argv.slice(2);
if (!DIFFUI_TOKEN && ['concepts', 'icons', 'textures'].includes(cmd)) throw new Error('DIFFUI_TOKEN missing');
if (!MESHY_KEY && ['models', 'rig'].includes(cmd)) throw new Error('MESHY_API_KEY missing');
switch (cmd) {
  case 'concepts': await cmdConcepts(ids); break;
  case 'icons': await cmdIcons(ids); break;
  case 'clutter': await cmdClutter(ids); break;
  case 'textures': await cmdTextures(ids); break;
  case 'models': await balance(); await cmdModels(ids); await balance(); break;
  case 'rig': await cmdRig(ids); await balance(); break;
  case 'optimize': await cmdOptimize(ids); break;
  case 'manifest': writeRuntimeManifest(); break;
  case 'sheet': await cmdSheet(ids); break;
  case 'balance': await balance(); break;
  case 'redo-concept': {
    const [id, ...extra] = ids;
    const s = get(id);
    if (s.concept?.file) fs.rmSync(path.join(ROOT, s.concept.file), { force: true });
    patch(id, { concept: undefined, ...(extra.length ? { conceptExtra: extra.join(' ') } : {}) });
    log('cleared concept', id); break;
  }
  default: cmdStatus();
}
