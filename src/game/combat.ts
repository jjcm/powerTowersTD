// Tower behaviour: targeting, powered vs unpowered attacks, overcharge heat, mana infusion
// and spells.

import { M, SPELLS } from './data/structures';
import type { Game } from './sim';
import type { Projectile, Runner, Structure } from './types';

type ProjSpec = Omit<Projectile, 'id' | 'x' | 'y' | 'z' | 't' | 'dur'> & { dur?: number };

export function fireProjectile(g: Game, spec: ProjSpec): Projectile {
  const d = Math.hypot(spec.tx - spec.sx, spec.tz - spec.sz);
  const p: Projectile = {
    ...spec, id: g.id(), x: spec.sx, y: spec.sy, z: spec.sz, t: 0,
    dur: spec.dur ?? Math.max(0.25, d / spec.speed),
  };
  g.projectiles.push(p);
  return p;
}

const OVERCHARGE_DMG = 1.5;
const OVERCHARGE_SPEED = 1.3;
const OVERCHARGE_COST = 2.2;
const INFUSION_BONUS = 0.35;

function findTarget(g: Game, s: Structure, range: number): Runner | undefined {
  const cur = g.runnerById.get(s.targetId);
  if (cur && cur.alive && Math.hypot(cur.x - s.cx, cur.z - s.cz) <= range) {
    // keep current target unless something is much further along
    return pickFirst(g, s, range) ?? cur;
  }
  const t = pickFirst(g, s, range);
  s.targetId = t?.id ?? -1;
  return t;
}

function pickFirst(g: Game, s: Structure, range: number): Runner | undefined {
  let best: Runner | undefined, bp = Infinity;
  for (const r of g.runners) {
    if (!r.alive) continue;
    const d = Math.hypot(r.x - s.cx, r.z - s.cz);
    if (d > range) continue;
    if (r.progress < bp) { bp = r.progress; best = r; }
  }
  if (best) s.targetId = best.id;
  return best;
}

function runnersNear(g: Game, x: number, z: number, r: number) {
  return g.runners.filter((u) => u.alive && Math.hypot(u.x - x, u.z - z) <= r);
}

/** Center of the densest cluster among runners in range. */
function bestCluster(g: Game, s: Structure, range: number, radius: number): { x: number; z: number; n: number } | null {
  const cands = runnersNear(g, s.cx, s.cz, range);
  if (!cands.length) return null;
  let best = { x: cands[0].x, z: cands[0].z, n: 0 };
  for (const c of cands) {
    const n = cands.reduce((a, o) => a + (Math.hypot(o.x - c.x, o.z - c.z) <= radius ? 1 : 0), 0);
    if (n > best.n) best = { x: c.x, z: c.z, n };
  }
  return best;
}

const muzzleY = (s: Structure) => s.y + (s.def.size === 1 ? 1.4 : 2.1);

