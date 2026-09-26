// Day/night cycle and weather. Both feed multipliers into the power economy.

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export const WEATHER: Record<Weather, {
  name: string; sun: number; water: number; furnace: number; regrow: number; range: number; mana: number; desc: string;
}> = {
  clear: { name: 'Clear', sun: 1, water: 1, furnace: 1, regrow: 1, range: 1, mana: 1, desc: 'Full sunlight.' },
  cloudy: { name: 'Overcast', sun: 0.5, water: 1, furnace: 1, regrow: 1, range: 1, mana: 1, desc: 'Solar output halved.' },
  rain: { name: 'Rain', sun: 0.25, water: 1.5, furnace: 0.5, regrow: 3, range: 1, mana: 1, desc: 'Water wheels +50%, furnaces -50%, grass regrows 3x, solar -75%.' },
  storm: { name: 'Thunderstorm', sun: 0.1, water: 2, furnace: 0.5, regrow: 3, range: 1, mana: 1.1, desc: 'Water wheels x2. Lightning strikes charge coils, pylons and capacitors, and sometimes runners.' },
  fog: { name: 'Fog', sun: 0.6, water: 1, furnace: 0.9, regrow: 1.5, range: 0.85, mana: 1.25, desc: 'Tower range -15%, mana +25%.' },
};

const NEXT: Record<Weather, [Weather, number][]> = {
  clear: [['clear', 2], ['cloudy', 3], ['fog', 1]],
  cloudy: [['clear', 2], ['rain', 3], ['fog', 1], ['cloudy', 1]],
  rain: [['cloudy', 2], ['storm', 2], ['rain', 1]],
  storm: [['rain', 3], ['cloudy', 1]],
  fog: [['clear', 2], ['cloudy', 2]],
};

export const DAY_LENGTH = 300; // seconds of game time for a full day/night cycle

export class Environment {
  time = 0.08;          // 0..1 fraction of day; 0 = dawn
  weather: Weather = 'clear';
  next: Weather = 'cloudy';
  weatherT = 110;       // seconds until next weather
  weatherBlend = 1;     // 0..1 crossfade into current weather (visual)
  prevWeather: Weather = 'clear';
  strikeT = 8;
  constructor(private rng: () => number) {}

  /** 0 at night, 1 in full day, smooth at dawn/dusk. */
  get sunlight() {
    const t = this.time;
    // dawn 0-0.06, day 0.06-0.52, dusk 0.52-0.6, night 0.6-0.95, pre-dawn 0.95-1
    if (t < 0.06) return smooth(t / 0.06) * 0.8 + 0.2 * smooth(t / 0.06);
    if (t < 0.52) return 1;
    if (t < 0.6) return 1 - smooth((t - 0.52) / 0.08);
    if (t < 0.95) return 0;
    return smooth((t - 0.95) / 0.05) * 0.2;
  }
  get isNight() { return this.sunlight < 0.25; }
  get w() { return WEATHER[this.weather]; }
  get solarMult() { return this.sunlight * this.w.sun; }
  get manaMult() { return this.w.mana; }
  get nightMana() { return this.isNight ? 1.5 : 1; }

  /** Returns true when the weather changed. */
  step(dt: number): boolean {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    this.weatherBlend = Math.min(1, this.weatherBlend + dt / 6);
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.prevWeather = this.weather;
      this.weather = this.next;
      this.next = this.pick(this.weather);
      this.weatherT = 70 + this.rng() * 80;
      this.weatherBlend = 0;
      return true;
    }
    return false;
  }

  private pick(from: Weather): Weather {
    const opts = NEXT[from];
    const total = opts.reduce((a, [, w]) => a + w, 0);
    let r = this.rng() * total;
    for (const [w, p] of opts) { if ((r -= p) <= 0) return w; }
    return opts[0][0];
  }

  get clock() {
    // 06:00 at dawn
    const hours = (this.time * 24 + 5) % 24;
    const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function smooth(x: number) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
