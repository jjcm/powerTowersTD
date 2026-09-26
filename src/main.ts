import './ui/style.css';
import * as THREE from 'three';
import { Game } from './game/sim';
import type { Difficulty } from './game/data/runners';
import { STRUCTURES } from './game/data/structures';
import { RUNNERS } from './game/data/runners';
import { Assets } from './render/assets';
import { World } from './render/world';
import { TerrainView } from './render/terrain';
import { WaterView } from './render/water';
import { Props } from './render/props';
import { StructureViews } from './render/structures';
import { RunnerViews } from './render/runners';
import { Overlay } from './render/overlay';
import { Effects } from './render/fx';
import { Bars } from './render/bars';
import { GroundDamage } from './render/damage';
import { Foliage } from './render/foliage';
import { LightPool } from './render/lights';
import { loadTerrainArrays } from './render/terrainTextures';
import { setWindTime } from './render/instanced';
import { Atmosphere } from './render/atmosphere';
import { Controller } from './input/controller';
import { Hud, type AppHooks } from './ui/hud';
import { Audio } from './audio';
import { W, H, Terrain as TerrainType } from './game/grid';

const canvas = document.getElementById('game') as HTMLCanvasElement;

const SETTINGS_KEY = 'powertowers.settings';
const settings = { shadows: true, bloom: true, resolution: 1.5, volume: 0.6, edgeScroll: true, autoLink: true, showPath: true, foliage: true, arcShadows: true, manyLights: true, ao: true, tiltShift: true, atmosphere: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); } catch { /* storage unavailable */ }

const assets = new Assets();
const audio = new Audio();
audio.muted = new URLSearchParams(location.search).has('mute');
const world = new World(canvas, { shadows: settings.shadows, bloom: settings.bloom, pixelRatio: settings.resolution, ao: settings.ao, tiltShift: settings.tiltShift });
assets.maxAnisotropy = world.renderer.capabilities.getMaxAnisotropy();

interface Session {
  game: Game; group: THREE.Group; terrain: TerrainView; water: WaterView; props: Props; sv: StructureViews; rv: RunnerViews;
  overlay: Overlay; fx: Effects; bars: Bars; ctrl: Controller; difficulty: Difficulty; damage: GroundDamage; foliage: Foliage; lights: LightPool; atmos: Atmosphere;
}
let session: Session | null = null;

const tmpV = new THREE.Vector3();
const drawSize = new THREE.Vector2();
const hooks: AppHooks = {
  start: (d) => { audio.ensure(); void startGame(d); },
  restart: () => { if (session) void startGame(session.difficulty); },
  toTitle: () => { endSession(); hud.showTitle(false); },
  settings,
  applySettings: () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    world.setQuality({ shadows: settings.shadows, bloom: settings.bloom, pixelRatio: settings.resolution, ao: settings.ao, tiltShift: settings.tiltShift });
    audio.setVolume(settings.volume);
    if (session) { session.ctrl.edgeScroll = settings.edgeScroll; session.game.autoLink = settings.autoLink; session.lights.shadowsEnabled = settings.shadows && settings.arcShadows; session.foliage.group.visible = settings.foliage; session.atmos.group.visible = settings.atmosphere; }
  },
  project: (x, y, z) => {
    tmpV.set(x, y, z).project(world.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, visible: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 };
  },
};
const hud = new Hud(assets, hooks);

function endSession() {
  if (!session) return;
  session.ctrl.dispose();
  world.scene.remove(session.group);
  session.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !(m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) m.geometry.dispose?.();
  });
  session = null;
}

