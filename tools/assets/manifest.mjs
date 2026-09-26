// Asset manifest for Power Towers.
// Every 3D model starts life as a diffui concept image (transparent, 3/4 view),
// which is then lifted to a textured GLB by Meshy image-to-3D. Runners are
// additionally rigged + animated by Meshy.

const STYLE =
  'Stylized hand-painted high-fantasy RTS game asset in the style of classic Warcraft III Reforged: ' +
  'chunky exaggerated proportions, dark slate-blue fitted stone masonry, polished gold and brass trim, ' +
  'rich saturated colors, crisp readable silhouette, painterly textures. ' +
  'Three-quarter isometric view from slightly above, the entire object fully visible and centered with margin, ' +
  'no ground plane, no scenery, no cast shadow, soft even lighting, isolated on a transparent background.';

const CHAR_STYLE =
  'Stylized hand-painted high-fantasy RTS character in the style of classic Warcraft III Reforged: ' +
  'chunky exaggerated proportions, big hands and feet, rich saturated colors, crisp readable silhouette, painterly textures. ' +
  'Full body, standing in a neutral A-pose with arms angled down and away from the body, legs slightly apart, facing the camera, ' +
  'front view, entire figure visible with margin, no ground, no shadow, soft even lighting, isolated on a transparent background.';

const CREATURE_STYLE =
  'Stylized hand-painted high-fantasy RTS creature in the style of classic Warcraft III Reforged: ' +
  'chunky exaggerated proportions, rich saturated colors, crisp readable silhouette, painterly textures. ' +
  'Three-quarter view, entire creature visible and centered with margin, no ground, no shadow, soft even lighting, isolated on a transparent background.';

const PROP_STYLE =
  'Stylized hand-painted high-fantasy RTS environment prop in the style of classic Warcraft III Reforged: ' +
  'chunky shapes, rich saturated colors, painterly textures, crisp silhouette. ' +
  'Three-quarter view from slightly above, entire object visible and centered with margin, no ground plane, no shadow, isolated on a transparent background.';

const FOUNDATION = 'It stands on its own square dark-stone foundation slab with gold corner caps.';

/** @typedef {{id:string, kind:'structure'|'runner'|'creature'|'prop', prompt:string, polycount:number, rig?:{height:number, actions?:number[]}, textureSize?:number}} ModelSpec */

