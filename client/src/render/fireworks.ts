import { simClock } from './clock';

/** Also used by main.ts's Guest class for balloon colors -- an unrelated
 *  reuse of the same vibrant palette, not a fireworks-specific dependency. */
export const FIREWORK_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6', '#10b981', '#f97316', '#06b6d4', '#f43f5e', '#a3e635'];

class FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
  size: number;
  sparkle: boolean;

  constructor(x: number, y: number, angle: number, speed: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.color = color;
    this.alpha = 1;
    this.decay = 0.012 + Math.random() * 0.015;
    this.gravity = 0.03;
    this.size = 1.5 + Math.random() * 1.5;
    this.sparkle = Math.random() > 0.7; // some particles twinkle
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.alpha -= this.decay;
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.alpha <= 0) return;
    const flickr = this.sparkle ? 0.5 + Math.sin(simClock * 0.02 + this.x) * 0.5 : 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * this.alpha, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.alpha * flickr;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

class FireworkShell {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  color: string;
  trail: { x: number; y: number; alpha: number }[];
  alive: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.x = canvas.width * 0.2 + Math.random() * canvas.width * 0.6;
    this.y = canvas.height;
    this.targetY = canvas.height * 0.1 + Math.random() * canvas.height * 0.3;
    this.speed = 3 + Math.random() * 3;
    this.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    this.trail = [];
    this.alive = true;
  }
  update() {
    this.trail.push({ x: this.x, y: this.y, alpha: 1 });
    if (this.trail.length > 8) this.trail.shift();
    this.trail.forEach((t) => (t.alpha *= 0.85));
    this.y -= this.speed;
    if (this.y <= this.targetY) {
      this.alive = false;
      this.explode();
    }
  }
  explode() {
    const count = 40 + Math.floor(Math.random() * 40);
    const style = Math.floor(Math.random() * 3); // 0=circle, 1=ring, 2=star
    const color2 = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      let speed = 1 + Math.random() * 3;
      if (style === 1) speed = 2.5 + Math.random() * 0.5; // ring: uniform speed
      if (style === 2) speed = i % 5 === 0 ? 4 : 1.5 + Math.random(); // star: long points
      const c = i % 3 === 0 ? color2 : this.color;
      fireworkParticles.push(new FireworkParticle(this.x, this.y, angle, speed, c));
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    // Trail
    for (const t of this.trail) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(254, 240, 138, ${t.alpha})`;
      ctx.fill();
    }
    // Shell head
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fef08a';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#fef08a';
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// Private to this module -- nothing outside updateFireworks/drawFireworks/
// hasActiveFireworks ever touched the originals either.
let fireworkShells: FireworkShell[] = [];
let fireworkParticles: FireworkParticle[] = [];

/** Launches new shells while `fireworksActive`, and steps every shell and
 *  particle currently in flight. fireworksActive/fireworksTimer themselves
 *  stay main.ts state (set from evaluateAwards/checkObjectives/economyTick),
 *  threaded in here the same way sim/economy.ts's EconomyTickResult does. */
export function updateFireworks(fireworksActive: boolean, canvas: HTMLCanvasElement): void {
  // Launch new shells periodically during the show
  if (fireworksActive && Math.random() < 0.12) {
    fireworkShells.push(new FireworkShell(canvas));
  }

  // Update shells
  for (let i = fireworkShells.length - 1; i >= 0; i--) {
    fireworkShells[i].update();
    if (!fireworkShells[i].alive) fireworkShells.splice(i, 1);
  }

  // Update particles
  for (let i = fireworkParticles.length - 1; i >= 0; i--) {
    fireworkParticles[i].update();
    if (fireworkParticles[i].alpha <= 0) fireworkParticles.splice(i, 1);
  }
}

export function drawFireworks(ctx: CanvasRenderingContext2D): void {
  for (const s of fireworkShells) s.draw(ctx);
  for (const p of fireworkParticles) p.draw(ctx);
}

/** Whether any shell or particle is still in flight -- render() uses this to
 *  decide whether a finished show still needs one more draw pass. */
export function hasActiveFireworks(): boolean {
  return fireworkShells.length > 0 || fireworkParticles.length > 0;
}