let starting = false;
async function startGame(difficulty: Difficulty) {
  if (starting) return;
  starting = true;
  endSession();
  const arrays = await loadTerrainArrays(assets, assets.maxAnisotropy);
  const game = new Game(difficulty);
  game.autoLink = settings.autoLink;
  const group = new THREE.Group();
  const damage = new GroundDamage(game.grid);
  const terrain = new TerrainView(game.grid, arrays, damage);
  const water = new WaterView(terrain, assets);
  const heightAt = (x: number, z: number) => terrain.heightAt(x, z);
  const lights = new LightPool(settings.manyLights ? 14 : 6);
  lights.shadowsEnabled = settings.shadows && settings.arcShadows;
  const props = new Props(game.grid, game.map, terrain, assets);
  const sv = new StructureViews(game, assets, terrain);
  const rv = new RunnerViews(game, assets, heightAt);
  const overlay = new Overlay(game, assets, heightAt);
  const fx = new Effects(game, world, assets, sv, rv, terrain, lights, damage);
  const bars = new Bars(1500);
  const foliage = new Foliage(game.grid, terrain, damage, assets);
  foliage.group.visible = settings.foliage;
  const atmos = new Atmosphere(terrain, props.treeSpots, (x, z) => terrain.terrainAt(Math.floor(x), Math.floor(z)) === TerrainType.Water);
  atmos.group.visible = settings.atmosphere;
  group.add(terrain.mesh, water.mesh, foliage.group, props.group, sv.group, rv.group, overlay.group, fx.group, bars.mesh, lights.group, atmos.group);
  world.scene.add(group);
  const aoStatic = [foliage.group, fx.group, water.mesh, bars.mesh, overlay.group, world.sky, lights.group, ...atmos.aoExclude];
  let aoFrame = -1, aoList: THREE.Object3D[] = aoStatic;
  world.aoExclude = aoStatic;
  world.aoExcludeFn = () => {
    // glow / status / label sprites are additive billboards: keep them out of the AO pass
    if (aoFrame !== world.renderer.info.render.frame) {
      aoFrame = world.renderer.info.render.frame;
      aoList = [...aoStatic];
      sv.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) aoList.push(o); });
      props.group.traverse((o) => { if ((o as THREE.Sprite).isSprite || (o as THREE.Mesh).renderOrder === 1) aoList.push(o); });
    }
    return aoList;
  };
  for (const f of props.flames) fx.emitters.push({ pos: f, kind: 'fire', rate: 22, acc: 0 });
  fx.emitters.push({ pos: props.portalCenter, kind: 'portal', rate: 40, acc: 0 });
  for (const c of props.crystals) fx.emitters.push({ pos: c.position.clone().add(new THREE.Vector3(0, 0.6, 0)), kind: 'crystal', rate: 6, acc: 0 });
  fx.setViewportScale(window.innerHeight * Math.min(window.devicePixelRatio, settings.resolution), world.camera.fov);

  const ctrl = new Controller(game, world, sv, overlay, terrain);
  ctrl.rv = rv;
  ctrl.edgeScroll = settings.edgeScroll;
  ctrl.onHotkey = (k) => !hud.blocking && hud.handleHotkey(k);
  ctrl.onToggleResearch = () => hud.toggleResearch();
  ctrl.onMenu = () => hud.openMenu();
  ctrl.onMessage = (t, k) => hud.message(t, k);

  // open on the portal, then glide out to the whole battlefield
  world.target.set(game.map.spawn.x + 4, 0, game.map.spawn.z + 4);
  world.dist = 22;
  world.goal.set(W / 2 - 2, 0, H / 2 + 3);
  world.goalDist = 52;
  session = { game, group, terrain, water, props, sv, rv, overlay, fx, bars, ctrl, difficulty, damage, foliage, lights, atmos };
  starting = false;
  hud.attach(game, ctrl);
  hud.message('Build your maze. Runners must pass checkpoints 1 → 5.', 'info');
}

window.addEventListener('resize', () => {
  if (session) session.fx.setViewportScale(window.innerHeight * Math.min(window.devicePixelRatio, settings.resolution), world.camera.fov);
});
window.addEventListener('pointerdown', () => audio.ensure(), { once: false });