export function towerStep(g: Game, s: Structure, dt: number) {
  const def = s.def;
  s.poweredGlow = Math.max(0, s.poweredGlow - dt * 1.5);
  if (s.haste > 0) { s.haste -= dt; if (s.haste <= 0) s.hasteAmt = 0; }
  // heat
  const heatMul = g.researched.has('superconductors') ? 0.7 : 1;
  if (s.overheated > 0) {
    s.overheated -= dt;
    s.heat = Math.max(0, s.heat - 8 * dt);
    if (s.overheated <= 0) s.heat = 45;
    return;
  }
  s.heat = Math.max(0, s.heat - 4 * dt);
  if (s.disabled > 0) return;

  // spiked walls
  if (def.id === 'wall' && s.level > 1) {
    const dps = (s.level === 2 ? 8 : 24) * (1 + g.round * 0.08);
    for (const r of g.runners) {
      if (r.alive && Math.abs(r.x - s.cx) < 1.1 && Math.abs(r.z - s.cz) < 1.1) g.damage(r, dps * dt, s.id, 'physical');
    }
    return;
  }

  if (def.id === 'clock_tower') return clockStep(g, s, dt);
  const atk = def.attack;
  if (!atk) return;

  const L = M(s.level);
  const range = g.range(s);
  const hasteMul = 1 + s.hasteAmt;
  const oc = s.overcharge && g.canOvercharge(s);
  s.cooldown -= dt * hasteMul * (oc ? OVERCHARGE_SPEED : 1);
  s.special -= dt;
  s.spellCd -= dt;

  // spells (autocast)
  if (s.autocast && s.spellCd <= 0 && g.hasSpell(s)) castSpell(g, s, false);

  if (s.cooldown > 0) return;
  const target = findTarget(g, s, range);
  if (!target) { s.cooldown = 0; return; }

  s.aim = Math.atan2(target.x - s.cx, target.z - s.cz);
  const baseCd = atk.poweredCooldown ?? atk.cooldown;
  const costMul = oc ? OVERCHARGE_COST : 1;
  const attackCost = atk.consumption * L * baseCd * costMul;
  let powered = false;
  if (atk.consumption > 0 && s.energy >= attackCost && def.id !== 'chemical_tower' && def.id !== 'pyro_trap' && def.id !== 'dark_tower' && def.id !== 'vine_trap' && def.id !== 'tsunami_tower' && def.id !== 'swarm_tower') {
    s.energy -= attackCost;
    powered = true;
  }
  // mana infusion: towers linked to the mana grid hit harder
  let infusion = 1;
  if (def.spell && def.id !== 'hero_tower' && s.mana > 0) {
    const mcost = 0.25 * Math.max(atk.consumption, 5) * L * baseCd;
    if (s.mana >= mcost) { s.mana -= mcost; infusion = 1 + INFUSION_BONUS; }
  }
  const dmgMul = (oc ? OVERCHARGE_DMG : 1) * infusion;
  s.cooldown += powered ? baseCd : atk.cooldown;
  s.lastFire = g.time;
  if (powered) s.poweredGlow = 1;
  if (oc) {
    s.heat += 10 * (powered ? baseCd : atk.cooldown) * heatMul * (powered ? 1 : 0.4);
    if (s.heat >= 100) {
      s.overheated = 6;
      g.stats.overheats++;
      g.emit({ type: 'overheat', structureId: s.id });
      g.emit({ type: 'text', x: s.cx, z: s.cz, y: muzzleY(s) + 0.6, text: 'OVERHEATED', color: '#ff7a3a' });
      g.emit({ type: 'sound', name: 'overheat', x: s.cx, z: s.cz });
    }
  }

  const sx = s.cx, sy = muzzleY(s), sz = s.cz;
  const base = atk.damage * L * dmgMul;
  const tgtY = (r: Runner) => 0.7 * r.type.scale + (r.type.flying ? 0.6 : 0);

  switch (def.id) {
    case 'ballista':
      fireProjectile(g, { kind: 'bolt', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered, splash: 0, arc: 0,
        onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'physical'); } });
      g.emit({ type: 'sound', name: 'bolt', x: sx, z: sz, vol: 0.5 });
      break;
    case 'cannon': {
      const lead = leadPos(target, Math.hypot(target.x - sx, target.z - sz) / atk.projectileSpeed!);
      fireProjectile(g, { kind: 'cannonball', sx, sy, sz, tx: lead.x, ty: 0.2, tz: lead.z, targetId: -1, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered, splash: atk.splash!, arc: 2.5,
        onHit: (x, z) => g.splash(x, z, atk.splash!, base, s.id, 'physical') });
      g.emit({ type: 'sound', name: 'cannon', x: sx, z: sz });
      break;
    }
    case 'tesla_coil': {
      if (!powered) {
        g.damage(target, base, s.id, 'lightning');
        g.emit({ type: 'chain', points: [{ x: sx, y: sy + 0.4, z: sz }, { x: target.x, y: tgtY(target), z: target.z }], powered: false });
        break;
      }
      const hits = [target];
      const maxTargets = 2 + s.level;
      let last = target;
      while (hits.length < maxTargets) {
        let next: Runner | undefined, bd = 2.8;
        for (const r of g.runners) {
          if (!r.alive || hits.includes(r)) continue;
          const d = Math.hypot(r.x - last.x, r.z - last.z);
          if (d < bd) { bd = d; next = r; }
        }
        if (!next) break;
        hits.push(next); last = next;
      }
      let dmg = 45 * L * dmgMul;
      const pts = [{ x: sx, y: sy + 0.5, z: sz }];
      for (const h of hits) { pts.push({ x: h.x, y: tgtY(h), z: h.z }); g.damage(h, dmg, s.id, 'lightning'); dmg *= 0.5; }
      g.emit({ type: 'chain', points: pts, powered: true });
      g.emit({ type: 'sound', name: 'zap', x: sx, z: sz });
      break;
    }
    case 'demon_tower':
      fireProjectile(g, { kind: 'fireball', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered, splash: 0, arc: 0,
        onHit: (_x, _z, t) => {
          if (!t) return;
          g.damage(t, base, s.id, 'fire');
          if (powered && t.alive) {
            g.damage(t, 40 * L * dmgMul, s.id, 'fire');
            t.burnDps = Math.max(t.burnDps, 12 * L * dmgMul); t.burnT = 2;
          }
        } });
      g.emit({ type: 'sound', name: 'fire', x: sx, z: sz, vol: 0.5 });
      break;
    case 'lich_tower':
      fireProjectile(g, { kind: 'frost', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered, splash: 0, arc: 0,
        onHit: (x, z, t) => {
          if (t) g.damage(t, base, s.id, 'frost');
          if (powered) {
            g.splash(x, z, 1.6, 25 * L * dmgMul, s.id, 'frost', false, (r) => { r.slowAmt = Math.max(r.slowAmt, 0.45); r.slowT = Math.max(r.slowT, 2.5); });
            g.emit({ type: 'nova', x, z, r: 1.6, kind: 'frost' });
          }
        } });
      g.emit({ type: 'sound', name: 'frost', x: sx, z: sz, vol: 0.5 });
      break;
    case 'chemical_tower': {
      const vatCost = atk.consumption * L * 3 * costMul;
      if (s.special <= 0 && s.energy >= vatCost) {
        s.energy -= vatCost; s.special = 3; s.poweredGlow = 1;
        const lead = leadPos(target, 0.8);
        fireProjectile(g, { kind: 'acid', sx, sy, sz, tx: lead.x, ty: 0.3, tz: lead.z, targetId: -1, speed: 10, damage: base, sourceId: s.id, powered: true, splash: 1.3, arc: 2.2,
          onHit: (x, z) => g.splash(x, z, 1.3, 45 * L * dmgMul, s.id, 'acid', false, (r) => { r.poisonDps = Math.max(r.poisonDps, 12 * L * dmgMul); r.poisonT = 5; }) });
        g.emit({ type: 'sound', name: 'acid', x: sx, z: sz });
      } else {
        fireProjectile(g, { kind: 'acid', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered: false, splash: 0, arc: 0,
          onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'acid'); } });
      }
      break;
    }
    case 'pyro_trap': {
      const blazeCost = atk.consumption * L * 9 * costMul;
      if (s.special <= 0 && s.energy >= blazeCost) {
        const c = bestCluster(g, s, range, 1.8);
        if (c) {
          s.energy -= blazeCost; s.special = 9; s.poweredGlow = 1;
          g.splash(c.x, c.z, 1.8, 220 * L * dmgMul, s.id, 'fire', false, (r) => { r.burnDps = Math.max(r.burnDps, 25 * L * dmgMul); r.burnT = 4; });
          g.emit({ type: 'nova', x: c.x, z: c.z, r: 1.8, kind: 'fire' });
          g.emit({ type: 'sound', name: 'blaze', x: c.x, z: c.z });
          break;
        }
      }
      fireProjectile(g, { kind: 'ember', sx, sy: s.y + 0.6, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: 14, damage: base, sourceId: s.id, powered: false, splash: 0, arc: 0,
        onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'fire'); } });
      break;
    }
    case 'dark_tower': {
      const cost = atk.consumption * L * 4 * costMul;
      let despair = false;
      if (s.special <= 0 && s.energy >= cost) { s.energy -= cost; s.special = 4; despair = true; s.poweredGlow = 1; }
      fireProjectile(g, { kind: 'shadow', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered: despair, splash: 0, arc: 0,
        onHit: (x, z, t) => {
          if (t) g.damage(t, base, s.id, 'shadow');
          if (despair) {
            for (const r of g.runners) if (r.alive && Math.hypot(r.x - x, r.z - z) <= 2) { r.vulnAmt = Math.max(r.vulnAmt, 0.3); r.vulnT = 5; }
            g.emit({ type: 'nova', x, z, r: 2, kind: 'despair' });
          }
        } });
      break;
    }
    case 'vine_trap': {
      const cost = atk.consumption * L * 4 * costMul;
      if (s.special <= 0 && s.energy >= cost) {
        s.energy -= cost; s.special = 4; s.poweredGlow = 1;
        const dur = 1 + 0.5 * (s.level - 1);
        for (const r of runnersNear(g, s.cx, s.cz, range + 0.3)) r.rootT = Math.max(r.rootT, dur);
        g.emit({ type: 'nova', x: s.cx, z: s.cz, r: range + 0.3, kind: 'entangle' });
      }
      g.damage(target, base, s.id, 'physical');
      g.emit({ type: 'beam', kind: 'vine', x1: sx, z1: sz, x2: target.x, z2: target.z, y1: s.y + 0.8 });
      g.emit({ type: 'sound', name: 'whip', x: sx, z: sz, vol: 0.5 });
      break;
    }
    case 'tsunami_tower': {
      const cost = atk.consumption * L * 3 * costMul;
      if (s.special <= 0 && s.energy >= cost) {
        s.energy -= cost; s.special = 3; s.poweredGlow = 1;
        const rr = 2.2 + 0.1 * s.level;
        g.splash(s.cx, s.cz, rr, 60 * L * dmgMul, s.id, 'frost', false, (r) => {
          g.knockback(r, 1.2);
          r.slowAmt = Math.max(r.slowAmt, 0.5); r.slowT = Math.max(r.slowT, 1.5);
        });
        g.emit({ type: 'nova', x: s.cx, z: s.cz, r: rr, kind: 'water' });
        g.emit({ type: 'sound', name: 'splash', x: sx, z: sz });
      }
      fireProjectile(g, { kind: 'water', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered: false, splash: 0, arc: 0,
        onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'frost'); } });
      break;
    }
    case 'holy_tower':
      if (powered) {
        const dx = target.x - sx, dz = target.z - sz, d = Math.hypot(dx, dz) || 1;
        const ex = sx + (dx / d) * range, ez = sz + (dz / d) * range;
        const wdmg = (base + 30 * L * dmgMul);
        for (const r of g.runners) {
          if (!r.alive) continue;
          if (segDistLocal(r.x, r.z, sx, sz, ex, ez) < 0.65) g.damage(r, wdmg, s.id, 'holy');
        }
        g.emit({ type: 'beam', kind: 'holy', x1: sx, z1: sz, x2: ex, z2: ez, y1: sy });
        g.emit({ type: 'sound', name: 'holy', x: sx, z: sz, vol: 0.6 });
      } else {
        fireProjectile(g, { kind: 'light', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered, splash: 0, arc: 0,
          onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'holy'); } });
      }
      break;
    case 'swarm_tower': {
      const cost = atk.consumption * L * 8 * costMul;
      const maxW = 2 + Math.floor(s.level / 2);
      if (s.special <= 0 && s.whelps < maxW && s.energy >= cost) {
        s.energy -= cost; s.special = 8; s.whelps++; s.poweredGlow = 1;
        g.whelps.push({ id: g.id(), ownerId: s.id, x: s.cx, y: s.y + 2.5, z: s.cz, heading: 0, life: 14, cooldown: 0.5, damage: 22 * L * dmgMul, targetId: -1 });
        g.emit({ type: 'sound', name: 'roar', x: sx, z: sz });
      }
      fireProjectile(g, { kind: 'fireball', sx, sy, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: atk.projectileSpeed!, damage: base, sourceId: s.id, powered: false, splash: 0, arc: 0,
        onHit: (_x, _z, t) => { if (t) g.damage(t, base, s.id, 'fire'); } });
      break;
    }
    case 'hero_tower': {
      const hl = s.heroLevel;
      const dmg = (180 + 90 * (hl - 1)) * Math.pow(1.35, hl - 1) * (oc ? OVERCHARGE_DMG : 1);
      s.cooldown = Math.max(0.6, 1.4 - 0.1 * (hl - 1)) + s.cooldown - (powered ? baseCd : atk.cooldown);
      fireProjectile(g, { kind: 'arcane', sx, sy: sy + 1, sz, tx: target.x, ty: tgtY(target), tz: target.z, targetId: target.id, speed: 20, damage: dmg, sourceId: s.id, powered: true, splash: 0, arc: 0,
        onHit: (_x, _z, t) => { if (t) { g.damage(t, dmg, s.id, 'spell'); g.heroXp(s, dmg / 60); } } });
      g.emit({ type: 'sound', name: 'arcane', x: sx, z: sz, vol: 0.5 });
      break;
    }
  }
}