/** @type {ModelSpec[]} */
export const MODELS = [
  // ---------------- maze ----------------
  { id: 'wall_post', kind: 'structure', polycount: 2500, textureSize: 512,
    prompt: `A single square castle wall pillar, one block wide and about one and a half blocks tall, built from dark slate-blue fitted stone blocks, topped by a polished gold pyramid cap with gold corner trim. ${STYLE}` },
  { id: 'wall_span', kind: 'structure', polycount: 2000, textureSize: 512,
    prompt: `A short straight section of thick castle wall, twice as long as it is tall, fitted dark slate-blue stone blocks with a flat stone coping along the top edge trimmed in gold, both short ends cut flat. Viewed from the side at a three-quarter angle. ${STYLE}` },

  // ---------------- power ----------------
  { id: 'pylon', kind: 'structure', polycount: 6000, textureSize: 1024,
    prompt: `A slender power relay pylon: a small square stone plinth, a brass tripod frame wrapped with copper coils, crowned by a floating glowing electric-blue crystal with small arcs of lightning. ${STYLE}` },
  { id: 'furnace', kind: 'structure', polycount: 12000,
    prompt: `A squat stone-and-iron furnace power generator with a roaring orange fire grate in front, a riveted brass smokestack chimney, a coal hopper on the side and a blue glowing energy coil on top. ${FOUNDATION} ${STYLE}` },
  { id: 'water_wheel', kind: 'structure', polycount: 12000,
    prompt: `A large wooden water wheel power generator mounted beside a small stone mill house with a slate roof, brass gears and a glowing blue energy capacitor on the roof, all on a square stone pier. ${STYLE}` },
  { id: 'solar_panel', kind: 'structure', polycount: 10000,
    prompt: `A fantasy solar collector: a tilted array of golden-framed crystal mirror panels glowing with warm sunlight, on a brass swivel mount with gears. ${FOUNDATION} ${STYLE}` },
  { id: 'capacitor', kind: 'structure', polycount: 10000,
    prompt: `An arcane-tech battery bank: three tall glass cylinders filled with glowing electric-blue liquid energy, bound with brass rings and copper cables. ${FOUNDATION} ${STYLE}` },

  // ---------------- mana ----------------
  { id: 'mana_well', kind: 'structure', polycount: 10000,
    prompt: `A mystical moon well: a round carved pale-stone well brimming with glowing violet-cyan magical water, silver and gold filigree, small floating purple crystals and runes hovering above the water. ${FOUNDATION} ${STYLE}` },
  { id: 'ley_obelisk', kind: 'structure', polycount: 5000, textureSize: 1024,
    prompt: `A slim carved dark-stone obelisk inlaid with glowing violet runes, a floating purple crystal hovering at its tip, on a small square stone plinth. ${STYLE}` },
  { id: 'graveyard', kind: 'structure', polycount: 12000,
    prompt: `A small haunted graveyard plot: crooked tombstones, a tiny stone crypt with a glowing green soul lantern, a low wrought-iron fence, wisps of ghostly green light. ${FOUNDATION} ${STYLE}` },

  // ---------------- combat ----------------
  { id: 'ballista', kind: 'structure', polycount: 12000,
    prompt: `A heavy siege ballista tower: a short round stone tower with a wooden and gold-trimmed giant crossbow turret on top, loaded with a huge iron-tipped bolt. ${STYLE}` },
  { id: 'cannon', kind: 'structure', polycount: 12000,
    prompt: `A cannon tower: a massive dark bronze cannon on a rotating gold-trimmed turret ring atop a short round slate-blue stone tower base. ${STYLE}` },
  { id: 'tesla_coil', kind: 'structure', polycount: 14000,
    prompt: `A tall tesla coil tower: stacked brass and copper coil rings wrapped around a glowing electric-blue crystal core, with a copper sphere on top, dark stone base with gold trim. ${STYLE}` },
  { id: 'demon_tower', kind: 'structure', polycount: 14000,
    prompt: `A menacing demon fire tower: jagged black obsidian spires around a horned demonic skull, glowing orange lava cracks, a brazier of roaring hellfire at the top. ${FOUNDATION} ${STYLE}` },
  { id: 'lich_tower', kind: 'structure', polycount: 14000,
    prompt: `An icy lich tower: a frost-covered pale-blue stone spire with jagged ice crystals, a floating frozen skull wreathed in cold mist at its peak, silver trim. ${FOUNDATION} ${STYLE}` },
  { id: 'chemical_tower', kind: 'structure', polycount: 14000,
    prompt: `An alchemist's chemical tower: a brass framework holding bubbling bright green glass flasks and coiled tubes, a catapult arm holding a vat of glowing green acid. ${FOUNDATION} ${STYLE}` },
  { id: 'pyro_trap', kind: 'structure', polycount: 8000,
    prompt: `A low flat fire trap: a round iron grate set into a ring of stone, glowing orange embers beneath, four brass flame nozzles around the rim, very short and wide. ${FOUNDATION} ${STYLE}` },
  { id: 'dark_tower', kind: 'structure', polycount: 14000,
    prompt: `A sinister shadow tower: a twisted black stone spire with silver trim, a huge glowing purple eye at the top, dark purple smoke tendrils. ${FOUNDATION} ${STYLE}` },
  { id: 'vine_trap', kind: 'structure', polycount: 12000,
    prompt: `A carnivorous vine trap: thick thorny green vines and a giant venus-flytrap plant bursting out of a mossy stone planter box. ${STYLE}` },
  { id: 'tsunami_tower', kind: 'structure', polycount: 14000,
    prompt: `A water mage tower: a stone fountain tower decorated with seashells and coral, a swirling sphere of bright blue water floating on top, gold trim. ${FOUNDATION} ${STYLE}` },
  { id: 'clock_tower', kind: 'structure', polycount: 14000,
    prompt: `A small clockwork tower: a square stone tower with a large glowing golden clock face, exposed brass gears and a swinging pendulum, blue glowing clock hands. ${FOUNDATION} ${STYLE}` },
  { id: 'holy_tower', kind: 'structure', polycount: 14000,
    prompt: `A holy light tower: a white marble tower with gold filigree, crowned by a winged angel statue holding up a radiant golden sun disc. ${FOUNDATION} ${STYLE}` },
  { id: 'swarm_tower', kind: 'structure', polycount: 14000,
    prompt: `A dragon roost tower: a round stone tower topped with a large twig nest full of red and gold dragon eggs, iron braziers on the sides. ${STYLE}` },
  { id: 'hero_tower', kind: 'structure', polycount: 16000,
    prompt: `A heroic archmage tower: a tall ornate blue-and-gold wizard tower with a pointed roof, blue banners, a huge floating arcane crystal above with orbiting glowing runes. ${FOUNDATION} ${STYLE}` },

  // ---------------- landmarks ----------------
  { id: 'castle_gate', kind: 'structure', polycount: 20000,
    prompt: `A fortified castle gatehouse: thick gray-blue stone gate with a closed wooden portcullis door, two squat round towers on either side with blue banners bearing a gold lion emblem, lit torches. ${STYLE}` },
  { id: 'spawn_portal', kind: 'structure', polycount: 16000,
    prompt: `An evil dark portal: a ring of jagged black stone and bones standing upright, filled with a swirling red and sickly green vortex, spikes and skulls around the base. ${STYLE}` },

  // ---------------- runners (rigged humanoids) ----------------
  { id: 'orc_grunt', kind: 'runner', polycount: 9000, rig: { height: 1.8, actions: [8] },
    prompt: `A green-skinned orc grunt warrior in spiked iron shoulder armor and a red loincloth, holding a small axe. ${CHAR_STYLE}` },
  { id: 'goblin_scout', kind: 'runner', polycount: 8000, rig: { height: 1.1, actions: [8] },
    prompt: `A small skinny goblin scout with huge pointy ears, leather armor, goggles on its forehead and a dagger. ${CHAR_STYLE}` },
  { id: 'ogre_brute', kind: 'runner', polycount: 10000, rig: { height: 2.4, actions: [8] },
    prompt: `A huge hulking tan-skinned ogre brute in heavy riveted steel plate armor with a big round steel shield strapped to its forearm. ${CHAR_STYLE}` },
  { id: 'goblin_sapper', kind: 'runner', polycount: 8000, rig: { height: 1.1, actions: [8] },
    prompt: `A goblin sapper with welding goggles carrying a crackling blue electric bomb in a harness on its back, holding a wrench. ${CHAR_STYLE}` },
  { id: 'skeleton_warrior', kind: 'runner', polycount: 8000, rig: { height: 1.8, actions: [8] },
    prompt: `An undead skeleton warrior in rusty armor pieces with glowing blue eyes, holding a notched sword. ${CHAR_STYLE}` },
  { id: 'troll_berserker', kind: 'runner', polycount: 9000, rig: { height: 2.0, actions: [8] },
    prompt: `A lanky blue-skinned jungle troll berserker with tusks, a red mohawk and bone jewelry, holding a throwing axe. ${CHAR_STYLE}` },
  { id: 'orc_warlord', kind: 'runner', polycount: 14000, rig: { height: 2.6, actions: [8] },
    prompt: `A massive orc warlord boss in black and crimson spiked plate armor with skull trophies and a huge two-handed axe. ${CHAR_STYLE}` },

  // ---------------- creatures (procedurally animated) ----------------
  { id: 'wraith', kind: 'creature', polycount: 8000,
    prompt: `A floating hooded spectral wraith with glowing violet eyes, tattered translucent purple robes that fade into wisps instead of legs, clawed hands reaching forward. ${CREATURE_STYLE}` },
  { id: 'power_leech', kind: 'creature', polycount: 8000,
    prompt: `A crawling beetle-like power leech creature with a segmented dark carapace, six legs and long glowing electric-blue siphon antennae. ${CREATURE_STYLE}` },
  { id: 'whelp', kind: 'creature', polycount: 8000,
    prompt: `A small red dragon whelp flying with its wings spread wide, gold belly scales and small horns. ${CREATURE_STYLE}` },

  // ---------------- props ----------------
  { id: 'pine_tree', kind: 'prop', polycount: 1500, textureSize: 512,
    prompt: `A single stylized pine tree with chunky layered dark green foliage tiers and a short brown trunk. ${PROP_STYLE}` },
  { id: 'fir_tree', kind: 'prop', polycount: 1500, textureSize: 512,
    prompt: `A single tall slim fir tree with drooping blue-green foliage tiers and a dark trunk. ${PROP_STYLE}` },
  { id: 'rock_cluster', kind: 'prop', polycount: 2000, textureSize: 512,
    prompt: `A cluster of three chunky gray-blue boulders with patches of green moss on top. ${PROP_STYLE}` },
  { id: 'cliff_rock', kind: 'prop', polycount: 3000, textureSize: 1024,
    prompt: `A chunky rectangular cliff face segment of stacked gray-blue rock strata with grass and moss growing on the flat top. ${PROP_STYLE}` },
  { id: 'brazier', kind: 'prop', polycount: 3000, textureSize: 512,
    prompt: `A stone pillar brazier torch with a gold fire bowl on top holding burning coals. ${PROP_STYLE}` },
  { id: 'ley_crystal', kind: 'prop', polycount: 4000, textureSize: 1024,
    prompt: `A cluster of large glowing violet and magenta mana crystals jutting out of dark rocks. ${PROP_STYLE}` },
];