// ------------------------------------------------------------------ frame
const clock = new THREE.Clock();
const HP = new THREE.Color(0xe8352a), BOSS = new THREE.Color(0xff8a1a), SHIELD = new THREE.Color(0x9fe0ff);
const EN = new THREE.Color(0x3fb4ff), MN = new THREE.Color(0xc060ff), HEAT = new THREE.Color(0xff7a2a);
let time = 0;

function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.1));
}

function tick(dt: number) {
  time += dt;
  const s = session;
  if (!s) { world.render(); return; }
  const g = s.game;
  const blocked = hud.blocking;
  if (!blocked || !g.paused) g.update(dt);

  for (const e of g.events) {
    s.fx.handle(e);
    switch (e.type) {
      case 'death': s.rv.onDeath(e.runnerId); break;
      case 'leak': s.rv.onLeak(e.runnerId); world.shake = Math.min(1, world.shake + 0.4); break;
      case 'upgrade': s.sv.upgraded(e.structureId); break;
      case 'message': hud.message(e.text, e.kind); break;
      case 'text': hud.floatText(e.x, e.y ?? 2, e.z, e.text, e.color, e.big); break;
      case 'sound': {
        let vol = e.vol ?? 1;
        if (e.x !== undefined && e.z !== undefined) {
          const d = Math.hypot(e.x - world.target.x, e.z - world.target.z);
          vol *= Math.max(0.15, 1 - d / 45) * Math.max(0.3, 1 - (world.dist - 20) / 80);
        }
        audio.play(e.name, vol);
        break;
      }
    }
  }
  g.events.length = 0;

  s.fx.selectedId = s.ctrl.selected?.id ?? -1;
  s.sv.sync();
  s.sv.update(dt);
  s.rv.update(dt);
  s.ctrl.update(dt);
  s.overlay.update(dt);
  s.fx.update(dt);
  setWindTime(time);

  // footsteps press the meadow down along the route
  if (!g.paused) {
    for (const r of g.runners) {
      if (!r.alive || !r.moving || r.type.flying) continue;
      const w = r.type.boss ? 3 : r.type.id === 'brute' ? 1.6 : r.type.id === 'scout' || r.type.id === 'leech' ? 0.6 : 1;
      s.damage.stamp(r.x, r.z, 0.34 + r.type.scale * 0.14, { trample: dt * g.speed * 0.045 * w });
    }
  }
  s.damage.update(dt);
  s.terrain.updateOccupancy();
  const env = g.env;
  const weather = env.weather;
  const tu = s.terrain.uniforms;
  tu.uTime.value = time;
  tu.uWetness.value = world.wetness;
  tu.uCloud.value = (weather === 'clear' ? 0.28 : weather === 'fog' ? 0.35 : 0.7) * (1 - world.nightness * 0.8);
  tu.uSun.value = env.sunlight * (weather === 'clear' ? 1 : 0.5);
  const wind = weather === 'storm' ? 2.4 : weather === 'rain' ? 1.6 : weather === 'cloudy' ? 1.2 : 1;
  s.foliage.update(dt, wind);
  tu.uCover.value = s.atmos.cover;
  s.props.update(time, s.lights, world.nightness);
  s.sv.requestLights(s.lights, world.nightness);

  // bars
  const bars = s.bars;
  bars.setViewportHeight(world.renderer.getDrawingBufferSize(drawSize).y);
  bars.begin();
  for (const r of g.runners) {
    if (!r.alive) continue;
    const p = s.rv.viewPos(r.id);
    if (!p) continue;
    const w = r.type.boss ? 1.5 : 0.85;
    bars.push(p.x, p.y + s.rv.headY(r), p.z, w, r.type.boss ? 0.14 : 0.1, r.hp / r.maxHp, r.type.boss ? BOSS : HP, r.shieldMax > 0 ? r.shield / r.maxHp : 0, SHIELD);
  }
  for (const st of g.structures) {
    if (st.def.id === 'wall') continue;
    const ecap = g.energyCap(st), mcap = g.manaCap(st);
    if (ecap <= 0 && mcap <= 0) continue;
    const a = s.sv.anchor(st);
    const w = st.def.size === 1 ? 0.7 : 1.1;
    let y = a.y + 0.55;
    if (ecap > 0) { bars.push(st.cx, y, st.cz, w, 0.1, st.energy / ecap, EN); y += 0.13; }
    if (mcap > 0) { bars.push(st.cx, y, st.cz, w, 0.1, st.mana / mcap, MN); y += 0.13; }
    if (st.overcharge && (st.heat > 0 || st.overheated > 0)) bars.push(st.cx, y, st.cz, w, 0.075, st.overheated > 0 ? 1 : st.heat / 100, HEAT);
  }
  bars.end();

  world.updateLighting(g.env, dt);
  if (s.atmos.group.visible) {
    s.atmos.update({
      dt, time, camera: world.camera, target: world.target, sunDir: world.sunDir, sunColor: world.sun.color,
      skyColor: world.skyUniforms.uTop.value as THREE.Color, fogColor: world.fog.color, nightness: world.nightness,
      dayTime: env.time, weather, prevWeather: env.prevWeather, blend: env.weatherBlend, wind, bufferSize: world.renderer.getDrawingBufferSize(drawSize),
    });
  }
  world.updateCamera(dt);
  s.lights.update(dt, world.target);
  const wu = s.water.uniforms;
  wu.uTime.value = time;
  wu.uRain.value = s.fx.rainAmount;

  hud.update(dt);
  audio.ambience(s.fx.rainAmount, world.nightness);
  world.render();
}

