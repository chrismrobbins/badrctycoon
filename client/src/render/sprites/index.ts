import type { GameState } from '../../core/state';
import { BUILD_DATA } from '../../content';
import { isNight } from '../clock';
import { loadStrip, type DrawFn } from '../atlas';
import { STRIPS } from './generated-strips';
import {
  drawFlowerBed, drawTrashCan, drawBench, drawLamp, drawLampNight, drawTree, drawFountain,
} from './scenery';
import {
  drawBalloonStand, drawRestroom, drawRestroomNight, drawDrinkStall, drawFoodStall, drawGoKarts,
} from './shops';
import {
  drawCarousel, drawCarouselNight, drawTeaCups, drawTeaCupsNight, drawBumperCars,
  drawBumperCarsNight, drawDropTower, drawDropTowerNight, drawSwingingShip,
  drawSwingingShipNight, drawHauntedHouse, drawHauntedHouseNight, drawFerrisWheel,
  drawFerrisWheelNight, drawCoaster, drawCoasterNight,
} from './rides';
import { drawMegaCoaster, drawMegaCoasterNight } from './megacoaster';

// id -> how to draw it. Replaces the two `else if (cell === '...')` chains the
// renderer used to carry (one for 1x1, one for multi-tile), which meant adding a
// ride touched the renderer in two places and silently drew nothing if you
// missed one.
//
// Kept separate from content/ on purpose: content/ is pure data with no canvas
// dependency, so a headless simulation -- and the server's save validation --
// can import it.
// `state` is optional and trailing -- only the trash can (litter overflow)
// actually reads it; render() always passes it, everything else ignores it.
export type SpriteFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, state?: GameState) => void;

// ── Pre-rendered strips ──
//
// Every attraction below is baked in Blender rather than drawn with ctx paths.
// See render/atlas.ts for the sheet layout and the loading/fallback rules;
// the geometry is scripts/blender/attractions.py, and the frame counts and
// sizes come from ./generated-strips.ts, which pack-strip.mjs writes from the
// same data it packed the sheets with. Do not hand-edit those numbers.
//
// msPerLoop is the ONLY hand-set field, and it is not free: it must equal the
// period of the animation each strip took over, or the park changes speed.
// Derived from the vector originals -- e.g. drawCarousel used
// `angle = simClock * 0.001`, so one revolution is 2*PI/0.001 sim-ms.
const REV = (rate: number) => (2 * Math.PI) / rate;

function baked(
  id: string,
  msPerLoop: number,
  fallback: DrawFn,
  overlay?: DrawFn,
): SpriteFn {
  const g = STRIPS[id];
  if (!g) throw new Error(`[render] no packed strip for "${id}" -- run scripts/blender/pack-strip.mjs`);
  const strip = loadStrip(id, g, { msPerLoop, fallback, overlay });
  return (ctx, cx, cy, state) => strip.draw(ctx, cx, cy, state);
}

/** Night lights only run when it's dark; the day structure is already baked. */
const atNight = (fn: DrawFn): DrawFn => (ctx, cx, cy, state) => {
  if (isNight) fn(ctx, cx, cy, state);
};

// The trash can is the one sprite whose look depends on GameState (the litter
// overflow indicator), so the can is baked and the overflow stays canvas.
const trashOverflow: DrawFn = (ctx, cx, cy, state) => {
  const full = state?.litter[`${Math.round(cx)},${Math.round(cy)}`] || 0;
  if (full <= 1) return;
  ctx.fillStyle = '#a8a29e';
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 16, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(cx + 2.2, cy - 16.6, 1.2, 0, Math.PI * 2);
  ctx.fill();
};

export const SPRITES: Record<string, SpriteFn> = {
  // scenery
  flowerbed: baked('flowerbed', 1, drawFlowerBed),
  trashcan: baked('trashcan', 1, drawTrashCan, trashOverflow),
  bench: baked('bench', 1, drawBench),
  lamp: baked('lamp', 1, drawLamp, atNight(drawLampNight)),
  tree: baked('tree', REV(0.0009), drawTree),
  fountain: baked('fountain', REV(0.005), drawFountain),

  // shops
  balloonstand: baked('balloonstand', REV(0.002), drawBalloonStand),
  restroom: baked('restroom', 1, drawRestroom, atNight(drawRestroomNight)),
  drinkstall: baked('drinkstall', REV(0.003), drawDrinkStall),
  foodstall: baked('foodstall', REV(0.002), drawFoodStall),

  // rides
  carousel: baked('carousel', REV(0.001), drawCarousel, atNight(drawCarouselNight)),
  teacups: baked('teacups', REV(0.001), drawTeaCups, atNight(drawTeaCupsNight)),
  bumper: baked('bumper', REV(0.002), drawBumperCars, atNight(drawBumperCarsNight)),
  droptower: baked('droptower', 6000, drawDropTower, atNight(drawDropTowerNight)),
  ship: baked('ship', REV(0.002), drawSwingingShip, atNight(drawSwingingShipNight)),
  haunted: baked('haunted', 1, drawHauntedHouse, atNight(drawHauntedHouseNight)),
  gokarts: baked('gokarts', REV(0.0012), drawGoKarts),
  ferriswheel: baked('ferriswheel', REV(0.0005), drawFerrisWheel, atNight(drawFerrisWheelNight)),
  coaster: baked('coaster', 4600, drawCoaster, atNight(drawCoasterNight)),
  megacoaster: baked('megacoaster', 7000, drawMegaCoaster, atNight(drawMegaCoasterNight)),
};

// Paths are painted by the ground pass, so they are the one legitimate omission.
{
  const missing = Object.keys(BUILD_DATA).filter((id) => id !== 'path' && !SPRITES[id]);
  if (missing.length) throw new Error(`[render] no sprite for: ${missing.join(', ')}`);
}
