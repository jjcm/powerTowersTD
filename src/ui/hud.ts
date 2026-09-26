import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { Structure } from '../game/types';
import { STRUCTURES, BUILD_TABS, SPELLS, M, levelCost, totalCost, type StructureDef, type StructureId } from '../game/data/structures';
import { RESEARCH, RESEARCH_ORDER, type ResearchId } from '../game/data/research';
import { RUNNERS, DIFFICULTIES, MAX_ROUND, buildWave, roundBaseHp, type Difficulty } from '../game/data/runners';
import { WEATHER } from '../game/env';
import type { Assets } from '../render/assets';
import type { Controller } from '../input/controller';

export interface AppHooks {
  start(d: Difficulty): void;
  restart(): void;
  toTitle(): void;
  settings: { shadows: boolean; bloom: boolean; resolution: number; volume: number; edgeScroll: boolean; autoLink: boolean; showPath: boolean; foliage: boolean; arcShadows: boolean; manyLights: boolean; ao: boolean; tiltShift: boolean; atmosphere: boolean };
  applySettings(): void;
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
}

interface Tip { title: string; cost?: number | string; body: string; hk?: string }
interface Btn {
  icon?: string; square?: boolean; label: string; cost?: number; disabled?: boolean; cant?: boolean; on?: boolean; lock?: boolean;
  up?: boolean; cd?: number; active?: boolean; tip: () => Tip; action?: () => void; alt?: () => void;
}