// Seamless tiling ground textures with full PBR maps (normal, roughness, height) for the
// terrain shader's height-blended, parallax-mapped layers. All are painted strictly top-down so
// nothing "leans" relative to the camera.
const TEX_STYLE = 'seen from directly above, top-down orthographic, flat even lighting, no cast shadows, no perspective, stylized hand-painted high-fantasy RTS game terrain texture, rich saturated colors';
export const TEXTURES = [
  { id: 'grass', prompt: `lush vivid green meadow grass, short dense blades pointing in all directions, small clover leaves, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'forest', prompt: `lush forest floor: soft green moss and clover with scattered fallen brown and orange leaves, pine needles and tiny twigs, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'trampled', prompt: `trampled flattened pale yellow-green grass pressed into the earth with patches of bare brown soil and footprints, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'dirt', prompt: `packed brown dirt road with small pebbles and footprints, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'mud', prompt: `churned dark wet mud with stones, puddles and battle craters, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'rock', prompt: `gray-blue layered cliff rock with cracks and small patches of moss, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'sand', prompt: `wet riverbank sand with small smooth stones and shells, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'scorched', prompt: `burnt scorched earth with black ash, charred grass stubble and a few glowing orange embers, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'cobble', prompt: `worn gray cobblestone paving with moss growing in the cracks, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'water', prompt: 'gentle rippling water surface waves seen from above, clear blue, stylized', maps: ['normal'] },
  // grass variants, woven together by large noise patches so the meadow never repeats
  { id: 'grass_lush', prompt: `deep emerald lush meadow grass, long soft blades swirling in varied directions, darker green with light yellow-green tips, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'grass_dry', prompt: `sun-dried meadow grass, golden and pale straw-yellow blades mixed with olive green, a few seed heads, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'grass_clover', prompt: `dense carpet of bright green clover leaves and short grass with tiny white and pink clover flowers, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'moss', prompt: `soft deep green moss carpet with pale green lichen patches, tiny ferns and a few small gray stones, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'bark', prompt: `rough pine tree bark with deep vertical grooves, brown and gray with small moss patches, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'ruin_stone', prompt: `ancient weathered sandstone blocks with worn carved edges, cracks and moss in the seams, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
  { id: 'grass_wild', prompt: `green wildflower meadow grass sprinkled with tiny purple, yellow and white flowers, ${TEX_STYLE}`, maps: ['normal', 'roughness', 'height'] },
];

const CLUTTER_STYLE = 'Stylized hand-painted high-fantasy RTS game ground detail sprite, rich saturated colors, crisp silhouette, centered with margin, isolated on a transparent background, no ground, no shadow.';
// Small ground clutter, packed into two atlases (flat decals + upright billboards).
export const CLUTTER = [
  { id: 'leaf_oak', flat: true, prompt: `A single fallen brown and orange oak leaf seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'leaf_maple', flat: true, prompt: `A single fallen red-orange maple leaf seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'leaf_birch', flat: true, prompt: `Three small fallen yellow-green birch leaves seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'twig', flat: true, prompt: `A small dry brown twig with a few green pine needles, seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'pebbles', flat: true, prompt: `A small cluster of smooth gray and tan pebbles seen from directly above. ${CLUTTER_STYLE}` },
  { id: 'clover', flat: true, prompt: `A small patch of bright green clover leaves with two tiny white clover flowers, seen from directly above. ${CLUTTER_STYLE}` },
  { id: 'mushrooms', flat: false, prompt: `A small cluster of three red-capped white-spotted toadstool mushrooms, side view. ${CLUTTER_STYLE}` },
  { id: 'daisies', flat: false, prompt: `A small clump of white daisies with yellow centers on green stems, side view. ${CLUTTER_STYLE}` },
  { id: 'bluebells', flat: false, prompt: `A small clump of blue bellflowers on curved green stems, side view. ${CLUTTER_STYLE}` },
  { id: 'poppies', flat: false, prompt: `A small clump of bright red poppies on thin green stems, side view. ${CLUTTER_STYLE}` },
];

// Set dressing sprites, packed into a 4x2 atlas (public/assets/ui/decor_atlas.png).
export const DECOR = [
  { id: 'bush_round', flat: false, prompt: `A dense round leafy green shrub, side view, bushy silhouette with individual leaves. ${CLUTTER_STYLE}` },
  { id: 'bush_berry', flat: false, prompt: `A leafy dark green bush with clusters of small red berries, side view. ${CLUTTER_STYLE}` },
  { id: 'bush_fern', flat: false, prompt: `A lush clump of arching green fern fronds, side view. ${CLUTTER_STYLE}` },
  { id: 'stump_top', flat: true, prompt: `The flat cut top of a tree stump seen from directly above: pale wood with concentric growth rings, cracks and a bark rim. ${CLUTTER_STYLE}` },
  { id: 'banner_blue', flat: false, prompt: `A tall vertical cloth war banner hanging straight down, deep blue with gold trim and a gold lightning bolt emblem, swallowtail bottom edge, front view, flat, no pole. ${CLUTTER_STYLE}` },
  { id: 'banner_red', flat: false, prompt: `A tall vertical cloth war banner hanging straight down, crimson with gold trim and a gold tower emblem, swallowtail bottom edge, front view, flat, no pole. ${CLUTTER_STYLE}` },
  { id: 'butterfly_orange', flat: true, prompt: `A single orange and black monarch butterfly with wings spread open, seen from directly above, symmetrical. ${CLUTTER_STYLE}` },
  { id: 'butterfly_blue', flat: true, prompt: `A single bright blue morpho butterfly with wings spread open, seen from directly above, symmetrical. ${CLUTTER_STYLE}` },
];

// Floating decals for the ponds, packed into a 2x2 atlas (public/assets/ui/water_decals.png).
export const WATER_DECALS = [
  { id: 'lilypad', flat: true, prompt: `A single round glossy green lily pad with a V-shaped notch and radial veins, seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'lilypad_flower', flat: true, prompt: `A round green lily pad with a blooming pink and white water lily flower on it, seen from directly above. ${CLUTTER_STYLE}` },
  { id: 'lilypad_pair', flat: true, prompt: `Two small overlapping green lily pads with notches, one slightly yellowed, seen from directly above, lying flat. ${CLUTTER_STYLE}` },
  { id: 'lilypad_bud', flat: true, prompt: `A round green lily pad with a closed pink water lily bud beside it, seen from directly above. ${CLUTTER_STYLE}` },
];

