# Power Towers

A three.js remake of **Power Towers TD** (Strilanc, WC3, v1.31). Single-player. You build a maze out of walls to stretch the runners' path through five checkpoints. You keep your towers powered through a network of generators and relays. From the middle of the tech tree on, you also manage a second resource: mana.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static build in dist/
```

## The rules

- Runners leave the portal and must touch checkpoints **1 → 5** in order before they reach the castle gate. Each leak costs lives (a boss costs 5). Leaks are forgiven in round 1.
- **Maze:** every structure blocks the path. Walls are 1×1 and cost 10 gold; drag to build a line. The game refuses any placement that would seal a leg or trap a runner. A dashed route preview updates live while you place.
- **Power** (from the original): generators fill up with energy and push it along links, up to each structure's transfer rate and capacity, 4 times a second. Towers spend energy per attack for their *powered* effect, such as chain lightning, frost nova or burning bolts.
  - **Furnace**: burns nearby grass. The grass scorches, then regrows.
  - **Water Wheel**: must straddle the shoreline.
  - **Solar Array**: day only, weakened by clouds and rain.
  - **Pylon**: a 1×1 relay that also works as a wall.
  - **Capacitor**: storage.
- **Mana** (new; unlocked by *Arcane Studies*, about a third of the way into the tech tree): a second, separate network.
  - **Mana Well**: doubled near ley crystals, +50% at night.
  - **Graveyard**: harvests the souls of runners that die nearby.
  - **Ley Obelisk**: mana relay.
  - Mana-capable towers deal +35% damage while fed. After *Spellweaving* they autocast spells: Thunderstorm, Blizzard, Meteor, Plague Cloud, Curse of Doom, Consecrate, Whirlpool and Overgrowth. The Archmage hero levels up to 6.
- **Overcharge** (new; unlocked by *Capacitors*): +50% damage and +30% attack speed, at 2.2× power draw. It builds heat, and at 100% the tower shuts down for 6 seconds.
- **Weather and day/night** (new): a 5-minute day cycle.
  - Rain: Water Wheels +50%, Furnaces −50%, grass regrows faster.
  - Storms: lightning charges your coils, pylons and capacitors, and sometimes strikes runners.
  - Fog: −15% range.
  - Night: no solar; mana +50%.
- **Power-hunting runners** (new, building on the original's feedback rounds):
  - **Wraiths**: drain energy from any tower that hits them.
  - **Goblin Sappers**: throw EMP charges that knock generators and relays offline.
  - **Power Leeches**: siphon energy from links they walk under.
  - **Ogre Brutes**: carry regenerating shields.
  - **Warlords**: bosses that rally nearby runners.
- The stat-scaling rule comes from the original: almost every stat scales with `2^L − 1`, and upgrading to level L costs `base × 2^(L−1)`. Damage per gold stays flat, so upgrades are about packing more power into limited maze space. Relays (Pylon, Obelisk) grow ×3 per level. Walls sell for full value between waves, 75% during one.
- Difficulties: Squire, Knight, Warlord (the original Rookie curve) and Doom (original Hotshot, cubic). 30 rounds, then Endless.

## Visuals

- **Terrain:** there are nine full PBR layers: meadow, forest floor, trampled grass, dirt, mud, rock, sand, scorch and cobble. Each has albedo, normal, roughness and height maps from diffui. The layers are packed into two texture arrays and blended by height, with parallax. Heights come from the gameplay grid, varied ±25% with noise, and the ponds have noise-blurred organic shorelines.
- **Battle damage** (`render/damage.ts`): a 4-texels-per-cell map that records footsteps, craters, scorch and temperature. Routes wear from forest floor to trampled grass, then dirt, then churned mud. Explosions dent the terrain. Fire leaves smouldering embers, and frost novas and blizzards rime the ground. Everything slowly heals.
- **Foliage** (`render/foliage.ts`): GPU-instanced 3D grass blades, leaf, twig, pebble and clover litter, plus flowers, mushrooms and ferns. All of it sways in the wind and reads the height and damage maps, so it flattens, burns and disappears under buildings.
- **Lighting** (`render/lights.ts`): power arcs, bolts, projectiles, impacts, spells, braziers and crystals share a pool of dynamic point lights. One of them casts cube shadows and follows the brightest arc or storm strike. The environment map is regenerated from the sky, and the water is a lit, reflective PBR surface. Other touches: GTAO ambient occlusion, cloud shadows, lakebed caustics, and bloom that brightens at night.
- **Atmosphere** (`render/atmosphere.ts`):
  - A cloud deck drifts in as you zoom out and parts around the middle of the screen. It uses the same noise as the terrain's cloud shadows, shifted along the sun, so each cloud sits over its own shadow.
  - Low mist pools in hollows and over ponds at dawn and at night. In fog weather it becomes deep drifting banks, and the plateaus rise out of them.
  - Fireflies come out at night, and pollen glints in the sun by day.
  - Now and then a flock of birds crosses below the clouds.
  - A tilt-shift focus band, faint film grain and a warm/cool split tone are folded into the final grade pass, so they cost no extra full-screen passes.
- **Settings:** ambient occlusion, foliage, tilt-shift, the atmosphere layer, arc shadows and the dynamic-light count can each be toggled in Menu → Settings for weaker GPUs.

## Controls

`Q W E / A S D` command card (WC3 grid) · `1–4` build tabs · `R` research · `Space` send the wave (sending early pays gold) · `P` pause · `[` `]` speed · `Del` sell · `Esc` cancel/menu · arrow keys, screen edges or middle-drag to pan · mouse wheel to zoom · hold `Alt` to show the route during a wave. Right-click a spell button to toggle autocast; left-click casts now. Click a runner to inspect it.

## Code layout

```
src/game/            pure simulation, no three.js (it also runs headless)
  sim.ts             Game: placement, links, power tick, runners, waves, research, economy
  combat.ts          tower behaviours, overcharge, mana infusion, spells
  grid.ts / map.ts   grid, Dijkstra distance field per leg, the map layout
  env.ts             day/night + weather
  data/              structures, research tree, runners/waves/difficulty