function clockStep(g: Game, s: Structure, dt: number) {
  s.special -= dt;
  if (s.special > 0 || g.phase !== 'wave') return;
  const L = M(s.level);
  const cost = 12 * L * 1;
  if (s.energy < cost) return;
  s.energy -= cost;
  s.special = 1;
  s.poweredGlow = 1;
  const amt = 0.2 + 0.05 * (s.level - 1);
  const r = g.range(s);
  for (const o of g.structures) {
    if (o === s || !o.def.attack) continue;
    if (Math.hypot(o.cx - s.cx, o.cz - s.cz) <= r) { o.haste = 4; o.hasteAmt = Math.max(o.hasteAmt, amt); }
  }
  if (Math.floor(g.time) % 2 === 0) g.emit({ type: 'nova', x: s.cx, z: s.cz, r, kind: 'clock' });
}

function leadPos(r: Runner, t: number) {
  if (!r.moving) return { x: r.x, z: r.z };
  const v = r.type.speed * r.speedMul;
  const nx = r.x + Math.sin(r.heading) * v * t, nz = r.z + Math.cos(r.heading) * v * t;
  return { x: nx, z: nz };
}

function segDistLocal(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function castSpell(g: Game, s: Structure, manual: boolean): boolean {
  if (!s.def.spell || !g.hasSpell(s) || s.spellCd > 0 || s.disabled > 0 || s.overheated > 0) return false;
  const sp = SPELLS[s.def.spell];
  const cost = g.spellCost(s);
  if (s.mana < cost) return false;
  const range = g.range(s);
  const lvl = s.def.id === 'hero_tower' ? s.heroLevel : s.level;
  const L = M(lvl) * (g.researched.has('leymastery') ? 1.25 : 1);
  const minTargets = manual ? 1 : 2;

  const zone = (kind: 'fire' | 'plague' | 'consecrate' | 'whirlpool' | 'blizzard' | 'thunder', x: number, z: number, r: number, dur: number, dps: number) =>
    g.zones.push({ id: g.id(), kind, x, z, r, t: 0, dur, dps, sourceId: s.id, tick: 0 });

  let x = 0, z = 0;
  switch (sp.id) {
    case 'curse':
    case 'stormbolt': {
      let best: Runner | undefined;
      for (const r of runnersNear(g, s.cx, s.cz, range)) if (!best || r.hp > best.hp) best = r;
      if (!best) return false;
      if (sp.id === 'stormbolt' && !manual && best.hp < best.maxHp * 0.25 && runnersNear(g, s.cx, s.cz, range).length < 2) return false;
      x = best.x; z = best.z;
      const target = best;
      if (sp.id === 'curse') {
        target.curseT = 6;
        g.emit({ type: 'nova', x, z, r: 0.8, kind: 'despair' });
      } else {
        const dmg = sp.damage * Math.pow(lvl, 1.6) * (g.researched.has('leymastery') ? 1.25 : 1);
        fireProjectile(g, { kind: 'arcane', sx: s.cx, sy: s.y + 3, sz: s.cz, tx: x, ty: 0.8, tz: z, targetId: target.id, speed: 16, damage: dmg, sourceId: s.id, powered: true, splash: 0, arc: 0,
          onHit: (_x, _z, t) => { if (t) { g.damage(t, dmg, s.id, 'spell'); if (t.alive) t.stunT = Math.max(t.stunT, 1.5); } } });
      }
      break;
    }
    default: {
      const c = bestCluster(g, s, range, sp.radius);
      if (!c || c.n < minTargets) return false;
      x = c.x; z = c.z;
      switch (sp.id) {
        case 'thunderstorm': zone('thunder', x, z, sp.radius, 3, sp.damage * L); break;
        case 'blizzard': zone('blizzard', x, z, sp.radius, 3, sp.damage * L); break;
        case 'meteor': {
          const dmg = sp.damage * L;
          fireProjectile(g, { kind: 'fireball', sx: x - 4, sy: 14, sz: z - 3, tx: x, ty: 0, tz: z, targetId: -1, speed: 16, damage: dmg, sourceId: s.id, powered: true, splash: sp.radius, arc: 0, dur: 1,
            onHit: (hx, hz) => {
              g.splash(hx, hz, sp.radius, dmg, s.id, 'spell', false);
              g.zones.push({ id: g.id(), kind: 'fire', x: hx, z: hz, r: sp.radius * 0.9, t: 0, dur: 4, dps: 30 * L, sourceId: s.id, tick: 0 });
              g.emit({ type: 'nova', x: hx, z: hz, r: sp.radius, kind: 'fire' });
              g.emit({ type: 'sound', name: 'blaze', x: hx, z: hz });
            } });
          break;
        }
        case 'plague': zone('plague', x, z, sp.radius, 6, sp.damage * L); break;
        case 'consecrate': zone('consecrate', x, z, sp.radius, 5, sp.damage * L); break;
        case 'whirlpool': zone('whirlpool', x, z, sp.radius, 2.5, sp.damage * L); break;
        case 'overgrowth': {
          const dur = 2.5 + 0.25 * (lvl - 1);
          for (const r of runnersNear(g, x, z, sp.radius)) r.rootT = Math.max(r.rootT, dur);
          zone('plague', x, z, 0.01, dur, 0);
          g.splash(x, z, sp.radius, sp.damage * L * dur, s.id, 'spell', false);
          g.emit({ type: 'nova', x, z, r: sp.radius, kind: 'entangle' });
          break;
        }
      }
    }
  }
  s.mana -= cost;
  s.spellCd = sp.cooldown;
  g.stats.spellsCast++;
  g.emit({ type: 'spell', spell: sp.id, x, z, r: sp.radius, sourceId: s.id });
  g.emit({ type: 'sound', name: 'spell_' + sp.id, x, z });
  return true;
}