const GRID_KEYS = ['q', 'w', 'e', 'a', 's', 'd'];
const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${Math.round(n)}`);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Hud {
  root: HTMLElement;
  private game!: Game;
  private ctrl!: Controller;
  private refs: Record<string, HTMLElement> = {};
  private buttons: (Btn | null)[] = [];
  private cardKey = '';
  private cardT = 0;
  private tipBtn: Btn | null = null;
  private tipEl!: HTMLElement;
  private msgs!: HTMLElement;
  private floatPool: { el: HTMLElement; x: number; y: number; z: number; t: number; big: boolean }[] = [];
  private researchOpen = false;
  private menuOpen = false;
  private modal: HTMLElement | null = null;
  private endShown = false;
  private gameUi!: HTMLElement;
  private title!: HTMLElement;

  constructor(private assets: Assets, private app: AppHooks) {
    this.root = document.getElementById('ui')!;
  }

  // ---------------------------------------------------------------- title
  showTitle(loading: boolean) {
    this.clearModal();
    this.gameUi?.remove();
    this.title?.remove();
    const t = el('div', 'title-screen');
    const art = this.assets.ui('title_art');
    if (art) t.style.backgroundImage = `url(${art})`;
    else t.style.background = 'radial-gradient(circle at 50% 40%, #1d2a4a, #05070b)';
    t.append(el('h1', 'title-logo', 'Power Towers'), el('div', 'title-sub', 'Maze the horde · Power the towers · Master the mana'));
    const diffs = el('div', 'diffs');
    let chosen: Difficulty = 'normal';
    (Object.keys(DIFFICULTIES) as Difficulty[]).forEach((d) => {
      const info = DIFFICULTIES[d];
      const card = el('div', 'diff frame' + (d === chosen ? ' sel' : ''), `<h4>${info.name}</h4><p>${info.desc}</p><p style="margin-top:6px">${info.lives} lives · ${info.gold} gold</p>`);
      card.onclick = () => { chosen = d; diffs.querySelectorAll('.diff').forEach((x) => x.classList.remove('sel')); card.classList.add('sel'); };
      card.ondblclick = () => { if (!loading) this.app.start(d); };
      diffs.append(card);
    });
    t.append(diffs);
    const actions = el('div', 'title-actions');
    const play = el('button', 'mbtn frame primary', 'Begin');
    play.style.minWidth = '200px';
    play.onclick = () => this.app.start(chosen);
    const help = el('button', 'mbtn frame', 'How to Play');
    help.onclick = () => this.openHelp();
    actions.append(play, help);
    t.append(actions);
    const ld = el('div', 'loading', loading ? 'Summoning assets…' : '');
    const lb = el('div', 'loadbar', '<i></i>');
    if (!loading) lb.classList.add('hidden');
    t.append(ld, lb);
    this.refs.loadText = ld;
    this.refs.loadBar = lb.firstChild as HTMLElement;
    this.refs.play = play;
    (play as HTMLButtonElement).disabled = loading;
    if (loading) play.style.opacity = '0.5';
    this.root.append(t);
    this.title = t;
  }

  setLoading(done: number, total: number) {
    if (!this.refs.loadBar) return;
    this.refs.loadBar.style.width = `${(done / total) * 100}%`;
    if (done >= total) {
      this.refs.loadText.textContent = '';
      this.refs.loadBar.parentElement!.classList.add('hidden');
      (this.refs.play as HTMLButtonElement).disabled = false;
      this.refs.play.style.opacity = '1';
    }
  }

  // ---------------------------------------------------------------- game ui
  attach(game: Game, ctrl: Controller) {
    this.game = game;
    this.ctrl = ctrl;
    this.endShown = false;
    this.title?.remove();
    this.gameUi?.remove();
    this.clearModal();
    const ui = el('div');
    ui.style.cssText = 'position:absolute;inset:0';
    this.gameUi = ui;
    const coin = this.assets.ui('hud_gold') ?? '';

    // top bar
    const top = el('div', 'topbar');
    const left = el('div', 'tb-left');
    const menu = el('button', 'pill frame btn-menu interactive', '<div class="burger"><i></i><i></i><i></i></div><span>Menu</span>');
    menu.onclick = () => this.openMenu();
    const research = el('button', 'pill frame btn-research interactive', `<img src="${this.assets.icon('research') ?? ''}"><div><div>Research</div><div class="rname"></div></div><div class="rprog"></div>`);
    research.onclick = () => this.toggleResearch();
    research.onmouseenter = () => this.showTip({ title: 'Research', body: 'Open the tech tree. Unlock new towers, generators, mana, spells and upgrade levels.', hk: 'R' }, 'top');
    research.onmouseleave = () => this.hideTip();
    left.append(menu, research);

    const center = el('div', 'tb-center');
    const env = el('div', 'env frame interactive', `<img class="tod"><span class="clock"></span><img class="wimg"><span class="wname"></span><span class="next">→ <img class="nimg"><span class="nt"></span></span>`);
    env.onmouseenter = () => this.showTip(this.envTip(), 'top');
    env.onmouseleave = () => this.hideTip();
    const gstats = el('div', 'grid-stats frame interactive', `<span class="gs pw"><img src="${this.assets.ui('hud_power') ?? ''}"><span></span></span><span class="gs mn"><img src="${this.assets.ui('hud_mana') ?? ''}"><span></span></span><span class="gs mz" title="Maze length">⤳ <span></span></span>`);
    gstats.onmouseenter = () => this.showTip(this.gridTip(), 'top');
    gstats.onmouseleave = () => this.hideTip();
    center.append(env, gstats);

    const right = el('div', 'tb-right');
    const row = el('div', 'tb-row');
    row.append(
      el('div', 'pill frame gold', `<img src="${coin}"><span class="val" data-k="gold"></span>`),
      el('div', 'pill frame', `<img src="${this.assets.ui('hud_units') ?? ''}"><span class="val" data-k="units"></span>`),
      el('div', 'pill frame', `<img src="${this.assets.ui('hud_lives') ?? ''}"><span class="val" data-k="lives" style="min-width:40px"></span>`),
      el('div', 'pill frame navy round-pill', `<span data-k="round"></span>`),
    );
    const wave = el('div', 'wave-box');
    const waveName = el('span', 'wave-name');
    const send = el('button', 'btn-wave frame interactive', `<img src="${this.assets.icon('start_wave') ?? ''}"><span class="lbl">Send wave</span><span class="t"></span>`);
    send.onclick = () => game.startWave();
    send.onmouseenter = () => this.showTip(this.waveTip(), 'top');
    send.onmouseleave = () => this.hideTip();
    const speed = el('div', 'speed interactive');
    for (const [label, v] of [['❚❚', 0], ['1×', 1], ['2×', 2], ['3×', 3]] as [string, number][]) {
      const b = el('button', 'frame', label);
      b.dataset.speed = String(v);
      b.onclick = () => this.setSpeed(v);
      speed.append(b);
    }
    wave.append(waveName, send, speed);
    right.append(row, wave);
    top.append(left, center, right);
    ui.append(top);

    // messages + status
    this.msgs = el('div', 'messages');
    ui.append(this.msgs);
    const status = el('div', 'status');
    status.append(el('div', 'hint'));
    ui.append(status);

    // command card
    const card = el('div', 'card interactive');
    card.append(el('i', 'corner c1'), el('i', 'corner c2'), el('i', 'corner c3'), el('i', 'corner c4'));
    const inner = el('div', 'inner');
    const pcol = el('div', 'portrait-col');
    const portrait = el('div', 'portrait', '<img><span class="lvl"></span><div class="badges"></div>');
    portrait.onmouseenter = () => { const s = this.ctrl.selected; if (s) this.showTip(this.structureTip(s)); };
    portrait.onmouseleave = () => this.hideTip();
    pcol.append(portrait, el('div', 'pname'), el('div', 'bars'));
    const gcol = el('div', 'grid-col');
    const tabs = el('div', 'tabs');
    BUILD_TABS.forEach((t, i) => {
      const b = el('button', 'tab', t.name);
      b.onclick = () => { this.ctrl.tab = t.id; this.cardKey = ''; };
      b.onmouseenter = () => this.showTip({ title: t.name, body: 'Build category.', hk: String(i + 1) });
      b.onmouseleave = () => this.hideTip();
      tabs.append(b);
    });
    const rinfo = el('div', 'rinfo hidden');
    const grid = el('div', 'cgrid');
    for (let i = 0; i < 6; i++) {
      const b = el('div', 'cbtn');
      b.onmouseenter = () => { this.tipBtn = this.buttons[i]; if (this.tipBtn) this.showTip(this.tipBtn.tip()); };
      b.onmouseleave = () => { this.tipBtn = null; this.hideTip(); };
      // act on press (WC3-style) — also immune to the card re-render swapping the inner nodes mid-click
      b.onpointerdown = (e) => { if (e.button === 0) { e.preventDefault(); this.press(i); } };
      b.oncontextmenu = (e) => { e.preventDefault(); const bt = this.buttons[i]; if (bt?.alt) { bt.alt(); this.cardKey = ''; } };
      grid.append(b);
    }
    gcol.append(tabs, rinfo, grid);
    inner.append(pcol, gcol);
    card.append(inner);
    ui.append(card);
    this.tipEl = el('div', 'tooltip frame');
    ui.append(this.tipEl);
    this.root.append(ui);

    Object.assign(this.refs, {
      gold: ui.querySelector('[data-k=gold]')!, units: ui.querySelector('[data-k=units]')!, lives: ui.querySelector('[data-k=lives]')!,
      round: ui.querySelector('[data-k=round]')!, rname: research.querySelector('.rname')!, rprog: research.querySelector('.rprog')!,
      tod: env.querySelector('.tod')!, clock: env.querySelector('.clock')!, wimg: env.querySelector('.wimg')!, wname: env.querySelector('.wname')!,
      nimg: env.querySelector('.nimg')!, nt: env.querySelector('.nt')!, pw: gstats.querySelector('.pw span')!, mn: gstats.querySelector('.mn')!, mz: gstats.querySelector('.mz span')!,
      waveName, send, sendT: send.querySelector('.t')!, sendL: send.querySelector('.lbl')!, speed, portrait, pname: pcol.querySelector('.pname')!, bars: pcol.querySelector('.bars')!,
      tabs, grid, rinfo, hint: status.querySelector('.hint')!, card,
    });
    this.setSpeed(game.speed);
    this.cardKey = '';
  }

  setSpeed(v: number) {
    if (v === 0) this.game.paused = !this.game.paused;
    else { this.game.speed = v; this.game.paused = false; }
    this.refs.speed.querySelectorAll('button').forEach((b) => {
      const sv = Number((b as HTMLElement).dataset.speed);
      b.classList.toggle('on', sv === 0 ? this.game.paused : !this.game.paused && sv === this.game.speed);
    });
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.game;
    if (!g || !this.refs.gold) return;
    this.refs.gold.textContent = fmt(g.gold);
    const alive = g.runners.filter((r) => r.alive).length;
    this.refs.units.textContent = g.phase === 'wave' ? `${alive + g.spawnQueue.length}/${g.waveTotal}` : `0/${16 + g.round + 1}`;
    this.refs.lives.textContent = String(g.lives);
    this.refs.round.textContent = `Round ${Math.max(1, g.phase === 'wave' ? g.round : g.round + 1)}`;
    // research
    if (g.researching) {
      const d = RESEARCH[g.researching.id];
      this.refs.rname.textContent = `${d.name} · ${Math.ceil(g.researching.remaining)}s`;
      this.refs.rprog.style.width = `${(1 - g.researching.remaining / d.time) * 100}%`;
    } else {
      const avail = RESEARCH_ORDER.filter((r) => g.researchState(r.id) === 'available' && g.gold >= r.cost).length;
      this.refs.rname.textContent = avail ? `${avail} available` : '';
      this.refs.rprog.style.width = '0';
    }
    // environment
    const env = g.env;
    const tod = env.isNight ? 'hud_moon' : 'hud_sun';
    this.setImg(this.refs.tod, this.assets.ui(tod));
    this.refs.clock.textContent = env.clock;
    this.setImg(this.refs.wimg, this.assets.ui('hud_' + env.weather));
    this.refs.wname.textContent = WEATHER[env.weather].name;
    this.setImg(this.refs.nimg, this.assets.ui('hud_' + env.next));
    this.refs.nt.textContent = `${Math.ceil(env.weatherT)}s`;
    // grid stats
    let gen = 0, draw = 0, mgen = 0, mdraw = 0;
    for (const s of g.structures) {
      if (s.def.energy?.production) gen += s.producing;
      if (s.def.mana?.production) mgen += s.producing;
      if (s.def.attack && s.def.energy) draw += s.flowIn;
      if (g.acceptsMana(s) && !s.def.mana?.production && !s.def.source) mdraw += s.manaIn;
    }
    this.refs.pw.innerHTML = `<span class="${gen + 0.5 >= draw ? 'ok' : 'bad'}">+${gen.toFixed(0)}</span> / ${draw.toFixed(0)} W`;
    this.refs.mn.classList.toggle('hidden', !g.researched.has('arcane'));
    (this.refs.mn.lastElementChild as HTMLElement).innerHTML = `+${mgen.toFixed(1)} / ${mdraw.toFixed(1)}`;
    this.refs.mz.textContent = `${Math.round(g.pathLength())}`;
    // wave
    this.refs.waveName.textContent = g.phase === 'wave' && g.wave?.name ? g.wave.name : '';
    const canSend = g.phase === 'build' && g.outcome === 'playing';
    this.refs.send.classList.toggle('hidden', !canSend);
    this.refs.sendL.textContent = g.round === 0 ? 'Begin round 1' : 'Send next wave';
    this.refs.sendT.textContent = isFinite(g.buildTimer) ? `${Math.ceil(g.buildTimer)}s` : '';
    // hint line
    this.refs.hint.innerHTML = this.hint();
    // card
    this.cardT -= dt;
    const key = this.cardStateKey();
    if (key !== this.cardKey || this.cardT <= 0) { this.cardKey = key; this.cardT = 0.2; this.renderCard(); }
    this.updateBars();
    if (this.tipBtn && this.tipEl.classList.contains('show')) this.showTip(this.tipBtn.tip());
    // floating text
    this.updateFloats(dt);
    if (this.researchOpen && this.modal) this.refreshResearch();
    if (g.outcome !== 'playing' && !this.endShown) this.showEnd();
  }

  private setImg(e: HTMLElement, src?: string) {
    const img = e as HTMLImageElement;
    if (src && img.getAttribute('src') !== src) img.src = src;
  }

  private hint(): string {
    const m = this.ctrl.mode, g = this.game;
    if (m.kind === 'build') {
      const def = STRUCTURES[m.id];
      const chk = this.ctrl.lastPlaceCheck;
      const why = chk && !chk.ok && chk.reason ? ` · <span style="color:#ff8a7a">${chk.reason}</span>` : '';
      return `Placing <b>${def.name}</b> — ${def.size === 1 ? 'click-drag to build a line, ' : 'Shift-click to place several, '}right-click to cancel${why}`;
    }
    if (m.kind === 'link') return m.op === 'connect' ? `Click a structure to <b>link</b> ${m.from.def.name}. Shift-click to link several. Right-click to cancel.` : `Click a linked structure to <b>unlink</b> it.`;
    if (g.round === 0 && g.structures.length === 0) return 'Build <b>walls</b> to lengthen the maze, then <b>generators</b> and <b>towers</b>. Runners must visit checkpoints <b>1 → 5</b> before reaching the castle.';
    if (g.round === 0) return 'Link generators to towers with <b>Connect</b>. Press <b>Space</b> or <b>Begin round 1</b> when ready.';
    return '';
  }

  private cardStateKey() {
    const c = this.ctrl, g = this.game;
    const s = c.mode.kind === 'link' ? c.mode.from : c.selected;
    const parts = [c.mode.kind, c.mode.kind === 'build' ? c.mode.id : '', c.tab, s?.id ?? -1, c.selectedRunner?.id ?? -1, s?.level ?? 0, s?.overcharge ?? '', s?.autocast ?? '', s?.links.length ?? 0, s?.inLinks.length ?? 0, g.researched.size, Math.floor(g.gold / 10), g.phase];
    return parts.join('|');
  }

  // ---------------------------------------------------------------- command card
  private renderCard() {
    const c = this.ctrl, g = this.game;
    const s = c.mode.kind === 'link' ? c.mode.from : c.selected;
    const pimg = this.refs.portrait.querySelector('img') as HTMLImageElement;
    const r = c.mode.kind === 'idle' ? c.selectedRunner : null;
    this.refs.rinfo.classList.toggle('hidden', !r);
    this.refs.grid.classList.toggle('hidden', !!r);
    if (r) {
      const t = r.type;
      this.setImg(pimg, this.assets.portrait(t.model));
      this.refs.pname.textContent = t.name;
      (this.refs.portrait.querySelector('.lvl') as HTMLElement).style.display = 'none';
      (this.refs.portrait.querySelector('.badges') as HTMLElement).innerHTML = t.boss ? '<span class="badge" style="color:#ffb04a">Boss</span>' : '';
      this.refs.tabs.classList.add('hidden');
      const fx: string[] = [];
      if (r.slowT > 0) fx.push(`Slowed ${Math.round(r.slowAmt * 100)}%`);
      if (r.rootT > 0) fx.push('Rooted');
      if (r.stunT > 0) fx.push('Stunned');
      if (r.burnT > 0) fx.push('Burning');
      if (r.poisonT > 0) fx.push('Poisoned');
      if (r.vulnT > 0) fx.push(`Despair +${Math.round(r.vulnAmt * 100)}% dmg`);
      if (r.curseT > 0) fx.push('Cursed +60% dmg');
      this.refs.rinfo.innerHTML = `<p>${t.desc}</p><div class="stats"><span>Speed</span><b>${(t.speed * r.speedMul).toFixed(1)}</b><span>Armor</span><b>${t.armor}</b><span>Bounty</span><b>${r.bounty} gold</b><span>Lives</span><b>${t.lives}</b><span>Checkpoint</span><b>${Math.min(5, r.leg + 1)}${r.leg >= 5 ? ' → castle' : ''}</b></div>${fx.length ? `<p class="fx">${fx.join(' · ')}</p>` : ''}`;
      this.buttons = [null, null, null, null, null, null];
      return;
    }
    const lvl = this.refs.portrait.querySelector('.lvl') as HTMLElement;
    const badges = this.refs.portrait.querySelector('.badges') as HTMLElement;
    this.refs.tabs.classList.toggle('hidden', !!s || c.mode.kind === 'link');
    if (s) {
      this.setImg(pimg, this.assets.portrait(s.def.model));
      this.refs.pname.textContent = s.def.name;
      lvl.textContent = s.def.id === 'hero_tower' ? `Lv ${s.heroLevel}` : s.def.maxLevel > 1 ? `Lv ${s.level}` : '';
      lvl.style.display = lvl.textContent ? '' : 'none';
      const b: string[] = [];
      if (s.onPlateau) b.push('<span class="badge" style="color:#9fe8a0">High ground</span>');
      if (s.disabled > 0) b.push('<span class="badge" style="color:#8fdcff">EMP</span>');
      if (s.overheated > 0) b.push('<span class="badge" style="color:#ff8a3a">Overheated</span>');
      if (s.nearLey) b.push('<span class="badge" style="color:#d9a0ff">Ley line</span>');
      badges.innerHTML = b.join('');
      this.buttons = this.structureButtons(s);
    } else {
      this.setImg(pimg, this.assets.portrait('castle_gate'));
      this.refs.pname.textContent = 'Architect';
      lvl.style.display = 'none';
      badges.innerHTML = '';
      this.buttons = this.buildButtons();
      this.refs.tabs.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('on', BUILD_TABS[i].id === c.tab));
    }
    const cells = this.refs.grid.children;
    for (let i = 0; i < 6; i++) {
      const b = this.buttons[i];
      const e = cells[i] as HTMLElement;
      if (!b) { e.className = 'cbtn empty'; if (e.dataset.html) { e.dataset.html = ''; e.innerHTML = ''; } continue; }
      const cls = 'cbtn' + (b.disabled ? ' disabled' : '') + (b.cant ? ' cant' : '') + (b.on ? ' on' : '') + (b.active ? ' active-mode' : '');
      if (e.className !== cls) e.className = cls;
      const coin = this.assets.ui('hud_gold') ?? '';
      const label = b.cost !== undefined ? `<img src="${coin}">${fmt(b.cost)}` : b.label;
      const html = `<div class="ic">${b.icon ? `<img class="${b.square ? 'square' : ''}" src="${b.icon}">` : ''}</div>${b.up ? '<i class="up"></i>' : ''}${b.lock ? '<span class="lock">🔒</span>' : ''}<span class="hk">${GRID_KEYS[i].toUpperCase()}</span><div class="label">${label}</div>${b.cd ? `<div class="cd" style="transform:scaleY(${b.cd})"></div>` : ''}`;
      // only touch the DOM when the button actually changed
      if (e.dataset.html !== html) { e.dataset.html = html; e.innerHTML = html; }
    }
    if (this.tipBtn) {
      const i = this.buttons.findIndex((x) => x && x.label === this.tipBtn!.label);
      this.tipBtn = i >= 0 ? this.buttons[i] : null;
      if (!this.tipBtn) this.hideTip();
    }
  }

  private updateBars() {
    const c = this.ctrl, g = this.game;
    const s = c.mode.kind === 'link' ? c.mode.from : c.selected;
    const bars = this.refs.bars;
    const r = c.mode.kind === 'idle' ? c.selectedRunner : null;
    if (r) {
      const key = `r${r.id}`;
      if (bars.dataset.k !== key) { bars.dataset.k = key; bars.innerHTML = `<div class="pbar hp"><div class="fill"></div><span></span></div>${r.shieldMax > 0 ? '<div class="pbar mana shield"><div class="fill"></div><span></span></div>' : ''}`; }
      const hp = bars.querySelector('.hp') as HTMLElement;
      (hp.querySelector('.fill') as HTMLElement).style.width = `${(r.hp / r.maxHp) * 100}%`;
      (hp.querySelector('span') as HTMLElement).textContent = `${fmt(Math.max(0, r.hp))} / ${fmt(r.maxHp)}`;
      const sh = bars.querySelector('.shield') as HTMLElement | null;
      if (sh) { (sh.querySelector('.fill') as HTMLElement).style.width = `${(r.shield / r.shieldMax) * 100}%`; (sh.querySelector('span') as HTMLElement).textContent = `Shield ${fmt(r.shield)}`; }
      return;
    }
    if (!s) {
      const key = 'none';
      if (bars.dataset.k !== key) { bars.dataset.k = key; bars.innerHTML = `<div class="pbar energy" style="color:#ffd24a"><span></span></div>`; }
      (bars.querySelector('span') as HTMLElement).textContent = `${g.structures.length} structures`;
      return;
    }
    const ecap = g.energyCap(s), mcap = g.manaCap(s);
    const showHeat = s.overcharge || s.heat > 0 || s.overheated > 0;
    const key = `${s.id}|${ecap > 0}|${mcap > 0}|${showHeat}`;
    if (bars.dataset.k !== key) {
      bars.dataset.k = key;
      bars.innerHTML = (ecap > 0 ? '<div class="pbar energy"><div class="fill"></div><span></span></div>' : '') +
        (mcap > 0 ? '<div class="pbar mana"><div class="fill"></div><span></span></div>' : '') +
        (showHeat ? '<div class="pbar heat"><div class="fill"></div><span></span></div>' : '') +
        (ecap <= 0 && mcap <= 0 && !showHeat ? `<div class="pbar energy" style="color:#c8c0ae"><span></span></div>` : '');
    }
    const set = (cls: string, v: number, max: number, text: string) => {
      const b = bars.querySelector('.' + cls) as HTMLElement | null;
      if (!b) return;
      (b.querySelector('.fill') as HTMLElement | null)?.style.setProperty('width', `${Math.min(100, (v / Math.max(1, max)) * 100)}%`);
      (b.querySelector('span') as HTMLElement).textContent = text;
    };
    if (ecap > 0) set('energy', s.energy, ecap, `${fmt(s.energy)} / ${fmt(ecap)}`);
    if (mcap > 0) set('mana', s.mana, mcap, `${fmt(s.mana)} / ${fmt(mcap)}`);
    if (showHeat) set('heat', s.overheated > 0 ? 100 : s.heat, 100, s.overheated > 0 ? `OVERHEATED ${s.overheated.toFixed(0)}s` : `Heat ${Math.round(s.heat)}%`);
    if (ecap <= 0 && mcap <= 0 && !showHeat) (bars.querySelector('span') as HTMLElement).textContent = s.def.id === 'wall' ? (s.level > 1 ? 'Spiked' : 'Stone wall') : '';
  }

  private press(i: number) {
    const b = this.buttons[i];
    if (!b || b.disabled || !b.action) return;
    b.action();
    this.cardKey = '';
  }

  handleHotkey(k: string): boolean {
    const gi = GRID_KEYS.indexOf(k);
    if (this.menuOpen) return false;
    if (gi >= 0) { this.press(gi); return true; }
    if (['1', '2', '3', '4'].includes(k) && !this.ctrl.selected) { this.ctrl.tab = BUILD_TABS[Number(k) - 1].id; this.cardKey = ''; return true; }
    if (k === ' ') { this.game.startWave(); return true; }
    if (k === 'p') { this.setSpeed(0); return true; }
    if (k === ']' || k === '=') { this.setSpeed(Math.min(3, this.game.speed + 1)); return true; }
    if (k === '[' || k === '-') { this.setSpeed(Math.max(1, this.game.speed - 1)); return true; }
    if ((k === 'delete' || k === 'backspace') && this.ctrl.selected) { this.game.sell(this.ctrl.selected); return true; }
    return false;
  }

  private buildButtons(): (Btn | null)[] {
    const g = this.game;
    const tab = BUILD_TABS.find((t) => t.id === this.ctrl.tab)!;
    const out: (Btn | null)[] = tab.items.map((id) => {
      const def = STRUCTURES[id];
      const unlocked = g.isUnlocked(def);
      const uniqueTaken = def.unique && g.structures.some((s) => s.def.id === id);
      const mode = this.ctrl.mode;
      return {
        icon: this.assets.portrait(def.model), label: def.name, cost: def.cost, lock: !unlocked, disabled: !unlocked || uniqueTaken,
        cant: unlocked && g.gold < def.cost, active: mode.kind === 'build' && mode.id === id,
        tip: () => this.buildTip(def),
        action: () => this.ctrl.setMode({ kind: 'build', id }),
      } as Btn;
    });
    while (out.length < 6) out.push(null);
    return out;
  }

  private structureButtons(s: Structure): (Btn | null)[] {
    const g = this.game, c = this.ctrl;
    const out: (Btn | null)[] = [null, null, null, null, null, null];
    const def = s.def;
    // --- row 1: upgrades
    if (def.id === 'wall') {
      const can = g.canUpgrade(s);
      out[0] = {
        icon: this.assets.icon('spikes'), square: true, label: 'Spikes', cost: s.level < 3 ? g.upgradeCost(s) : undefined, up: s.level < 3,
        disabled: s.level >= 3 || (!can.ok && can.reason !== 'Not enough gold'), cant: can.reason === 'Not enough gold', lock: !g.researched.has('masonry'),
        tip: () => ({ title: s.level < 2 ? 'Iron Spikes' : s.level < 3 ? 'Barbed Spikes' : 'Fully spiked', cost: s.level < 3 ? g.upgradeCost(s) : undefined,
          body: `Damages runners walking alongside this wall. <br>${s.level < 3 ? `Damage: <b>${s.level === 1 ? 8 : 24}</b>/s (+8% per round)` : ''}${!g.researched.has('masonry') ? '<p class="req">Requires Masonry</p>' : ''}`, hk: 'Q' }),
        action: () => g.upgrade(s),
      };
    } else if (def.id === 'hero_tower') {
      const TH = [0, 300, 800, 1600, 2800, 4500];
      out[0] = { icon: this.assets.portrait(def.model), label: s.heroLevel < 6 ? `${Math.floor(s.xp)}/${TH[s.heroLevel]} xp` : 'Max level', disabled: true,
        tip: () => ({ title: `Archmage · Level ${s.heroLevel}`, body: 'Gains experience from runners that die in range and from its own damage. Each level increases damage, attack speed, range, mana capacity and Storm Bolt power.' }) };
    } else if (def.maxLevel > 1) {
      const can = g.canUpgrade(s);
      const max = s.level >= def.maxLevel;
      out[0] = {
        icon: this.assets.portrait(def.model), label: max ? 'Max' : `Lv ${s.level + 1}`, cost: max ? undefined : g.upgradeCost(s), up: !max,
        disabled: max || (!can.ok && can.reason !== 'Not enough gold'), cant: can.reason === 'Not enough gold', lock: !max && s.level >= g.maxLevel(def),
        tip: () => this.upgradeTip(s), action: () => g.upgrade(s),
      };
    }
    if (def.attack && def.energy && def.attack.consumption > 0) {
      const ok = g.canOvercharge(s);
      out[1] = {
        icon: this.assets.icon('overcharge'), square: true, label: s.overcharge ? 'Overcharging' : 'Overcharge', on: s.overcharge, lock: !ok, disabled: !ok,
        tip: () => ({ title: 'Overcharge', body: `Push the tower past its rating: <b>+50% damage</b> and <b>+30% attack speed</b>, but it uses <b>2.2× power</b> and builds heat. At 100% heat it shuts down for 6 seconds.${ok ? '' : '<p class="req">Requires Capacitors</p>'}`, hk: 'W' }),
        action: () => { s.overcharge = !s.overcharge; },
      };
    }
    if (def.spell) {
      const sp = SPELLS[def.spell];
      const has = g.hasSpell(s);
      const cost = has ? g.spellCost(s) : sp.mana;
      out[2] = {
        icon: this.assets.icon(sp.icon), square: true, label: s.autocast ? `Auto · ${cost}` : `${cost} mana`, on: s.autocast && has, lock: !has, disabled: !has,
        cd: has && s.spellCd > 0 ? Math.min(1, s.spellCd / sp.cooldown) : 0,
        tip: () => ({ title: sp.name, cost: `${cost} mana`, body: `${sp.desc}<br>Cooldown ${sp.cooldown}s${sp.radius ? ` · Radius ${sp.radius}` : ''}.<p style="color:#a9a293">Left-click: cast now · Right-click: toggle autocast (${s.autocast ? 'on' : 'off'})</p>${has ? '' : `<p class="req">${!g.researched.has('arcane') ? 'Requires Arcane Studies, then Spellweaving' : 'Requires Spellweaving'}</p>`}<p class="mn">Needs a mana link (Mana Well / Ley Obelisk / Graveyard).</p>`, hk: 'E' }),
        action: () => { if (!g.castNow(s)) this.message(s.mana < cost ? 'Not enough mana' : s.spellCd > 0 ? 'Spell not ready' : 'No targets in range', 'warn'); },
        alt: () => { s.autocast = !s.autocast; },
      };
    }
    // --- row 2: power
    const linkable = !!def.source || !!def.energy || g.acceptsMana(s);
    if (linkable) {
      const mode = c.mode;
      const hasTargets = g.structures.some((o) => o !== s && ((def.source && g.canLink(s, o).ok) || (o.def.source && g.canLink(o, s).ok)));
      out[3] = {
        icon: this.assets.icon('connect'), square: true, label: 'Connect', disabled: !hasTargets,
        active: mode.kind === 'link' && mode.op === 'connect',
        tip: () => ({ title: 'Connect', body: def.source ? `Send ${def.source === 'mana' ? 'mana' : 'power'} from this ${def.name} to another structure in range. ${s.links.length}/${def.maxLinks} links used.` : 'Draw power (or mana) into this structure from a generator or relay in range.', hk: 'A' }),
        action: () => c.setMode({ kind: 'link', op: 'connect', from: s }),
      };
      const n = s.links.length + s.inLinks.length;
      out[4] = {
        icon: this.assets.icon('disconnect'), square: true, label: 'Disconnect', disabled: n === 0,
        active: mode.kind === 'link' && mode.op === 'disconnect',
        tip: () => ({ title: 'Disconnect', body: `Remove a power or mana link. ${n === 1 ? 'Removes its only link.' : 'Click a linked structure.'}`, hk: 'S' }),
        action: () => {
          if (n === 1) { g.unlink(s.links[0] ?? s.inLinks[0]); return; }
          c.setMode({ kind: 'link', op: 'disconnect', from: s });
        },
      };
    }
    const value = g.sellValue(s);
    out[5] = {
      icon: this.assets.icon('sell'), square: true, label: `Delete · ${fmt(value)}`,
      tip: () => ({ title: 'Delete', body: `Sell for <b style="color:#ffd24a">${value} gold</b> (${value === totalCost(def, s.level) ? 'full refund between waves' : '75% during a wave'}).`, hk: 'D' }),
      action: () => { g.sell(s); c.select(null); },
    };
    return out;
  }

  // ---------------------------------------------------------------- tooltips
  private showTip(t: Tip, pos: 'card' | 'top' = 'card') {
    const coin = this.assets.ui('hud_gold') ?? '';
    const cost = t.cost !== undefined ? `<span class="cost">${typeof t.cost === 'number' ? `<img src="${coin}">${fmt(t.cost)}` : t.cost}</span>` : '';
    this.tipEl.innerHTML = `<h3><span>${t.title}</span>${cost}</h3>${t.hk ? `<span class="hkey">[${t.hk}]</span>` : ''}<div>${t.body}</div>`;
    this.tipEl.classList.add('show');
    if (pos === 'top') { this.tipEl.style.top = '120px'; this.tipEl.style.bottom = 'auto'; this.tipEl.style.right = 'auto'; this.tipEl.style.left = '50%'; this.tipEl.style.transform = 'translateX(-50%)'; }
    else { this.tipEl.style.top = 'auto'; this.tipEl.style.bottom = `${(this.refs.card?.offsetHeight ?? 240) + 22}px`; this.tipEl.style.left = 'auto'; this.tipEl.style.right = '10px'; this.tipEl.style.transform = 'none'; }
  }
  private hideTip() { this.tipEl?.classList.remove('show'); }

  private statRows(def: StructureDef, L: number) {
    const rows: [string, string][] = [];
    const a = def.attack;
    const m = M(L);
    if (a) {
      if (a.damage) rows.push(['Damage', `${fmt(a.damage * m)}${a.splash ? ' (splash)' : ''}`]);
      rows.push(['Attack', a.poweredCooldown ? `${a.cooldown}s (${a.poweredCooldown}s powered)` : `${a.cooldown}s`]);
      rows.push(['Range', `${a.range}`]);
      if (a.consumption) rows.push(['Consumption', `<span class="pw">${fmt(a.consumption * m)} W</span> while firing`]);
    }
    if (def.id === 'clock_tower') rows.push(['Haste', `+${20 + 5 * (L - 1)}% attack speed`], ['Consumption', `<span class="pw">${fmt(12 * m)} W</span>`]);
    if (def.energy?.production) rows.push(['Generation', `<span class="pw">${fmt(def.energy.production * m)} W</span>`]);
    if (def.mana?.production) rows.push(['Mana', `<span class="mn">${(def.mana.production * m).toFixed(1)}/s</span>`]);
    const g = this.game;
    const grow = (spec: { relayGrowth?: number }) => (spec.relayGrowth ? Math.pow(spec.relayGrowth, L - 1) : m);
    if (def.energy) rows.push(['Capacity', `${fmt(def.energy.cap * grow(def.energy))} J`], ['Transfer', `${fmt(def.energy.transfer * grow(def.energy) * (g.researched.has('superconductors') ? 1.5 : 1))} W`]);
    if (def.mana && def.id !== 'hero_tower') rows.push(['Mana cap', `${fmt(def.mana.cap * grow(def.mana))}`]);
    if (def.source) rows.push(['Links', `${def.maxLinks} · range ${def.linkRange}`]);
    return rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  }

  private buildTip(def: StructureDef): Tip {
    const g = this.game;
    const req = def.requires && !g.researched.has(def.requires) ? `<p class="req">Requires ${RESEARCH[def.requires].name}</p>` : '';
    const uniq = def.unique && g.structures.some((s) => s.def.id === def.id) ? '<p class="req">Only one allowed</p>' : '';
    return {
      title: def.name, cost: def.cost,
      body: `<p>${def.desc}</p>${def.powered ? `<p class="pw">${def.powered}</p>` : ''}${def.spell ? `<p class="mn">Mana: +35% damage when fed mana; casts ${SPELLS[def.spell].name} with Spellweaving.</p>` : ''}<div class="stats">${this.statRows(def, 1)}</div>${req}${uniq}`,
    };
  }

  private upgradeTip(s: Structure): Tip {
    const g = this.game;
    if (s.level >= s.def.maxLevel) return { title: `${s.def.name} · Level ${s.level}`, body: 'Fully upgraded.' };
    const can = g.canUpgrade(s);
    const lock = !can.ok && can.reason !== 'Not enough gold' ? `<p class="req">${can.reason}</p>` : '';
    return { title: `Upgrade to Level ${s.level + 1}`, cost: g.upgradeCost(s), body: `<p>Doubles investment, roughly triples output — denser power for the same space.</p><div class="stats">${this.statRows(s.def, s.level + 1)}</div>${lock}`, hk: 'Q' };
  }

  private structureTip(s: Structure): Tip {
    const g = this.game;
    const rows: string[] = [];
    const add = (k: string, v: string) => rows.push(`<span>${k}</span><b>${v}</b>`);
    if (s.def.energy) add('Power in / out', `${s.flowIn.toFixed(1)} / ${s.flowOut.toFixed(1)} W`);
    if (s.def.energy?.production || s.def.mana?.production) add('Producing', `${s.producing.toFixed(1)}/s`);
    if (s.def.id === 'furnace' && s.grassCells) add('Fuel (grass)', `${Math.round((s.grassCells.reduce((a, c) => a + g.grid.grass[c], 0) / s.grassCells.length) * 100)}%`);
    if (g.acceptsMana(s) && !s.def.source) add('Mana in', `${s.manaIn.toFixed(1)}/s`);
    if (s.def.attack) { add('Range', g.range(s).toFixed(1)); add('Damage dealt', fmt(s.damage)); add('Kills', String(s.kills)); }
    add('Links', `${s.links.length} out · ${s.inLinks.length} in`);
    add('Value', `${totalCost(s.def, s.level)} gold`);
    return { title: `${s.def.name}${s.def.maxLevel > 1 ? ` · Level ${s.level}` : ''}`, body: `<p>${s.def.desc}</p><div class="stats">${rows.join('')}</div>` };
  }

  private envTip(): Tip {
    const env = this.game.env;
    const w = WEATHER[env.weather];
    return {
      title: `${w.name} · ${env.isNight ? 'Night' : 'Day'} (${env.clock})`,
      body: `<p>${w.desc}</p><p>Solar output now: <b>${Math.round(env.solarMult * 100)}%</b>. ${env.isNight ? 'Mana Wells and Graveyards produce <b>+50%</b> at night.' : 'Solar Arrays work by day; bank power in Capacitors for the night.'}</p><p>Next: <b>${WEATHER[env.next].name}</b> in ${Math.ceil(env.weatherT)}s.</p>`,
    };
  }

  private gridTip(): Tip {
    return { title: 'Grid', body: '<p><span class="pw">Power</span>: total generation vs. what your towers are pulling right now.</p><p><span class="mn">Mana</span>: generation vs. what spell towers are drawing.</p><p>⤳ Maze length: how far runners must walk through all checkpoints. Longer is better.</p>' };
  }

  private waveTip(): Tip {
    const g = this.game;
    const r = g.round + 1;
    const early = isFinite(g.buildTimer) && g.round > 0 ? `<p>Sending early earns <b style="color:#ffd24a">${Math.floor(g.buildTimer) * 2} gold</b>.</p>` : '';
    const wave = buildWave(r, () => 0.37);
    const hp = roundBaseHp(r, g.difficulty);
    const rows = wave.groups.map((gr) => {
      const t = RUNNERS[gr.type];
      return `<span>${gr.count}× ${t.name}</span><b>${fmt(hp * t.hp)} hp · ${t.speed.toFixed(1)} spd</b>`;
    }).join('');
    const notes = [...new Set(wave.groups.map((gr) => RUNNERS[gr.type]).filter((t) => t.drain || t.saboteur || t.leech || t.shield || t.regen || t.boss).map((t) => `<p style="color:#ffb08a">${t.name}: ${t.desc}</p>`))].join('');
    return { title: `Round ${r}${wave.name ? ` · ${wave.name}` : ''}`, body: `<div class="stats">${rows}</div>${notes}${early}<p style="color:#a9a293">${r > MAX_ROUND ? 'Endless mode.' : `${MAX_ROUND - r + 1} rounds to victory.`} Hotkey: Space</p>` };
  }

  // ---------------------------------------------------------------- messages / floating text
  message(text: string, kind = 'info') {
    if (!this.msgs) return;
    const m = el('div', `msg ${kind}`, text);
    this.msgs.append(m);
    while (this.msgs.children.length > 4) this.msgs.firstElementChild!.remove();
    setTimeout(() => { m.style.opacity = '0'; }, kind === 'round' ? 2600 : 2800);
    setTimeout(() => m.remove(), kind === 'round' ? 3300 : 3500);
  }

  floatText(x: number, y: number, z: number, text: string, color: string, big = false) {
    if (!this.gameUi) return;
    let f = this.floatPool.find((p) => p.t < 0);
    if (!f) {
      if (this.floatPool.length > 80) return;
      f = { el: el('div', 'ftext'), x, y, z, t: -1, big };
      this.gameUi.append(f.el);
      this.floatPool.push(f);
    }
    Object.assign(f, { x, y, z, t: 0, big });
    f.el.textContent = text;
    f.el.style.color = color;
    f.el.className = 'ftext' + (big ? ' big' : '');
    f.el.style.display = '';
  }

  private updateFloats(dt: number) {
    for (const f of this.floatPool) {
      if (f.t < 0) continue;
      f.t += dt;
      const life = 1.2;
      if (f.t > life) { f.t = -1; f.el.style.display = 'none'; continue; }
      const p = this.app.project(f.x, f.y + f.t * 0.9, f.z);
      if (!p.visible) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(f.t < 0.8 ? 1 : 1 - (f.t - 0.8) / 0.4);
    }
  }

  // ---------------------------------------------------------------- modals
  private clearModal() {
    this.modal?.remove();
    this.modal = null;
    this.researchOpen = false;
    this.menuOpen = false;
  }

  private openModal(content: HTMLElement, onClose?: () => void) {
    this.clearModal();
    const bg = el('div', 'modal-bg');
    bg.onclick = (e) => { if (e.target === bg) { this.clearModal(); onClose?.(); } };
    bg.append(content);
    this.root.append(bg);
    this.modal = bg;
  }

  toggleResearch() {
    if (this.researchOpen) { this.clearModal(); return; }
    this.openResearch();
  }

  private openResearch() {
    const g = this.game;
    const box = el('div', 'modal frame tech');
    box.append(el('h2', '', 'Research'));
    const tiers = el('div', 'tiers');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('links');
    tiers.append(svg);
    const labels = ['Tier I', 'Tier II', 'Tier III', 'Tier IV'];
    for (let t = 1; t <= 4; t++) {
      const lab = el('div', 'tier-label', labels[t - 1]);
      lab.style.gridRow = String(t); lab.style.gridColumn = '1';
      tiers.append(lab);
    }
    const detail = el('div', 'detail', 'Hover a technology for details. Mana (Arcane Studies) unlocks once you know two Tier I sciences.');
    for (const r of RESEARCH_ORDER) {
      const n = el('div', 'node');
      n.dataset.id = r.id;
      n.style.gridRow = String(r.tier);
      n.style.gridColumn = String(r.col + 2);
      const coin = this.assets.ui('hud_gold') ?? '';
      n.innerHTML = `<img src="${this.assets.icon(r.icon) ?? ''}"><div class="nn">${r.name}</div><div class="nc"><img src="${coin}">${r.cost} · ${r.time}s</div><div class="prog"></div>${['arcane', 'necromancy', 'chronomancy', 'spellweaving', 'divinity', 'heroism', 'leymastery'].includes(r.id) ? '<span class="mana-tag">✦ arcane</span>' : ''}`;
      n.onclick = () => {
        const st = g.researchState(r.id);
        if (st === 'available') { if (g.researching) this.message('Already researching', 'warn'); else if (!g.startResearch(r.id)) this.message('Not enough gold', 'warn'); }
        else if (st === 'active') { g.cancelResearch(); this.message('Research cancelled (refunded)'); }
        this.refreshResearch();
      };
      n.onmouseenter = () => {
        const reqs = r.requires.map((q) => RESEARCH[q].name);
        if (r.requiresCount) reqs.push(`${r.requiresCount} researches from lower tiers`);
        const unlocks = r.unlocks?.map((u) => STRUCTURES[u].name).join(', ');
        detail.innerHTML = `<b>${r.name}</b> — ${r.desc}${unlocks ? `<br>Unlocks: <b>${unlocks}</b>` : ''}${reqs.length ? `<br><span style="color:#a9a293">Requires: ${reqs.join(', ')}</span>` : ''}`;
      };
      tiers.append(n);
    }
    box.append(tiers, detail);
    const close = el('button', 'mbtn frame', 'Close');
    close.style.margin = '14px auto 0'; close.style.display = 'block';
    close.onclick = () => this.clearModal();
    box.append(close);
    this.openModal(box);
    this.researchOpen = true;
    this.refreshResearch();
    requestAnimationFrame(() => this.drawTechLinks(tiers, svg));
  }

  private drawTechLinks(tiers: HTMLElement, svg: SVGSVGElement) {
    const base = tiers.getBoundingClientRect();
    svg.setAttribute('width', String(base.width)); svg.setAttribute('height', String(base.height));
    svg.innerHTML = '';
    for (const r of RESEARCH_ORDER) {
      const to = tiers.querySelector(`[data-id="${r.id}"]`)?.getBoundingClientRect();
      if (!to) continue;
      for (const q of r.requires) {
        const from = tiers.querySelector(`[data-id="${q}"]`)?.getBoundingClientRect();
        if (!from) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x1 = from.left + from.width / 2 - base.left, y1 = from.bottom - base.top;
        const x2 = to.left + to.width / 2 - base.left, y2 = to.top - base.top;
        const my = (y1 + y2) / 2;
        line.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
        line.setAttribute('stroke', this.game.researched.has(q) ? '#5ac86a' : '#7a5a22');
        line.setAttribute('stroke-width', '3'); line.setAttribute('fill', 'none'); line.setAttribute('opacity', '0.8');
        svg.append(line);
      }
    }
  }

  private refreshResearch() {
    const g = this.game;
    this.modal?.querySelectorAll('.node').forEach((n) => {
      const id = (n as HTMLElement).dataset.id as ResearchId;
      const st = g.researchState(id);
      const r = RESEARCH[id];
      n.className = `node ${st}${st === 'available' && g.gold < r.cost ? ' poor' : ''}`;
      const prog = n.querySelector('.prog') as HTMLElement;
      prog.style.width = st === 'active' && g.researching ? `${(1 - g.researching.remaining / r.time) * 100}%` : st === 'done' ? '100%' : '0';
    });
  }

  private resumePaused = false;
  openMenu() {
    if (this.menuOpen) { this.clearModal(); this.game.paused = this.resumePaused; return; }
    if (this.modal) { this.clearModal(); return; } // Esc closes research / help first
    const box = el('div', 'modal frame');
    box.append(el('h2', '', 'Menu'));
    const btns = el('div', 'mbtns');
    const mk = (label: string, fn: () => void, primary = false) => { const b = el('button', 'mbtn frame' + (primary ? ' primary' : ''), label); b.onclick = fn; btns.append(b); };
    const wasPaused = this.game.paused;
    this.resumePaused = wasPaused;
    this.game.paused = true;
    const resume = () => { this.clearModal(); this.game.paused = wasPaused; };
    mk('Resume', resume, true);
    mk('Settings', () => this.openSettings());
    mk('How to Play', () => this.openHelp());
    mk('Restart', () => { this.clearModal(); this.app.restart(); });
    mk('Quit to Title', () => { this.clearModal(); this.app.toTitle(); });
    box.append(btns);
    this.openModal(box, () => { this.game.paused = wasPaused; });
    this.menuOpen = true;
  }

  private openSettings() {
    const s = this.app.settings;
    const box = el('div', 'modal frame');
    box.append(el('h2', '', 'Settings'));
    const grid = el('div', 'settings');
    const row = (label: string, input: HTMLElement) => { grid.append(el('span', '', label), input); };
    const check = (key: 'shadows' | 'bloom' | 'edgeScroll' | 'autoLink' | 'showPath' | 'foliage' | 'arcShadows' | 'manyLights' | 'ao' | 'tiltShift' | 'atmosphere') => {
      const i = el('input') as HTMLInputElement;
      i.type = 'checkbox'; i.checked = s[key];
      i.onchange = () => { s[key] = i.checked; this.app.applySettings(); };
      return i;
    };
    const range = (key: 'resolution' | 'volume', min: number, max: number, step: number) => {
      const i = el('input') as HTMLInputElement;
      i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(s[key]);
      i.onchange = () => { s[key] = Number(i.value); this.app.applySettings(); };
      return i;
    };
    row('Shadows', check('shadows'));
    row('Bloom', check('bloom'));
    row('Ambient occlusion', check('ao'));
    row('Grass & flowers', check('foliage'));
    row('Tilt-shift focus', check('tiltShift'));
    row('Clouds, mist, fireflies & birds', check('atmosphere'));
    row('Power-arc shadows', check('arcShadows'));
    row('Many dynamic lights (next game)', check('manyLights'));
    row('Resolution scale', range('resolution', 0.5, 2, 0.25));
    row('Volume', range('volume', 0, 1, 0.05));
    row('Edge scrolling', check('edgeScroll'));
    row('Auto-link new structures', check('autoLink'));
    box.append(grid);
    const back = el('button', 'mbtn frame', 'Back');
    back.onclick = () => { this.clearModal(); this.openMenu(); };
    box.append(back);
    this.openModal(box);
    this.menuOpen = true;
  }

  openHelp() {
    const box = el('div', 'modal frame help');
    box.append(el('h2', '', 'How to Play'));
    box.insertAdjacentHTML('beforeend', `
      <p>Runners pour out of the portal and must touch every checkpoint <b>1 → 5</b> in order before reaching your castle. You can't block them, but you <b>can</b> make the walk as long as possible.</p>
      <h3>Maze</h3>
      <p>Drag to build lines of <b>walls</b>. Everything you build blocks the path, and any placement that would seal it off is refused. The dashed line shows the route; watch it update as you place.</p>
      <h3>Power</h3>
      <p>Towers barely work without power. <b>Generators</b> (Furnace, Water Wheel, Solar) fill up with energy and push it along <b>links</b>, up to each structure's transfer rate. <b>Pylons</b> relay power and double as walls. Balance generation against what your towers draw: an unpowered Tesla Coil is a lawn ornament.</p>
      <p>Furnaces burn nearby grass (it regrows). Water Wheels need the shoreline. Solar only works by day, so store it in Capacitors.</p>
      <h3>Mana</h3>
      <p>Research <b>Arcane Studies</b> to discover mana, a second network. Mana Wells (stronger near ley crystals and at night) and Graveyards (souls of the dead) feed spell-capable towers. Mana makes them hit 35% harder, and <b>Spellweaving</b> lets them cast devastating spells.</p>
      <h3>Weather &amp; time</h3>
      <p>Rain helps water wheels and hurts furnaces. Storms throw lightning that charges your coils. Fog shortens range. Night shuts off solar and empowers mana.</p>
      <h3>Controls</h3>
      <p><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd> / <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> command card · <kbd>1</kbd>-<kbd>4</kbd> build tabs · <kbd>R</kbd> research · <kbd>Space</kbd> send wave · <kbd>P</kbd> pause · <kbd>[</kbd> <kbd>]</kbd> speed · <kbd>Del</kbd> sell · <kbd>Esc</kbd> cancel<br>
      Arrow keys, screen edges or middle-drag to pan · wheel to zoom · right-click cancels · hold <kbd>Alt</kbd> to see the route during a wave.</p>`);
    const back = el('button', 'mbtn frame', 'Close');
    back.style.marginTop = '14px';
    back.onclick = () => this.clearModal();
    box.append(back);
    this.openModal(box);
  }

  private showEnd() {
    this.endShown = true;
    const g = this.game;
    const won = g.outcome === 'won';
    const box = el('div', 'modal frame end');
    box.append(el('h2', '', won ? 'Victory!' : 'The castle has fallen'));
    const best = Object.entries(g.stats.damageBy).sort((a, b) => b[1] - a[1])[0];
    const stats = el('div', 'stats-grid', `
      <span>Rounds survived</span><b>${won ? g.round : Math.max(0, g.round - 1)}</b>
      <span>Runners slain</span><b>${g.stats.kills}</b>
      <span>Leaked</span><b>${g.stats.leaks}</b>
      <span>Structures built</span><b>${g.stats.built}</b>
      <span>Spells cast</span><b>${g.stats.spellsCast}</b>
      <span>Overheats</span><b>${g.stats.overheats}</b>
      <span>Top damage</span><b>${best ? `${STRUCTURES[best[0] as StructureId].name} (${fmt(best[1])})` : '—'}</b>
      <span>Difficulty</span><b>${DIFFICULTIES[g.difficulty].name}</b>`);
    box.append(stats);
    const btns = el('div', 'mbtns');
    if (won) {
      const cont = el('button', 'mbtn frame primary', 'Continue (Endless)');
      cont.onclick = () => { this.clearModal(); g.continueEndless(); this.endShown = false; };
      btns.append(cont);
    }
    const again = el('button', 'mbtn frame' + (won ? '' : ' primary'), 'Play Again');
    again.onclick = () => { this.clearModal(); this.app.restart(); };
    const title = el('button', 'mbtn frame', 'Title Screen');
    title.onclick = () => { this.clearModal(); this.app.toTitle(); };
    btns.append(again, title);
    box.append(btns);
    this.openModal(box);
  }

  get blocking() { return !!this.modal; }
}

export { RUNNERS, levelCost };
