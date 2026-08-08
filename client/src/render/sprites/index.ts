import type { GameState } from '../../core/state';
import { BUILD_DATA } from '../../content';
import { drawFlowerBed, drawTrashCan, drawBench, drawLamp, drawTree, drawFountain } from './scenery';
import { drawBalloonStand, drawRestroom, drawDrinkStall, drawFoodStall, drawGoKarts } from './shops';
import { drawCarousel, drawTeaCups, drawBumperCars, drawDropTower, drawSwingingShip, drawHauntedHouse, drawFerrisWheel, drawCoaster } from './rides';
import { drawMegaCoaster } from './megacoaster';

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

  carousel: drawCarousel,
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