const ICON_STYLE =
  'Square fantasy RTS command button icon painting in the style of classic Warcraft III icons: ' +
  'bold hand-painted illustration filling the whole square, dramatic rim lighting, rich saturated colors, dark vignette edges, no text, no border frame.';

// Opaque square command-card icons (medium quality).
export const ICONS = [
  { id: 'connect', prompt: `A glowing electric-blue chain link crackling with lightning. ${ICON_STYLE}` },
  { id: 'disconnect', prompt: `A broken red chain link snapping apart with sparks. ${ICON_STYLE}` },
  { id: 'sell', prompt: `A red metal trash can with a gold coin flying out of it. ${ICON_STYLE}` },
  { id: 'upgrade', prompt: `A golden upward arrow over a glowing anvil with sparks. ${ICON_STYLE}` },
  { id: 'overcharge', prompt: `A white-hot lightning bolt glowing red and orange, overheating, steam and sparks. ${ICON_STYLE}` },
  { id: 'wall', prompt: `A sturdy dark stone castle wall with gold-capped pillars. ${ICON_STYLE}` },
  { id: 'spikes', prompt: `A stone wall bristling with sharp iron spikes. ${ICON_STYLE}` },
  { id: 'research', prompt: `An open glowing spellbook with blueprints of a tower and brass gears. ${ICON_STYLE}` },
  { id: 'cat_defense', prompt: `A crossed sword and cannon over a castle shield. ${ICON_STYLE}` },
  { id: 'cat_power', prompt: `A glowing blue lightning bolt over a brass gear. ${ICON_STYLE}` },
  { id: 'cat_arcane', prompt: `A glowing violet mana crystal with swirling magic runes. ${ICON_STYLE}` },
  { id: 'start_wave', prompt: `A war horn blowing with red battle banners behind it. ${ICON_STYLE}` },
  { id: 'target', prompt: `A red crosshair target over a charging orc silhouette. ${ICON_STYLE}` },
  // spells
  { id: 'spell_thunderstorm', prompt: `A dark storm cloud raining blue lightning bolts. ${ICON_STYLE}` },
  { id: 'spell_blizzard', prompt: `Swirling ice shards and snow falling in a blizzard. ${ICON_STYLE}` },
  { id: 'spell_meteor', prompt: `A flaming meteor crashing down trailing fire. ${ICON_STYLE}` },
  { id: 'spell_plague', prompt: `A billowing toxic green poison cloud with a skull shape. ${ICON_STYLE}` },
  { id: 'spell_curse', prompt: `A purple cursed eye with dark tendrils. ${ICON_STYLE}` },
  { id: 'spell_consecrate', prompt: `A golden holy sigil glowing on the ground with rays of light. ${ICON_STYLE}` },
  { id: 'spell_whirlpool', prompt: `A swirling blue whirlpool vortex of water. ${ICON_STYLE}` },
  { id: 'spell_overgrowth', prompt: `Thorny green vines erupting from the ground and grabbing. ${ICON_STYLE}` },
  { id: 'spell_stormbolt', prompt: `A glowing magical war hammer thrown with blue lightning. ${ICON_STYLE}` },
  // research
  { id: 'res_engineering', prompt: `Brass gears, a wrench and tower blueprints. ${ICON_STYLE}` },
  { id: 'res_master_engineering', prompt: `A golden master craftsman hammer over an ornate glowing gear. ${ICON_STYLE}` },
  { id: 'res_solar', prompt: `A bright sun shining on golden crystal mirror panels. ${ICON_STYLE}` },
  { id: 'res_pyro', prompt: `A roaring orange fireball held in an iron gauntlet. ${ICON_STYLE}` },
  { id: 'res_cryo', prompt: `A frozen skull encased in blue ice crystals. ${ICON_STYLE}` },
  { id: 'res_alchemy', prompt: `Bubbling green potion flasks and an alchemy symbol. ${ICON_STYLE}` },
  { id: 'res_arcane', prompt: `A glowing violet magic eye inside a rune circle. ${ICON_STYLE}` },
  { id: 'res_capacitors', prompt: `Glass battery cylinders full of blue electricity. ${ICON_STYLE}` },
  { id: 'res_hydraulics', prompt: `A cresting blue ocean wave with brass pipes. ${ICON_STYLE}` },
  { id: 'res_herbalism', prompt: `A venus flytrap plant with thorny vines. ${ICON_STYLE}` },
  { id: 'res_necromancy', prompt: `A green glowing skull with ghostly souls rising from a grave. ${ICON_STYLE}` },
  { id: 'res_chrono', prompt: `A glowing golden pocket watch with time distortion swirls. ${ICON_STYLE}` },
  { id: 'res_spellweaving', prompt: `Glowing hands weaving threads of violet and blue magic. ${ICON_STYLE}` },
  { id: 'res_divinity', prompt: `A radiant golden angel wing with holy light rays. ${ICON_STYLE}` },
  { id: 'res_dragonkin', prompt: `A fierce red dragon head breathing fire. ${ICON_STYLE}` },
  { id: 'res_heroism', prompt: `A heroic archmage staff with a floating crystal and golden crown. ${ICON_STYLE}` },
  { id: 'res_leymastery', prompt: `Glowing violet ley lines connecting crystals across a dark landscape. ${ICON_STYLE}` },
  { id: 'res_superconductors', prompt: `Glowing blue copper coils with perfectly straight lightning. ${ICON_STYLE}` },
  { id: 'res_masonry', prompt: `A mason's chisel and hammer over carved stone blocks. ${ICON_STYLE}` },
];

