// First-game guide: five short steps (walls, a tower, power, links, send the wave). Never
// blocks play; each step completes itself when the player does the thing, highlights the
// relevant button, and can be skipped. Shown once (localStorage flag).

import type { Game } from '../game/sim';
import type { Controller } from '../input/controller';

export const TUTORIAL_KEY = 'powertowers.tutorial';

export function tutorialSeen() {
  try { return localStorage.getItem(TUTORIAL_KEY) === 'done'; } catch { return true; }
}

interface Step {
  text: string | (() => string);
  target?: () => HTMLElement | null;
  done: () => boolean;
  /** Seconds to linger before advancing once done (for steps that are pure information). */
  hold?: number;
}

export class Tutorial {
  private el: HTMLElement;
  private body: HTMLElement;
  private step = 0;
  private holdT = -1;
  private lit: HTMLElement | null = null;
  finished = false;

  constructor(parent: HTMLElement, private game: Game, private ctrl: Controller, private refs: Record<string, HTMLElement>, private sound: (n: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'tutorial frame interactive';
    this.el.innerHTML = '<div class="tut-head"><span class="tut-count"></span><button class="tut-skip">Skip tutorial</button></div><div class="tut-body"></div>';
    this.body = this.el.querySelector('.tut-body')!;
    (this.el.querySelector('.tut-skip') as HTMLButtonElement).onclick = () => this.finish();
    parent.append(this.el);
  }

  private cell(sid: string) { return this.refs.grid.querySelector<HTMLElement>(`.cbtn[data-sid="${sid}"]`); }
  private tab(name: string) { return [...this.refs.tabs.querySelectorAll<HTMLElement>('.tab')].find((t) => t.textContent === name) ?? null; }
  private onTab(id: string) { return this.ctrl.tab === id; }
  private count(fn: (id: string) => boolean) { return this.game.structures.filter((s) => fn(s.def.id)).length; }

  private steps: Step[] = [
    {
      text: 'Runners march from the portal through checkpoints <b>1 → 5</b> to your castle. Everything you build blocks their path, so <b>stretch it with walls</b>: pick <b>Wall</b> and drag a line.',
      target: () => (this.onTab('maze') ? this.cell('wall') : this.tab('Maze & Power')),
      done: () => this.count((id) => id === 'wall') >= 6,
    },
    {
      text: 'Walls don\'t fight. Open <b>Towers</b> and place a <b>Ballista</b> beside the route, where runners will pass within range.',
      target: () => (this.onTab('towers1') ? this.cell('ballista') : this.tab('Towers')),
      done: () => this.game.structures.some((s) => !!s.def.attack),
    },
    {
      text: 'Towers barely work without power. Back in <b>Maze & Power</b>, build a <b>Furnace</b> near your tower. It burns the grass around it for energy.',
      target: () => (this.onTab('maze') ? this.cell('furnace') : this.tab('Maze & Power')),
      done: () => this.game.structures.some((s) => s.def.source === 'energy'),
    },
    {
      text: () => this.game.links.length
        ? 'The furnace <b>linked itself</b> to your tower: that arc is energy flowing. To add links yourself, select a building and use <b>Connect</b>.'
        : 'Now <b>link</b> them: select the Furnace, press <b>Connect</b>, then click your tower.',
      target: () => (this.ctrl.selected?.def.source ? this.cell('connect') : null),
      done: () => this.game.links.some((l) => !!l.to.def.attack),
      hold: 5,
    },
    {
      text: 'Ready? Press <b>Begin round 1</b> (or <kbd>Space</kbd>). Between waves, sending early pays bonus gold.',
      target: () => this.refs.send,
      done: () => this.game.phase === 'wave',
    },
    {
      text: 'That\'s the game: stretch the maze between waves, keep generators ahead of your towers\' draw, and open <b>Research</b> for more buildings, upgrades and, later, mana.',
      done: () => true,
      hold: 9,
    },
  ];

  update(dt: number) {
    if (this.finished) return;
    const s = this.steps[this.step];
    this.body.innerHTML = typeof s.text === 'function' ? s.text() : s.text;
    (this.el.querySelector('.tut-count') as HTMLElement).textContent = `${Math.min(this.step + 1, this.steps.length)} / ${this.steps.length}`;
    const t = s.target?.() ?? null;
    if (t !== this.lit) { this.lit?.classList.remove('tut-target'); this.lit = t; }
    if (t && !t.classList.contains('tut-target')) t.classList.add('tut-target');
    if (s.done()) {
      if (this.holdT < 0) this.holdT = s.hold ?? 0.6;
      this.holdT -= dt;
      if (this.holdT <= 0) {
        this.holdT = -1;
        this.step++;
        if (this.step >= this.steps.length) this.finish();
        else this.sound('complete');
      }
    }
  }

  finish() {
    this.finished = true;
    this.lit?.classList.remove('tut-target');
    this.el.remove();
    try { localStorage.setItem(TUTORIAL_KEY, 'done'); } catch { /* ignore */ }
  }
}