src/render/          three.js views (terrain splat shader, water, props, instanced walls,
                     skinned runners, lightning ribbons, particles, overlays, post-processing)
src/input/           mouse/keyboard controller, camera
src/ui/              DOM HUD in the diffui mockup style (top bar, command card, research, menus)
tools/assets/        asset pipeline (diffui concept art → Meshy image-to-3D → rig → gltf-transform)
tools/balance.ts     headless bot that plays the real sim for balance checks
```

## Assets

Every model was generated for this project:

1. **diffui** paints a transparent concept image in the mockup's style.
2. **Meshy** image-to-3D turns it into a textured PBR GLB. Humanoid runners are then auto-rigged, with walk, run and death clips.
3. **gltf-transform** compresses it (meshopt + WebP) into `public/assets/models`.

Terrain textures, including their normal and roughness maps, and all icons also come from diffui. The pipeline is resumable and keeps track of paid steps in `tools/assets/state.json`:

```bash
node tools/assets/pipeline.mjs status
node tools/assets/pipeline.mjs concepts <id>   # diffui concept (needs DIFFUI_TOKEN in .env.local)
node tools/assets/pipeline.mjs models <id>     # Meshy image-to-3D (reads MESHY_API_KEY via MESHY_ENV_FILE)
node tools/assets/pipeline.mjs rig <id>        # Meshy rigging + animations for runners
node tools/assets/pipeline.mjs optimize <id>   # → public/assets/models + manifest.json
```

Missing models fall back to procedural placeholders, so the game always runs.

## Balance checks

```bash
npx tsx tools/balance.ts normal 30 1   # difficulty, rounds, seed
```

The bot is deliberately mediocre. It builds a greedy maze and places towers along the route, buying each one together with the generators it needs. Use it to spot difficulty spikes, not to measure absolute difficulty.

## Debugging

`window.__pt` exposes the session. `__pt.advance(seconds)` steps the frame logic manually, and in dev `await __pt.shot('name')` saves a canvas JPEG to `tools/assets/raw/shots/`. `__pt.world.debugCam = { eye, look, fov }` pins the camera for close-ups. Add `?mute` to the URL to silence all audio without changing the saved volume, e.g. `/?autostart=normal&mute`.