const HUD_STYLE =
  'Single fantasy game UI icon, stylized hand-painted in the style of classic Warcraft III, bold shapes, gold rim lighting, centered with margin, isolated on a transparent background, no text.';

// Small transparent HUD glyphs (high quality, native alpha).
export const HUD_ICONS = [
  { id: 'hud_gold', prompt: `A single shiny gold coin stamped with a crown, seen slightly from the front. ${HUD_STYLE}` },
  { id: 'hud_units', prompt: `The bust of an armored orc runner silhouette in a steel helmet. ${HUD_STYLE}` },
  { id: 'hud_lives', prompt: `A red heart-shaped gem set in gold filigree. ${HUD_STYLE}` },
  { id: 'hud_power', prompt: `A glowing electric-blue lightning bolt. ${HUD_STYLE}` },
  { id: 'hud_mana', prompt: `A glowing violet mana droplet crystal. ${HUD_STYLE}` },
  { id: 'hud_sun', prompt: `A radiant golden sun with a friendly painted face. ${HUD_STYLE}` },
  { id: 'hud_moon', prompt: `A pale blue crescent moon with stars. ${HUD_STYLE}` },
  { id: 'hud_clear', prompt: `A small bright sun in a clear blue sky circle. ${HUD_STYLE}` },
  { id: 'hud_cloudy', prompt: `A fluffy gray-white cloud partly covering the sun. ${HUD_STYLE}` },
  { id: 'hud_rain', prompt: `A dark blue rain cloud with falling raindrops. ${HUD_STYLE}` },
  { id: 'hud_storm', prompt: `A black thunder cloud with a bright lightning bolt. ${HUD_STYLE}` },
  { id: 'hud_fog', prompt: `Swirling pale gray fog wisps. ${HUD_STYLE}` },
  { id: 'checkpoint_rune', prompt: `A flat circular carved stone rune platform viewed exactly from directly above, glowing electric-blue runes in concentric rings, ancient and weathered. Top-down orthographic, isolated on a transparent background.` },
];

const SPRITE_STYLE = 'Stylized hand-painted fantasy RTS game foliage sprite in the style of Warcraft III, vivid saturated greens, painterly, side view, centered with margin, isolated on a transparent background, no ground, no shadow.';

// Billboard ground-cover sprites.
export const SPRITES = [
  { id: 'grass_tuft', prompt: `A lush clump of tall bright green grass blades, dense and spiky. ${SPRITE_STYLE}` },
  { id: 'flower_clump', prompt: `A small clump of green grass with tiny yellow and white wildflowers. ${SPRITE_STYLE}` },
  { id: 'fern', prompt: `A small bushy dark green fern plant. ${SPRITE_STYLE}` },
];

// Large illustrations.
export const ART = [
  { id: 'title_art', width: 2048, height: 1152,
    prompt: 'Epic fantasy tower defense key art in the style of classic Warcraft III Reforged: a stone fortress wall with gold-capped pillars and a glowing blue tesla tower crackling with lightning arcs to other towers, a horde of green orcs charging along a dirt path through a pine forest at dusk, dramatic sky, painterly, cinematic, rich saturated colors. No text.' },
];