// ------------------------------------------------------------------ boot
async function boot() {
  hud.showTitle(true);
  await assets.init();
  hud.showTitle(true);
  const ids = new Set<string>(['wall_post', 'wall_span', 'pine_tree', 'fir_tree', 'rock_cluster', 'cliff_rock', 'brazier', 'ley_crystal', 'castle_gate', 'spawn_portal', 'whelp']);
  for (const d of Object.values(STRUCTURES)) ids.add(d.model);
  for (const r of Object.values(RUNNERS)) ids.add(r.model);
  let texDone = 0;
  const texP = loadTerrainArrays(assets, assets.maxAnisotropy).then(() => { texDone = 1; });
  await assets.loadAll([...ids], (d, t) => hud.setLoading(d, t + 1 - texDone));
  await texP;
  hud.setLoading(1, 1);
  // debug hooks for automated testing
  (window as unknown as Record<string, unknown>).__pt = {
    get session() { return session; }, world, hooks, assets, THREE, hud,
    /** Run the frame logic manually (for automated testing when rAF is throttled). */
    advance(seconds: number, step = 1 / 30) { for (let t = 0; t < seconds; t += step) tick(step); },
    /** Fast-forward the simulation (no rendering) including ground wear and effects bookkeeping. */
    simulate(seconds: number) {
      const s = session;
      if (!s) return;
      const g = s.game;
      let acc = 0;
      for (let t = 0; t < seconds; t += 1 / 30) {
        g.step(1 / 30);
        for (const r of g.runners) if (r.alive && r.moving && !r.type.flying) s.damage.stamp(r.x, r.z, 0.45, { trample: (1 / 30) * 0.045 });
        for (const e of g.events) { s.fx.handle(e); if (e.type === 'death') s.rv.onDeath(e.runnerId); }
        g.events.length = 0;
        acc += 1 / 30;
        if (acc >= 0.5) { s.damage.update(acc); s.fx.update(acc); s.rv.update(acc); acc = 0; }
        if (g.phase === 'build' && g.outcome === 'playing' && isFinite(g.buildTimer)) g.startWave();
      }
    },
    async shot(name = 'shot') {
      tick(1 / 60);
      const data = canvas.toDataURL('image/jpeg', 0.85);
      await fetch(`/__shot?name=${name}`, { method: 'POST', body: data });
      return name;
    },
  };
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto) void startGame((auto as Difficulty) || 'normal');
}

frame();
boot();
