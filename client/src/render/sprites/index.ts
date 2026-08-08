import type { GameState } from '../../core/state';
import { BUILD_DATA } from '../../content';
import { drawFlowerBed, drawTrashCan, drawBench, drawLamp, drawTree, drawFountain } from './scenery';
import { drawBalloonStand, drawRestroom, drawDrinkStall, drawFoodStall, drawGoKarts } from './shops';
import { drawCarousel, drawTeaCups, drawBumperCars, drawDropTower, drawSwingingShip, drawHauntedHouse, drawFerrisWheel, drawCoaster } from './rides';
import { drawMegaCoaster } from './megacoaster';
import { loadStrip } from '../atlas';

// ── Pre-rendered strips ──
// Baked in Blender rather than drawn with ctx paths. See render/atlas.ts for
// how the strip is laid out and why each field is what it is; the geometry
// itself lives in scripts/blender/carousel.py.
//
// The numbers here are not free parameters -- they're the output of
// `node scripts/blender/pack-strip.mjs carousel`, and the Blender camera is
// calibrated so a 1x1 tile lands exactly on the game's 64x32 diamond. Change
// them only alongside a re-render.
//
// msPerLoop matches the vector drawCarousel it replaces: that used
// `angle = simClock * 0.001`, so one revolution is 2*PI*1000 sim-ms. Keeping
// it identical means the swap doesn't change how fast the park reads.
const carouselStrip = loadStrip({
  src: '/sprites/carousel.png',
  frames: 16,
  w: 96,
  h: 128,
  anchorX: 48,
  anchorY: 64,
  packScale: 2,
  msPerLoop: 2 * Math.PI * 1000,
  fallback: drawCarousel,
});

// id -> how to draw it. Replaces the two `else if (cell === '...')` chains the
// renderer used to carry (one for 1x1, one for multi-tile), which meant adding a
// ride touched the renderer in two places and silently drew nothing if you
// missed one.
//
// Kept separate from content/ on purpose: content/ is pure data with no canvas
// dependency, so a headless simulation -- and the server's save validation --
// can import it.
// `state` is optional and trailing -- only drawTrashCan (litter overflow)
// actually reads it; render() always passes it, everything else ignores it.
export type SpriteFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, state?: GameState) => void;

export const SPRITES: Record<string, SpriteFn> = {
  flowerbed: drawFlowerBed,
  trashcan: drawTrashCan,
  bench: drawBench,
  lamp: drawLamp,
  tree: drawTree,
  fountain: drawFountain,

  balloonstand: drawBalloonStand,
  restroom: drawRestroom,
  drinkstall: drawDrinkStall,
  foodstall: drawFoodStall,

  carousel: (ctx, cx, cy) => carouselStrip.draw(ctx, cx, cy),
  teacups: drawTeaCups,
  bumper: drawBumperCars,
  droptower: drawDropTower,
  ship: drawSwingingShip,
  haunted: drawHauntedHouse,
  gokarts: drawGoKarts,
  ferriswheel: drawFerrisWheel,
  coaster: drawCoaster,
  megacoaster: drawMegaCoaster,
};

// Paths are painted by the ground pass, so they are the one legitimate omission.
{
  const missing = Object.keys(BUILD_DATA).filter((id) => id !== 'path' && !SPRITES[id]);
  if (missing.length) throw new Error(`[render] no sprite for: ${missing.join(', ')}`);
}
