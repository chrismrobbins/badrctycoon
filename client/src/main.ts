import './styles/app.css';
import { createGameState, emptyLedger, type RideQueue, type GameState } from './core/state';
import { SAVE_KEY, loadFromLocalStorage, saveToLocalStorage } from './save/schema';
import * as Fin from './sim/finance';
import { builtValue, parkRating, parkValue } from './sim/park';
import { AWARD_DEFS, evaluateAwards as evaluateAwardsSim } from './sim/awards';
import { getSceneryBonusAt } from './sim/scenery';
import { isNightAt } from './sim/time';
import { litterAt, dropLitter, recomputeCleanliness } from './sim/litter';
import {
    pathTiles, staffCount, dailyWages, bfsRoute, stepRoute, wanderStep, updateStaff,
    hireStaff as hireStaffSim, fireStaff as fireStaffSim,
} from './sim/staff';
import { createApi } from './net/client';
import { mountAuthUI } from './ui/auth';
import { getPlaytimeMs, startPlaytimeTracking, ensureAtLeast as ensurePlaytimeAtLeast } from './save/playtime';
// One source of truth for every buildable thing. These were nine hand-synced
// tables in the monolith; they are all derived from content/ now.
import {
    BUILD_DATA, RIDE_TYPES, SHOP_TYPES, SCENERY_TYPES, TYPE_LABEL, NAME_POOL,
    RIDE_ACCENT, MINI_COLORS, RESEARCH_ORDER, HOTKEY_TOOLS, PALETTE_GROUPS,
    NEEDS, NEED_BY_ID, BALLOON_BUY_CHANCE, BALLOON_HAPPINESS,
    STAFF_KINDS,
} from './content';

// ---------------------------------------------------------------------------
// PHASE 1: this file is the monolith's <script> block moved verbatim out of
// legacy/park-builder.html, with two deliberate changes:
//   1. inline onclick="fn()" attributes became data-act / data-arg, dispatched
//      by the delegated listener at the bottom of this file;
//   2. the theme toggle moved here from the (deleted) marketing nav.
// Nothing else was rewritten. Phases 2-4 split it along the seams described in
// docs/ARCHITECTURE.md; the ~40 module-level `let`s below become one state
// object in phase 2.
// ---------------------------------------------------------------------------

declare global {
    interface Window {
        /** Darkness level 0..1, written by updateUI() and read by the renderer.
         *  Phase 2 moves this onto the state object; it is a global only because
         *  updateUI and render had no other channel between them. */
        _nightAlpha?: number;
        webkitAudioContext?: typeof AudioContext;
    }
}

interface TrackPoint { x: number; y: number }

// Track profiles were memoized onto the draw functions themselves
// (drawCoaster.path = ...). Hoisted to module scope so they are typed; phase 4
// moves each into its own sprite module.
let coasterPath: TrackPoint[] | null = null;
let megaCoasterPath: TrackPoint[] | null = null;
let megaCoasterLoop: { c: TrackPoint; r: number } | null = null;


// --- Isometric Game Engine (v3 — shops & guest needs, breakdowns, weather, objectives, land expansion, zoom/pan, autosave) ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const nightOverlay = document.getElementById('night-overlay');

// ── Game state ──
// Everything persisted lives on S (see core/state.ts). Session and view state
// -- camera, current tool, speed, open panels, audio, undo, transient FX --
// stays module-level below until phase 4 gives it homes in ui/ and render/.
const S = createGameState();

const TILE_W = 64;
const TILE_H = 32;

// RCT-style park entrance: a fixed 3-tile-wide gate on the west edge that the
// player can never build on or bulldoze. Guests spawn at its centre tile.
const ENTRANCE_X = 0;
const ENTRANCE_Y = 7;                    // centre of the gate — never moves
const ENTRANCE_TILES = [[0, 6], [0, 7], [0, 8]];
function isEntranceTile(x, y) { return x === ENTRANCE_X && y >= ENTRANCE_Y - 1 && y <= ENTRANCE_Y + 1; }

let currentTool = 'path';
let gameSpeed = 1;       // 0 = paused, 1 = normal, 3 = fast

// Camera
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

let mouseX = 0, mouseY = 0;
let hoveredCell = { x: -1, y: -1 };
let isDragging = false;

// ── The clock ──
// One clock, not three. The monolith ran the economy on a 1.5s setInterval while
// guests and staff updated inside requestAnimationFrame -- so the simulation ran
// at the display's refresh rate (guests moved 2.4x faster on a 144Hz monitor),
// staff advanced `gameSpeed` times per FRAME while guests advanced once, and
// setSpeed(0) never stopped guests at all: a "paused" park kept walking,
// littering and earning shop revenue.
//
// Now every one of those derives from simulated time, which only advances when
// gameSpeed > 0.
const TICK_MS = 1000 / 60;        // one entity step; 60Hz matches the old feel at 60fps
const ECONOMY_TICK_MS = 1500;     // unchanged
const MAX_CATCHUP_MS = 250;       // a backgrounded tab must not fast-forward the park
const MAX_STEPS_PER_FRAME = 120;  // bail out rather than spiral if a frame runs long

/** Milliseconds of simulated time. Drives every animation, so pause freezes them
 *  and the same tick always renders the same frame. */
let simClock = 0;
let tickAccumulator = 0;
let economyAccumulator = 0;
let lastFrameAt = 0;

// Day/Night Cycle
const TIME_SPEED = 0.15; // hours per economy tick (1.5s)
let isNight = false;     // derived from S.gameTime each updateUI()

// Weather FX (the weather itself is S.weather)
let rainDrops = [];
let rainAlpha = 0;

// Land expansion
const LAND_COSTS = [5000, 12000, 25000, 45000, 80000];

// Fireworks
let fireworkParticles = [];
let fireworkShells = [];
let fireworksActive = false;
let fireworksTimer = 0;           // ticks remaining in the show
const FIREWORK_SHOW_TICKS = 20;   // ~30 seconds of fireworks (20 × 1.5s ticks)
const FIREWORK_COLORS = ['#ef4444','#3b82f6','#eab308','#ec4899','#8b5cf6','#10b981','#f97316','#06b6d4','#f43f5e','#a3e635'];



// Ride Queues: keyed by "ax,ay"
let inspectedKey = null;

// ── Ride naming ──
// Every ride gets a name on construction; the player can rename it.

function nextName(type) {
    const pool = NAME_POOL[type] || [TYPE_LABEL[type] || type];
    const used = new Set(Object.values(S.rideNames));
    for (const n of pool) if (!used.has(n)) return n;
    // Pool exhausted — number them
    let i = 2;
    while (used.has(`${pool[0]} ${i}`)) i++;
    return `${pool[0]} ${i}`;
}

function randomName(type) {
    const pool = NAME_POOL[type] || [TYPE_LABEL[type] || type];
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── Ride Inspector panel ──
function anchorKeyAt(x, y) {
    const a = S.anchorOf[`${x},${y}`];
    return a ? `${a.ax},${a.ay}` : `${x},${y}`;
}

function openRidePanel(key) {
    const [ax, ay] = key.split(',').map(Number);
    const type = S.map[ax]?.[ay];
    if (!type || (!RIDE_TYPES.has(type) && !SHOP_TYPES.has(type))) return;
    inspectedKey = key;
    if (!S.rideNames[key]) S.rideNames[key] = nextName(type);
    document.getElementById('ride-panel').classList.remove('hidden');
    const nameEl = document.getElementById('ride-name') as HTMLInputElement;
    nameEl.value = S.rideNames[key];
    document.getElementById('ride-type').textContent = TYPE_LABEL[type] || type;
    renderRideStats();
}

function closeRidePanel() {
    inspectedKey = null;
    document.getElementById('ride-panel').classList.add('hidden');
}

// Accepts either a Tailwind-ish name (legacy callers) or a raw CSS color, and
// always emits an inline color so nothing depends on uncompiled utilities.
const CLS2HEX = {
    'text-green-500': '#16a34a', 'text-red-500': '#ef4444', 'text-blue-500': '#2563eb',
    'text-purple-500': '#a855f7', 'text-orange-500': '#ea580c', 'text-yellow-500': '#ca8a04',
    'text-indigo-400': '#818cf8', 'text-slate-400': '#94a3b8',
};
function statRow(label, value, color?) {
    const hex = CLS2HEX[color] || (color && color.charAt(0) === '#' ? color : null);
    return `<div class="m-row"><span class="l">${label}</span><span class="r"${hex ? ` style="color:${hex}"` : ''}>${value}</span></div>`;
}

function renderRideStats() {
    if (!inspectedKey) return;
    const [ax, ay] = inspectedKey.split(',').map(Number);
    const type = S.map[ax]?.[ay];
    if (!type) { closeRidePanel(); return; }
    const d = BUILD_DATA[type];
    const el = document.getElementById('ride-stats');
    let html = '';
    if (RIDE_TYPES.has(type)) {
        const q: Partial<RideQueue> = S.rideQueues[inspectedKey] || {};
        const scenery = getSceneryBonusAt(S, ax, ay);
        const nightB = isNight ? d.nightBonus : 0;
        const total = d.excitement + scenery + nightB;
        html += statRow('Status', q.broken ? 'BROKEN DOWN' : 'Operating', q.broken ? 'text-red-500' : 'text-green-500');
        html += statRow('Queue', `${q.queue || 0} waiting`, 'text-purple-500');
        html += statRow('On board', `${q.ridersOnBoard || 0} / ${d.capacity}`, 'text-blue-500');
        html += statRow('Excitement', total, 'text-orange-500');
        html += statRow('· base', d.excitement);
        html += statRow('· scenery', `+${scenery}`, 'text-green-500');
        if (nightB) html += statRow('· night bonus', `+${nightB}`, 'text-indigo-400');
        html += statRow('Cycle time', `${d.cycleTime}s`);
        html += statRow('Total riders', (q.riders || 0).toLocaleString(), 'text-blue-500');
        html += statRow('Revenue', `$${(q.earned || 0).toLocaleString()}`, 'text-green-500');
        html += statRow('Breakdowns', q.breakdowns || 0, (q.breakdowns ? 'text-red-500' : null));
        html += statRow('Built for', `$${d.cost.toLocaleString()}`);
    } else {
        const s = S.shopStats[inspectedKey] || { sales: 0, earned: 0 };
        html += statRow('Status', 'Open', 'text-green-500');
        html += statRow('Price per sale', `$${d.price}`, 'text-green-500');
        html += statRow('Total sales', s.sales.toLocaleString(), 'text-blue-500');
        html += statRow('Revenue', `$${s.earned.toLocaleString()}`, 'text-green-500');
        html += statRow('Built for', `$${d.cost.toLocaleString()}`);
        const paid = s.earned >= d.cost;
        html += `<div style="margin-top:0.375rem;font-size:10px;font-weight:700;color:${paid ? '#16a34a' : '#94a3b8'}">${paid ? '✓ Has paid for itself' : `$${(d.cost - s.earned).toLocaleString()} to break even`}</div>`;
    }
    el.innerHTML = html;
}

function renameRandom() {
    if (!inspectedKey) return;
    const [ax, ay] = inspectedKey.split(',').map(Number);
    S.rideNames[inspectedKey] = randomName(S.map[ax]?.[ay]);
    (document.getElementById('ride-name') as HTMLInputElement).value = S.rideNames[inspectedKey];
    saveGame();
}

function demolishInspected() {
    if (!inspectedKey) return;
    const [ax, ay] = inspectedKey.split(',').map(Number);
    const name = S.rideNames[inspectedKey] || 'this ride';
    if (!confirm(`Demolish "${name}"? You'll get half your money back.`)) return;
    const prevTool = currentTool;
    currentTool = 'bulldozer';
    buildInCell(ax, ay);
    currentTool = prevTool;
    closeRidePanel();
}

// ═══════════════════════════════════════════════════════════
//  PARK SYSTEMS — staff, litter, economy, research, awards
// ═══════════════════════════════════════════════════════════

const LOAN_LIMIT = 60000;
const DAILY_INTEREST = 0.005;
let undoStack = [];

const MARKETING_CAMPAIGNS = {
    radio:      { label: 'Local Radio Spot', cost: 600,  days: 3, boost: 0.25 },
    billboard:  { label: 'Highway Billboard', cost: 1500, days: 5, boost: 0.5 },
    influencer: { label: 'Influencer Tour',   cost: 3200, days: 7, boost: 0.9 },
};

// Research — rides unlock in order as you invest


function isUnlocked(tool) { return tool === 'bulldozer' || S.research.unlocked.includes(tool); }

// Ledger — sim/finance.ts is the only thing allowed to write S.funds. These are
// thin bindings so the ~40 existing call sites keep reading the same.
const earn = (amount: number, bucket: Fin.IncomeBucket) => Fin.earn(S, amount, bucket);
const spend = (amount: number, bucket: Fin.ExpenseBucket) => Fin.spend(S, amount, bucket);
const unearn = (amount: number, bucket: Fin.IncomeBucket) => Fin.unearn(S, amount, bucket);
const unspend = (amount: number, bucket: Fin.ExpenseBucket) => Fin.unspend(S, amount, bucket);
const sumOf = Fin.sumOf;

// ── Litter ── moved to sim/litter.ts (phase 4); call sites below pass S.

// ── Staff ──
// pathTiles/bfsRoute/stepRoute/wanderStep/updateStaff/staffCount/dailyWages
// moved to sim/staff.ts (phase 4). hireStaff/fireStaff stay here as thin
// wrappers -- the event-log/sound/UI-refresh calls are ui/render concerns
// that haven't moved yet, same pattern as evaluateAwards() above.
function hireStaff(kind) {
    const result = hireStaffSim(S, kind);
    if (result.ok === false) {
        logEvent(
            result.reason === 'no-paths' ? 'Build some paths before hiring staff.' : `Not enough cash to hire a ${STAFF_KINDS[kind].label}.`,
            'bad',
        );
        return;
    }
    logEvent(`Hired ${result.staff.name} as a ${result.kindDef.label} ($${result.kindDef.wage}/day).`, 'good');
    if (mgmtTab === 'staff') renderMgmt();
    sfx('hire');
}

function fireStaff(kind) {
    const removed = fireStaffSim(S, kind);
    if (!removed) return;
    logEvent(`${removed.name} (${STAFF_KINDS[kind].label}) has left the park.`, 'info');
    if (mgmtTab === 'staff') renderMgmt();
}

// Drawn per-worker so staff can join the scene's depth sort
function drawStaffOne(w) {
    const k = STAFF_KINDS[w.kind];
    const mx = w.x + (w.tx - w.x) * w.progress;
    const my = w.y + (w.ty - w.y) * w.progress;
    const p = toScreen(mx, my);
    const bob = Math.sin(w.progress * Math.PI) * 3;
    const yy = p.y - 5 - bob;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 3.5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    // Uniform body + head + cap
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.roundRect(p.x - 2.6, yy - 3, 5.2, 6.5, 2); ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath(); ctx.arc(p.x, yy - 5, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.roundRect(p.x - 2.6, yy - 7.6, 5.2, 2.2, 1); ctx.fill();
    // Tool of the trade
    ctx.strokeStyle = '#78716c'; ctx.lineWidth = 1;
    if (w.kind === 'janitor') {
        const sw = Math.sin(simClock * 0.008 + w.swing) * 2;
        ctx.beginPath(); ctx.moveTo(p.x + 2, yy - 2); ctx.lineTo(p.x + 5 + sw, yy + 4); ctx.stroke();
        ctx.fillStyle = '#eab308';
        ctx.fillRect(p.x + 4 + sw, yy + 3.5, 3, 1.6);
    } else if (w.kind === 'mechanic') {
        ctx.beginPath(); ctx.moveTo(p.x + 2.5, yy - 1); ctx.lineTo(p.x + 5, yy - 4); ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath(); ctx.arc(p.x + 5.4, yy - 4.4, 1.3, 0, Math.PI * 2); ctx.fill();
    } else {
        // Entertainer holds a balloon and sparkles
        ctx.strokeStyle = 'rgba(203,213,225,0.6)';
        ctx.beginPath(); ctx.moveTo(p.x + 2.5, yy - 2); ctx.lineTo(p.x + 5, yy - 9); ctx.stroke();
        ctx.fillStyle = '#f472b6';
        ctx.beginPath(); ctx.arc(p.x + 5.2, yy - 11, 2.4, 0, Math.PI * 2); ctx.fill();
        if (Math.sin(simClock * 0.006 + w.swing) > 0.7) {
            ctx.fillStyle = '#fde047';
            ctx.beginPath(); ctx.arc(p.x - 4, yy - 8, 1, 0, Math.PI * 2); ctx.fill();
        }
    }
}

// ── Litter rendering ──
function drawLitterAt(x, y, sx, sy) {
    const n = litterAt(S, x, y);
    if (!n) return;
    for (let i = 0; i < n * 2; i++) {
        const h = tileHash(sx + i * 31, sy - i * 17);
        const ox = (h - 0.5) * TILE_W * 0.7;
        const oy = (tileHash(sx - i * 13, sy + i * 29) - 0.5) * TILE_H * 0.7;
        const kind = Math.floor(h * 3);
        if (kind === 0) {           // crumpled cup
            ctx.fillStyle = '#e2e8f0';
            ctx.beginPath(); ctx.ellipse(sx + ox, sy + oy, 2.2, 1.4, h * 3, 0, Math.PI * 2); ctx.fill();
        } else if (kind === 1) {    // wrapper
            ctx.fillStyle = '#fca5a5';
            ctx.beginPath();
            ctx.moveTo(sx + ox - 2, sy + oy); ctx.lineTo(sx + ox, sy + oy - 1.6);
            ctx.lineTo(sx + ox + 2, sy + oy); ctx.lineTo(sx + ox, sy + oy + 1.2);
            ctx.closePath(); ctx.fill();
        } else {                    // squashed can
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(sx + ox - 1.6, sy + oy - 1, 3.2, 2);
        }
    }
}

// ── Awards ──
// Predicates, AWARD_DEFS and evaluateAwards() itself now live in sim/awards.ts
// (metadata was already in content/awards.ts). evaluateAwardsSim() only
// mutates S.awardsWon and returns what was newly won; the event-log/fireworks/
// sound side effects below are UI concerns and stay here until ui/ splits out.
function evaluateAwards() {
    for (const a of evaluateAwardsSim(S)) {
        logEvent(`🏆 AWARD: ${a.label}! (+${a.rating} rating)`, 'good');
        fireworksActive = true;
        fireworksTimer = Math.max(fireworksTimer, 6);
        sfx('award');
    }
}

// ── Undo ──
function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > 25) undoStack.shift();
}

function undoLast() {
    const e = undoStack.pop();
    if (!e) { logEvent('Nothing left to undo.', 'info'); return; }
    if (e.kind === 'build') {
        // Remove what was built and refund the full cost
        for (const c of e.cells) { S.map[c.x][c.y] = null; delete S.anchorOf[`${c.x},${c.y}`]; }
        unspend(e.cost, 'construction');   // reverse the build; do not book it as income
        delete S.rideQueues[e.key];
        delete S.rideNames[e.key];
        delete S.shopStats[e.key];
        if (inspectedKey === e.key) closeRidePanel();
        logEvent(`Undid build (${TYPE_LABEL[e.type] || e.type}). $${e.cost.toLocaleString()} returned.`, 'info');
    } else {
        // Restore what was demolished and take back the refund
        for (const c of e.cells) {
            S.map[c.x][c.y] = e.type;
            if (e.cells.length > 1) S.anchorOf[`${c.x},${c.y}`] = { ax: e.cells[0].x, ay: e.cells[0].y };
        }
        unearn(e.refund, 'refunds');        // reverse the demolition refund
        if (RIDE_TYPES.has(e.type)) {
            S.rideQueues[e.key] = { queue: 0, ridersOnBoard: 0, cycleTimer: 0, broken: false, repairTimer: 0, riders: 0, earned: 0, breakdowns: 0 };
        }
        if (e.name) S.rideNames[e.key] = e.name;
        logEvent(`Restored ${e.name || TYPE_LABEL[e.type] || e.type}.`, 'info');
    }
    updateUI();
    saveGame();
}

// ── Sound (synthesized, no assets) ──
let audioCtx = null, soundOn = false, ambienceNodes = null;

function toggleSound() {
    soundOn = !soundOn;
    const btn = document.getElementById('btn-sound');
    if (soundOn) {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            startAmbience();
        } catch (e) { soundOn = false; return; }
        btn.innerHTML = '<i class="fas fa-volume-high"></i>';
        btn.classList.add('text-blue-500');
        logEvent('Park sound on — crowd ambience engaged.', 'info');
    } else {
        stopAmbience();
        btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        btn.classList.remove('text-blue-500');
    }
}

function startAmbience() {
    // Filtered noise = distant crowd; the filter opens with attendance
    const size = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < size; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.02;
    src.connect(lp).connect(gain).connect(audioCtx.destination);
    src.start();
    ambienceNodes = { src, gain, lp };
}

function stopAmbience() {
    if (!ambienceNodes) return;
    try { ambienceNodes.src.stop(); } catch (e) {}
    ambienceNodes = null;
}

function sfx(kind) {
    if (!soundOn || !audioCtx) return;
    const now = audioCtx.currentTime;
    const tone = (freq, dur, type?, vol?, delay?) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = type || 'sine'; o.frequency.value = freq;
        const t0 = now + (delay || 0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
    };
    if (kind === 'build')      tone(520, 0.12, 'square', 0.035);
    else if (kind === 'demolish') tone(140, 0.22, 'sawtooth', 0.045);
    else if (kind === 'money') { tone(880, 0.1, 'sine', 0.03); tone(1180, 0.12, 'sine', 0.03, 0.07); }
    else if (kind === 'error') tone(180, 0.16, 'square', 0.03);
    else if (kind === 'hire')  { tone(660, 0.1, 'triangle', 0.04); tone(880, 0.12, 'triangle', 0.04, 0.08); }
    else if (kind === 'award') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 'sine', 0.045, i * 0.1));
    else if (kind === 'firework') {
        const b = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        const s = audioCtx.createBufferSource(); s.buffer = b;
        const g = audioCtx.createGain(); g.gain.value = 0.06;
        const f = audioCtx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700;
        s.connect(f).connect(g).connect(audioCtx.destination); s.start();
    }
}

// ═══════════════════════════════════════════════════════════
//  MANAGEMENT UI
// ═══════════════════════════════════════════════════════════
let mgmtTab = 'finance';

function openMgmt(tab?) {
    mgmtTab = tab || mgmtTab;
    document.getElementById('mgmt').classList.remove('hidden');
    document.querySelectorAll<HTMLElement>('.mgmt-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === mgmtTab));
    renderMgmt();
}
function closeMgmt() { document.getElementById('mgmt').classList.add('hidden'); }

// `color` is an explicit CSS color — never rely on inherited text color,
// which is white in dark mode and would vanish on a light panel.
function row(label, value, color?) {
    return `<div class="m-row"><span class="l">${label}</span><span class="r"${color ? ` style="color:${color}"` : ''}>${value}</span></div>`;
}
const C = { green: '#16a34a', red: '#ef4444', blue: '#2563eb', amber: '#f59e0b', purple: '#a855f7', slate: '#94a3b8' };
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

function renderMgmt() {
    const el = document.getElementById('mgmt-body');
    if (!el || document.getElementById('mgmt').classList.contains('hidden')) return;
    let h = '';

    if (mgmtTab === 'finance') {
        const inc = sumOf(S.ledger.income), exp = sumOf(S.ledger.expense);
        const dInc = sumOf(S.dayLedger.income), dExp = sumOf(S.dayLedger.expense);
        const profit = dInc - dExp;
        h += `<div class="m-grid3">
            <div class="m-tile" style="background:rgba(34,197,94,0.1)"><div class="k" style="color:${C.green}">Cash</div><div class="v">${money(S.funds)}</div></div>
            <div class="m-tile" style="background:rgba(59,130,246,0.1)"><div class="k" style="color:${C.blue}">Park Value</div><div class="v">${money(parkValue(S))}</div></div>
            <div class="m-tile" style="background:${profit >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}"><div class="k" style="color:${profit >= 0 ? C.green : C.red}">Today's Profit</div><div class="v">${money(profit)}</div></div>
        </div>`;
        h += `<div class="m-grid2">
            <div><div class="m-sec" style="color:${C.green}">Income (all time)</div>
                ${row('Admissions', money(S.ledger.income.admission))}
                ${row('Ride tickets', money(S.ledger.income.rides))}
                ${row('Shop sales', money(S.ledger.income.shops))}
                ${row('Objective bonuses', money(S.ledger.income.objectives))}
                ${row('Loans drawn', money(S.ledger.income.loans))}
                        ${row('Demolition refunds', money(S.ledger.income.refunds))}
                ${row('Total', money(inc), C.green)}</div>
            <div><div class="m-sec" style="color:${C.red}">Expenses (all time)</div>
                ${row('Construction', money(S.ledger.expense.construction))}
                ${row('Staff wages', money(S.ledger.expense.wages))}
                ${row('Repairs', money(S.ledger.expense.repairs))}
                ${row('Loan interest', money(S.ledger.expense.interest))}
                ${row('Marketing', money(S.ledger.expense.marketing))}
                ${row('Research', money(S.ledger.expense.research))}
                ${row('Land', money(S.ledger.expense.land))}
                ${row('Loan repayments', money(S.ledger.expense.loanRepaid))}
                ${row('Total', money(exp), C.red)}</div>
        </div>`;
        h += `<div class="m-block">
            <div class="m-sec">Admission Price</div>
            <div class="m-flex">
                <input id="price-slider" class="m-slider" type="range" min="0" max="40" value="${S.admissionPrice}" data-act="setAdmission">
                <span id="price-label" style="font-weight:700;font-size:1.05rem;width:5rem;text-align:right;">${money(S.admissionPrice)}</span>
            </div>
            <div class="m-note">Guests will pay up to about <b>${money(perceivedValue())}</b> for a park like this. Charge more and attendance drops.</div>
        </div>`;
        h += `<div class="m-block">
            <div class="m-sec">Loans</div>
            ${row('Outstanding balance', money(S.loanBalance), S.loanBalance ? C.red : null)}
            ${row('Daily interest', `${(DAILY_INTEREST * 100).toFixed(1)}% (${money(S.loanBalance * DAILY_INTEREST)}/day)`)}
            ${row('Credit limit', money(LOAN_LIMIT))}
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                <button class="m-btn blue" style="flex:1;padding:0.5rem;" data-act="borrow" data-arg="5000">Borrow $5,000</button>
                <button class="m-btn green" style="flex:1;padding:0.5rem;" data-act="repay" data-arg="5000">Repay $5,000</button>
            </div>
        </div>`;
    }

    else if (mgmtTab === 'staff') {
        h += `<div class="m-note" style="margin-bottom:1rem;">Wages are paid out of your cash every in-game day. Staff walk your paths — build paths so they can reach things.</div>`;
        for (const k in STAFF_KINDS) {
            const s = STAFF_KINDS[k], n = staffCount(S, k as keyof typeof STAFF_KINDS);
            h += `<div class="m-card">
                <div class="m-icon" style="background:${s.color}22;color:${s.color}"><i class="fas ${s.icon}"></i></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.875rem;">${s.label} <span style="color:${C.slate};font-weight:400;">× ${n}</span></div>
                    <div class="m-note" style="margin-top:0;">${s.blurb} · ${money(s.wage)}/day each</div>
                </div>
                <button class="m-btn red m-iconbtn" data-act="fireStaff" data-arg="${k}" ${n ? '' : 'disabled'}><i class="fas fa-minus"></i></button>
                <button class="m-btn green m-iconbtn" data-act="hireStaff" data-arg="${k}"><i class="fas fa-plus"></i></button>
            </div>`;
        }
        h += `<div class="m-block">
            ${row('Total staff', S.staff.length)}
            ${row('Total daily wages', money(dailyWages(S)), C.red)}
            ${row('Park cleanliness', `${Math.round(S.cleanliness)}%`, S.cleanliness > 80 ? C.green : S.cleanliness > 50 ? C.amber : C.red)}
        </div>`;
        if (S.staff.length) {
            h += `<div style="margin-top:1rem;"><div class="m-sec">On Shift</div>` + S.staff.map(w =>
                `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span><i class="fas ${STAFF_KINDS[w.kind].icon}" style="color:${STAFF_KINDS[w.kind].color};margin-right:0.375rem;"></i>${w.name}</span><span style="color:${C.slate};font-style:italic;">${w.task || 'starting shift'}</span></div>`
            ).join('') + `</div>`;
        }
    }

    else if (mgmtTab === 'marketing') {
        h += `<div class="m-note" style="margin-bottom:1rem;">Campaigns temporarily raise how many guests show up. They stack with your rating and happiness.</div>`;
        if (S.marketing.key) {
            const c = MARKETING_CAMPAIGNS[S.marketing.key];
            h += `<div class="m-tile" style="background:rgba(59,130,246,0.1);margin-bottom:1rem;">
                <div style="font-weight:700;font-size:0.875rem;color:${C.blue}"><i class="fas fa-bullhorn" style="margin-right:0.25rem;"></i>${c.label} running</div>
                <div class="m-note">+${Math.round(c.boost * 100)}% attendance · ${S.marketing.daysLeft} day(s) left</div>
            </div>`;
        }
        for (const k in MARKETING_CAMPAIGNS) {
            const c = MARKETING_CAMPAIGNS[k];
            h += `<div class="m-card">
                <div style="flex:1;"><div style="font-weight:700;font-size:0.875rem;">${c.label}</div>
                <div class="m-note" style="margin-top:0;">+${Math.round(c.boost * 100)}% attendance for ${c.days} days</div></div>
                <button class="m-btn blue" data-act="startCampaign" data-arg="${k}">${money(c.cost)}</button>
            </div>`;
        }
        h += `<div class="m-block">
            ${row('Current attendance', `${S.guests} guests`)}
            ${row('Park rating', parkRating(S))}
            ${row('Average happiness', `${Math.round(S.parkHappiness)}%`)}
        </div>`;
    }

    else if (mgmtTab === 'research') {
        const next = RESEARCH_ORDER.find(t => !S.research.unlocked.includes(t));
        h += `<div class="m-note" style="margin-bottom:1rem;">Your R&amp;D team designs new attractions. Higher funding unlocks them faster — the cost is billed daily.</div>`;
        if (next) {
            h += `<div class="m-tile" style="background:rgba(168,85,247,0.1);margin-bottom:1rem;">
                <div class="k" style="color:${C.purple}">Now designing</div>
                <div style="font-weight:700;font-size:1rem;margin:2px 0 0.5rem;">${TYPE_LABEL[next]}</div>
                <div class="meter"><span style="width:${Math.min(100, S.research.progress)}%;background:${C.purple}"></span></div>
                <div class="m-note">${Math.floor(S.research.progress)}% complete</div>
            </div>`;
        } else {
            h += `<div class="m-tile" style="background:rgba(34,197,94,0.1);margin-bottom:1rem;color:${C.green};font-weight:700;"><i class="fas fa-check-circle" style="margin-right:0.25rem;"></i>All attractions researched. Your engineers are napping.</div>`;
        }
        h += `<div class="m-sec">Daily Research Budget</div>
        <div class="m-flex" style="margin-bottom:1.25rem;">
            <input type="range" class="m-slider purple" min="0" max="500" step="25" value="${S.research.budget}" data-act="setResearchBudget">
            <span style="font-weight:700;width:6rem;text-align:right;">${money(S.research.budget)}/day</span>
        </div>`;
        h += `<div class="m-sec">Attraction List</div><div class="m-list">`;
        for (const t of RESEARCH_ORDER) {
            const got = S.research.unlocked.includes(t);
            h += `<div class="m-chip${got ? ' got' : ''}"><i class="fas ${got ? 'fa-check' : 'fa-lock'}"></i>${TYPE_LABEL[t]}<span class="sp">${money(BUILD_DATA[t].cost)}</span></div>`;
        }
        h += `</div>`;
    }

    else if (mgmtTab === 'awards') {
        h += `<div class="m-note" style="margin-bottom:1rem;">Inspectors visit every few days. Meet the criteria and your park earns a permanent rating boost.</div>`;
        for (const a of AWARD_DEFS) {
            const won = S.awardsWon.find(w => w.id === a.id);
            h += `<div class="m-card"${won ? ' style="background:rgba(234,179,8,0.1)"' : ''}>
                <div class="m-icon" style="${won ? 'background:rgba(234,179,8,0.2);color:#eab308' : 'background:rgba(100,116,139,0.12);color:#94a3b8'}"><i class="fas ${a.icon}"></i></div>
                <div style="flex:1;"><div style="font-weight:700;font-size:0.875rem;${won ? '' : `color:${C.slate}`}">${a.label}</div>
                <div class="m-note" style="margin-top:0;">${won ? `Won on day ${won.day}` : 'Not yet earned'} · +${a.rating} rating</div></div>
                ${won ? '<i class="fas fa-trophy" style="color:#eab308"></i>' : ''}
            </div>`;
        }
        h += `<div class="m-block" style="font-weight:700;font-size:0.8rem;">${S.awardsWon.length} / ${AWARD_DEFS.length} awards won</div>`;
    }

    el.innerHTML = h;
}

function perceivedValue() { return Math.max(2, Math.round(parkRating(S) / 22 + S.parkHappiness / 12 + Object.keys(S.rideQueues).length * 0.8)); }
function setAdmission(v) {
    S.admissionPrice = parseInt(v, 10);
    const lbl = document.getElementById('price-label');
    if (lbl) lbl.textContent = money(S.admissionPrice);
    saveGame();
}
function setResearchBudget(v) { S.research.budget = parseInt(v, 10); renderMgmt(); saveGame(); }

function borrow(amount) {
    if (S.loanBalance + amount > LOAN_LIMIT) { logEvent('Your credit limit is maxed out.', 'bad'); sfx('error'); return; }
    S.loanBalance += amount;
    earn(amount, 'loans');
    logEvent(`Borrowed ${money(amount)}. Interest accrues daily.`, 'info');
    sfx('money'); updateUI(); renderMgmt(); saveGame();
}
function repay(amount) {
    const pay = Math.min(amount, S.loanBalance);
    if (pay <= 0) { logEvent('You have no outstanding loan.', 'info'); return; }
    if (S.funds < pay) { logEvent('Not enough cash to make that repayment.', 'bad'); sfx('error'); return; }
    S.loanBalance -= pay;
    spend(pay, 'loanRepaid');
    logEvent(`Repaid ${money(pay)} of your loan.`, 'good');
    updateUI(); renderMgmt(); saveGame();
}
function startCampaign(key) {
    const c = MARKETING_CAMPAIGNS[key];
    if (S.funds < c.cost) { logEvent(`Not enough cash for the ${c.label}.`, 'bad'); sfx('error'); return; }
    spend(c.cost, 'marketing');
    S.marketing = { key, daysLeft: c.days };
    logEvent(`${c.label} launched! +${Math.round(c.boost * 100)}% attendance for ${c.days} days.`, 'good');
    sfx('money'); updateUI(); renderMgmt(); saveGame();
}

// ── Palette ──
// Generated from the content registry rather than hand-written in index.html,
// so a new attraction needs no markup change. Non-attraction tools (Buy Land,
// Bulldozer) stay in the HTML and are left in place.
function money0(n: number) { return '$' + n.toLocaleString(); }

function paletteButton(a: (typeof PALETTE_GROUPS)[number]['items'][number]) {
    const size = a.size > 1 ? ` <span class="text-[9px] text-blue-400">(${a.size}×${a.size})</span>` : '';
    const note = a.ui.note ? `<div class="text-[9px] text-slate-400 dark:text-gray-500">${a.ui.note}</div>` : '';
    return `
        <button class="build-btn glass rounded-xl p-3 flex flex-col items-center gap-2 hover:bg-white/50 dark:hover:bg-white/5${a.ui.span ? ' col-span-2' : ''}"
                data-act="setTool" data-arg="${a.id}">
            <div class="w-10 h-10 rounded-full ${a.ui.iconBg} flex items-center justify-center ${a.ui.iconFg}"><i class="fas ${a.ui.icon}"></i></div>
            <div class="text-center">
                <div class="text-xs font-bold">${a.ui.short ?? a.label}${size}</div>
                <div class="text-[10px] text-green-600 dark:text-green-400">${money0(a.cost)}</div>
                ${note}
            </div>
        </button>`;
}

function renderPalette() {
    const host = document.getElementById('build-palette');
    if (!host) return;
    const html = PALETTE_GROUPS.map((g) => {
        const heading = g.heading
            ? `<div class="col-span-2 mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-600 px-1">${g.heading}</div>`
            : '';
        return heading + g.items.map(paletteButton).join('');
    }).join('');
    host.insertAdjacentHTML('afterbegin', html);
}

// ── Palette locking ──
function refreshPalette() {
    // The tool id is data-arg now. This used to parse it back out of the
    // onclick="setTool('x')" attribute, which phase 1 removed -- so locking
    // silently stopped working until this was fixed.
    document.querySelectorAll<HTMLElement>('.build-btn').forEach(btn => {
        const t = btn.dataset.act === 'setTool' ? btn.dataset.arg : undefined;
        if (!t) return;
        const locked = !isUnlocked(t);
        btn.classList.toggle('locked', locked);
        btn.title = locked ? 'Not researched yet — fund R&D in Manage → Research' : '';
    });
}

// ═══════════════════════════════════════════════════════════
//  GUEST INSPECTOR
// ═══════════════════════════════════════════════════════════
let inspectedGuest = null;

function guestAtScreen(sx, sy) {
    let best = null, bestD = 22;
    for (const g of S.visualGuests) {
        if (g.queuedAt) continue;
        const mx = g.x + (g.targetX - g.x) * g.progress;
        const my = g.y + (g.targetY - g.y) * g.progress;
        const p = toScreen(mx, my);
        const px = p.x * zoom + camOffset().x, py = (p.y - 4) * zoom + camOffset().y;
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) { bestD = d; best = g; }
    }
    return best;
}

function openGuestPanel(g) {
    inspectedGuest = g;
    closeRidePanel();
    document.getElementById('guest-panel').classList.remove('hidden');
    document.getElementById('guest-name').textContent = g.name;
    renderGuestStats();
}
function closeGuestPanel() {
    inspectedGuest = null;
    document.getElementById('guest-panel').classList.add('hidden');
}

function bar(label, pct, color?, invert?) {
    const v = Math.max(0, Math.min(100, pct));
    const c = invert
        ? (v > 80 ? '#ef4444' : v > 55 ? '#f59e0b' : '#22c55e')
        : (v > 70 ? '#22c55e' : v > 40 ? '#f59e0b' : '#ef4444');
    return `<div><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;"><span style="color:#94a3b8">${label}</span><span style="font-weight:700">${Math.round(v)}%</span></div>
        <div class="meter"><span style="width:${v}%;background:${color || c}"></span></div></div>`;
}

function renderGuestStats() {
    if (!inspectedGuest) return;
    const g = inspectedGuest;
    if (!S.visualGuests.includes(g)) { closeGuestPanel(); logEvent('That guest has left the park.', 'info'); return; }
    const mood = g.happiness >= 80 ? ['Delighted', 'text-green-500'] : g.happiness >= 60 ? ['Happy', 'text-green-500']
               : g.happiness >= 40 ? ['Okay', 'text-yellow-500'] : g.happiness >= 20 ? ['Unhappy', 'text-orange-500'] : ['Furious', 'text-red-500'];
    document.getElementById('guest-name').textContent = g.name;
    document.getElementById('guest-stats').innerHTML =
        `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span style="width:0.75rem;height:0.75rem;border-radius:999px;background:${g.color}"></span>
            <span style="font-weight:700;color:${CLS2HEX[mood[1]] || '#94a3b8'}">${mood[0]}</span>
            ${g.hasBalloon ? '<i class="fas fa-circle" style="color:#f472b6;font-size:8px;margin-left:auto;" title="Has a balloon"></i>' : ''}</div>`
        + bar('Happiness', g.happiness)
        + bar('Hunger', g.hunger, null, true)
        + bar('Thirst', g.thirst, null, true)
        + bar('Need for restroom', g.bladder, null, true)
        + `<div style="margin-top:0.5rem;">
            ${statRow('Wallet', money(g.money), 'text-green-500')}
            ${statRow('Rides ridden', g.ridesRidden)}
            ${statRow('Location', `(${g.x}, ${g.y})`)}
           </div>
           <div style="margin-top:0.5rem;font-size:11px;font-style:italic;color:#94a3b8;">"${guestThought(g)}"</div>`;
}

function guestThought(g) {
    if (g.queuedAt) return `I hope ${S.rideNames[g.queuedAt] || 'this ride'} is worth the wait...`;
    if (g.bladder > 88) return 'I really need to find a restroom.';
    if (g.thirst > 85) return 'I am so thirsty. Where are the drinks?';
    if (g.hunger > 85) return 'I could eat an entire funnel cake right now.';
    if (litterAt(S, g.x, g.y) > 1) return 'This place is filthy. Does anyone clean up?';
    if (g.happiness < 25) return 'I want to go home.';
    if (g.happiness > 85) return 'This is the best park I have ever been to!';
    if (isNight) return 'The lights look lovely at night.';
    if (g.ridesRidden === 0) return 'Now what should I ride first?';
    return 'What a nice day out.';
}

// ═══════════════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════════════
let minimapOn = true;
let miniFrame = 0;

function toggleMinimap() {
    minimapOn = !minimapOn;
    document.getElementById('minimap-wrap').classList.toggle('hidden', !minimapOn);
    document.getElementById('btn-minimap').classList.toggle('text-blue-500', minimapOn);
}

function drawMinimap() {
    const mc = document.getElementById('minimap') as HTMLCanvasElement;
    if (!mc || !minimapOn) return;
    const m = mc.getContext('2d');
    m.clearRect(0, 0, mc.width, mc.height);
    m.fillStyle = '#0b1220';
    m.fillRect(0, 0, mc.width, mc.height);
    const cell = Math.min((mc.width - 8) / S.gridSize, (mc.height - 8) / S.gridSize);
    const ox = (mc.width - cell * S.gridSize) / 2, oy = (mc.height - cell * S.gridSize) / 2;
    // Land
    m.fillStyle = '#14532d';
    m.fillRect(ox, oy, cell * S.gridSize, cell * S.gridSize);
    for (let x = 0; x < S.gridSize; x++) {
        for (let y = 0; y < S.gridSize; y++) {
            const c = S.map[x][y];
            if (!c) continue;
            m.fillStyle = RIDE_TYPES.has(c) ? (RIDE_ACCENT[c] || '#a855f7') : (MINI_COLORS[c] || '#cbd5e1');
            m.fillRect(ox + x * cell, oy + y * cell, Math.max(1, cell), Math.max(1, cell));
        }
    }
    // Guests
    m.fillStyle = 'rgba(255,255,255,0.85)';
    for (const g of S.visualGuests) m.fillRect(ox + g.x * cell, oy + g.y * cell, Math.max(1, cell * 0.5), Math.max(1, cell * 0.5));
    // Staff
    for (const w of S.staff) {
        m.fillStyle = STAFF_KINDS[w.kind].color;
        m.fillRect(ox + w.x * cell, oy + w.y * cell, Math.max(1.5, cell * 0.6), Math.max(1.5, cell * 0.6));
    }
    // Viewport rectangle — invert the camera transform at the 4 screen corners
    const corners = [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]].map(([sx, sy]) => toMap(sx, sy));
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(S.gridSize, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(S.gridSize, Math.max(...ys));
    m.strokeStyle = 'rgba(96,165,250,0.9)'; m.lineWidth = 1;
    m.strokeRect(ox + x0 * cell, oy + y0 * cell, (x1 - x0) * cell, (y1 - y0) * cell);
}

function minimapJump(e) {
    const mc = document.getElementById('minimap') as HTMLCanvasElement;
    const r = mc.getBoundingClientRect();
    const cell = Math.min((mc.width - 8) / S.gridSize, (mc.height - 8) / S.gridSize);
    const ox = (mc.width - cell * S.gridSize) / 2, oy = (mc.height - cell * S.gridSize) / 2;
    const gx = ((e.clientX - r.left) * (mc.width / r.width) - ox) / cell;
    const gy = ((e.clientY - r.top) * (mc.height / r.height) - oy) / cell;
    // Center the camera on that tile
    const w = toScreen(gx, gy);
    panX = -w.x * zoom;
    panY = canvas.height / 2 - (canvas.height / 4 + 50) - w.y * zoom;
}

// ────── Objectives ──────
const OBJECTIVES = [
    { text: 'Connect a path to the entrance', reward: 250,  check: () => S.isParkOpen },
    { text: 'Build your first ride',          reward: 500,  check: () => Object.keys(S.rideQueues).length > 0 },
    { text: 'Reach 20 guests',                reward: 750,  check: () => S.guests >= 20 },
    { text: 'Reach a park rating of 500',     reward: 1000, check: () => parkRating(S) >= 500 },
    { text: 'Sell 25 items at your shops',    reward: 1000, check: () => S.shopSales >= 25 },
    { text: '75% happiness with 30+ guests',  reward: 1500, check: () => S.parkHappiness >= 75 && S.guests >= 30 },
    { text: 'Reach $30,000 park value',       reward: 2500, check: () => parkValue(S) >= 30000 },
    { text: 'Host 100 guests at once',        reward: 5000, check: () => S.guests >= 100 },
];

function renderObjectives() {
    const list = document.getElementById('objective-list');
    if (!list) return;
    list.innerHTML = '';
    OBJECTIVES.forEach((o, i) => {
        const row = document.createElement('div');
        const done = i < S.objectiveIndex;
        const current = i === S.objectiveIndex;
        row.className = 'flex items-start gap-2 text-[11px] ' + (done ? 'text-green-500' : current ? 'text-slate-800 dark:text-white font-bold' : 'text-slate-400 dark:text-gray-600');
        row.innerHTML = `<i class="fas ${done ? 'fa-check-circle' : current ? 'fa-bullseye' : 'fa-lock'} mt-0.5 text-[10px]"></i><span>${o.text} <span class="text-green-600 dark:text-green-400 font-normal">+$${o.reward.toLocaleString()}</span></span>`;
        list.appendChild(row);
    });
}

function checkObjectives() {
    while (S.objectiveIndex < OBJECTIVES.length && OBJECTIVES[S.objectiveIndex].check()) {
        const o = OBJECTIVES[S.objectiveIndex];
        earn(o.reward, 'objectives');
        S.objectiveIndex++;
        logEvent(`★ Objective complete: ${o.text}! Bonus: $${o.reward.toLocaleString()}`, 'good');
        fireworksActive = true;
        fireworksTimer = Math.max(fireworksTimer, 4);
        renderObjectives();
        saveGame();
    }
}

// ────── Save / Load ──────
// The field list is gone: saving is JSON.stringify(S). See save/schema.ts.

function saveGame() {
    saveToLocalStorage(S);
}

function loadGame(): boolean {
    const loaded = loadFromLocalStorage();
    if (!loaded) return false;
    Object.assign(S, loaded);
    return true;
}

/**
 * JSON has no prototypes, so guests come back as plain objects and staff come
 * back without their transient walk state.
 *
 * Separate from loadGame() because loadGame() runs at module line ~1240 while
 * `class Guest` is declared ~150 lines further down and would still be in its
 * temporal dead zone. Phase 4 removes the ordering problem by moving Guest into
 * sim/guests.ts.
 */
function hydrateEntities() {
    S.visualGuests = (S.visualGuests as any[]).map(
        (g) => Object.assign(Object.create(Guest.prototype), g) as Guest,
    );

    // Staff keep identity and position; everything else is recomputed.
    S.staff = (S.staff as any[])
        .filter((w) => w && STAFF_KINDS[w.kind])
        .map((w) => ({
            ...w,
            tx: w.x, ty: w.y, progress: 1,
            speed: 0.024 + Math.random() * 0.012,
            task: null, swing: Math.random() * 6,
            route: null, reroute: 0, cleaned: w.cleaned || 0,
            sweepFx: 0, lastX: -1, lastY: -1,
        }));

    reconcileRideQueues();
}

/**
 * Make rideQueues agree with the map and with the guests.
 *
 * A save can disagree in three ways: a ride exists with no queue record (older
 * saves only stored lifetime tallies), a queue record survives a ride that was
 * bulldozed, or a guest's queuedAt points somewhere the counts do not reflect.
 * Self-healing here beats trusting the file.
 */
function reconcileRideQueues() {
    const anchors = new Set<string>();
    for (let x = 0; x < S.gridSize; x++) {
        for (let y = 0; y < S.gridSize; y++) {
            const cell = S.map[x]?.[y];
            if (!cell || !RIDE_TYPES.has(cell)) continue;
            const a = S.anchorOf[`${x},${y}`];
            if (a && (a.ax !== x || a.ay !== y)) continue;
            const k = `${x},${y}`;
            anchors.add(k);
            S.rideQueues[k] ??= {
                queue: 0, ridersOnBoard: 0, cycleTimer: 0, broken: false,
                repairTimer: 0, riders: 0, earned: 0, breakdowns: 0,
            };
        }
    }

    for (const k of Object.keys(S.rideQueues)) {
        if (!anchors.has(k)) delete S.rideQueues[k];
    }

    // Recount queues from the guests that actually claim to be in them.
    for (const q of Object.values(S.rideQueues)) q.queue = 0;
    for (const g of S.visualGuests as any[]) {
        const q = g.queuedAt && S.rideQueues[g.queuedAt];
        if (q) q.queue++;
        else if (g.queuedAt) { g.queuedAt = null; g.queueTimer = 0; }
    }
}

function newGame() {
    if (!confirm('Start a new park? Your current park will be demolished forever.')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    location.reload();
}

function buyLand() {
    if (S.landPurchased >= LAND_COSTS.length) { logEvent('No more land available — the county said no.', 'bad'); return; }
    const cost = LAND_COSTS[S.landPurchased];
    if (S.funds < cost) { logEvent(`Land expansion costs $${cost.toLocaleString()}. Keep saving!`, 'bad'); return; }
    spend(cost, 'land');
    S.landPurchased++;
    S.gridSize += 4;
    for (let x = 0; x < S.gridSize; x++) {
        if (!S.map[x]) S.map[x] = [];
        for (let y = 0; y < S.gridSize; y++) {
            if (S.map[x][y] === undefined) S.map[x][y] = null;
        }
    }
    logEvent(`Land purchased! Park expanded to ${S.gridSize}×${S.gridSize}. (Scroll out to see it all.)`, 'good');
    updateLandButton();
    updateUI();
    saveGame();
}

function updateLandButton() {
    const el = document.getElementById('land-cost');
    if (!el) return;
    el.textContent = S.landPurchased >= LAND_COSTS.length ? 'SOLD OUT' : `$${LAND_COSTS[S.landPurchased].toLocaleString()}`;
}

function setSpeed(s) {
    gameSpeed = s;
    [0, 1, 3].forEach(v => {
        const btn = document.getElementById('speed-' + v);
        if (!btn) return;
        if (v === s) {
            btn.className = 'w-8 h-8 rounded-lg text-xs font-bold bg-blue-500/15 text-blue-500 transition';
        } else {
            btn.className = 'w-8 h-8 rounded-lg text-xs font-bold text-slate-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition';
        }
    });
    if (s === 0) logEvent('Time paused. The teacups spin in eternal limbo.', 'info');
}

// Initialize Map (fresh game) or restore save
const restored = loadGame();
if (!restored) {
    for (let x = 0; x < S.gridSize; x++) {
        S.map[x] = [];
        for (let y = 0; y < S.gridSize; y++) {
            S.map[x][y] = isEntranceTile(x, y) ? 'entrance' : null;
        }
    }
}
// Guarantee the gate exists and is intact on every load (older saves included)
for (const [ex, ey] of ENTRANCE_TILES) {
    if (S.map[ex] && S.map[ex][ey] !== 'entrance') {
        S.map[ex][ey] = 'entrance';
        delete S.anchorOf[`${ex},${ey}`];
    }
}
setInterval(saveGame, 12000);
window.addEventListener('beforeunload', saveGame);

// Resize Canvas — backing store must match the CSS box exactly,
// otherwise the scene renders squashed and hover math drifts
function resize() {
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || (window.innerHeight - 110);
}
window.addEventListener('resize', resize);
resize();
// Layout can settle after first paint (fonts, nav) — re-sync once loaded
window.addEventListener('load', resize);

// ────── UI Functions ──────

function setTool(tool, btnElement) {
    if (!isUnlocked(tool)) {
        const next = RESEARCH_ORDER.find(t => !S.research.unlocked.includes(t));
        logEvent(`${TYPE_LABEL[tool] || tool} isn't researched yet.${next ? ` R&D is working on ${TYPE_LABEL[next]}.` : ''}`, 'bad');
        sfx('error');
        return;
    }
    currentTool = tool;
    document.querySelectorAll('.build-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    else {
        const b = document.querySelector<HTMLElement>(`.build-btn[data-act="setTool"][data-arg="${tool}"]`);
        if (b) b.classList.add('active');
    }
}

function formatTime(h) {
    const hh = Math.floor(h) % 24;
    const mm = Math.floor((h % 1) * 60);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

function updateUI() {
    document.getElementById('stat-funds').innerText = `$${S.funds.toLocaleString()}`;
    document.getElementById('stat-guests').innerText = String(S.guests);
    document.getElementById('stat-rating').innerText = String(parkRating(S));
    document.getElementById('stat-happiness').innerText = `${Math.round(S.parkHappiness)}%`;
    document.getElementById('stat-time').innerText = formatTime(S.gameTime);
    const dayEl = document.getElementById('stat-day');
    if (dayEl) dayEl.innerText = `Day ${S.dayCount}`;
    const clnEl = document.getElementById('stat-clean');
    if (clnEl) {
        clnEl.innerText = `${Math.round(S.cleanliness)}%`;
        clnEl.style.color = S.cleanliness > 80 ? '#14b8a6' : S.cleanliness > 50 ? '#f59e0b' : '#ef4444';
    }
    const valEl = document.getElementById('stat-value');
    if (valEl) valEl.innerText = `$${parkValue(S).toLocaleString()}`;
    const wEl = document.getElementById('stat-weather');
    if (wEl) wEl.innerHTML = S.weather === 'clear'
        ? '<i class="fas fa-sun text-yellow-500"></i>'
        : S.weather === 'cloudy'
            ? '<i class="fas fa-cloud text-gray-400"></i>'
            : '<i class="fas fa-cloud-rain text-blue-400"></i>';

    const happEl = document.getElementById('stat-happiness');
    if (S.parkHappiness >= 75) { happEl.classList.add('happy-high'); } else { happEl.classList.remove('happy-high'); }

    const statusEl = document.getElementById('stat-status');
    if (S.isParkOpen) {
        statusEl.innerText = "OPEN";
        statusEl.classList.replace('text-red-500', 'text-green-500');
    } else {
        statusEl.innerText = "CLOSED";
        statusEl.classList.replace('text-green-500', 'text-red-500');
    }

    // Day/Night cycle — compute darkness level (used by canvas renderer)
    const hour = S.gameTime % 24;
    let nightAlpha = 0;
    if (hour >= 20 || hour < 5) {
        nightAlpha = 0.55;
    } else if (hour >= 18) {
        nightAlpha = ((hour - 18) / 2) * 0.55;
    } else if (hour < 7) {
        nightAlpha = ((7 - hour) / 2) * 0.55;
    }
    isNight = isNightAt(S.gameTime);
    // Store for render loop
    window._nightAlpha = nightAlpha;
}

function logEvent(msg, type='info') {
    const log = document.getElementById('event-log');
    const div = document.createElement('div');
    div.className = `text-[10px] mb-1 ${type === 'good' ? 'text-green-500 font-bold' : type === 'bad' ? 'text-red-500 font-bold' : 'text-slate-600 dark:text-gray-400'}`;
    div.innerText = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// ────── Guest Entity Class ──────
// getSceneryBonusAt() moved to sim/scenery.ts (phase 4); call sites below pass S.
const GUEST_FIRST = ['Ava','Ben','Cleo','Dev','Elle','Finn','Gia','Hugo','Iris','Jax','Kira','Leo','Mira','Nils','Otto','Pia','Quinn','Rosa','Sam','Tess','Uma','Vic','Wren','Xena','Yuri','Zed'];
const GUEST_LAST = ['Alvarez','Brooks','Chen','Diaz','Evans','Farr','Gupta','Hale','Ito','Jensen','Kaur','Lund','Moss','Novak','Owens','Park','Quist','Reyes','Silva','Tran','Vega','Walsh'];


class Guest {
    x: number; y: number;
    targetX: number; targetY: number;
    progress: number; speed: number;
    lastX: number; lastY: number;
    color: string;
    happiness: number;
    ridesRidden: number;
    queuedAt: string | null;
    queueTimer: number;
    hunger: number; thirst: number; bladder: number;
    hasBalloon: boolean; balloonColor: string;
    name: string;
    money: number;

    constructor(startX, startY) {
        this.x = startX;
        this.y = startY;
        this.targetX = startX;
        this.targetY = startY;
        this.progress = 1;
        this.speed = 0.01 + (Math.random() * 0.02);
        this.color = ['#ef4444', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6', '#10b981', '#f97316'][Math.floor(Math.random()*7)];
        this.lastX = startX;
        this.lastY = startY;
        this.happiness = 50 + Math.floor(Math.random() * 20); // 50-70 starting
        this.ridesRidden = 0;
        this.queuedAt = null;   // "ax,ay" if queued
        this.queueTimer = 0;
        // Needs (0 = satisfied, 100 = desperate)
        this.hunger = 20 + Math.random() * 30;
        this.thirst = 20 + Math.random() * 30;
        this.bladder = 10 + Math.random() * 20;
        this.hasBalloon = false;
        this.balloonColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        this.name = GUEST_FIRST[Math.floor(Math.random() * GUEST_FIRST.length)] + ' ' + GUEST_LAST[Math.floor(Math.random() * GUEST_LAST.length)];
        this.money = 25 + Math.floor(Math.random() * 60);
    }

    update() {
        // Needs creep up; unmet needs erode happiness. Driven by content/needs.ts
        // rather than a hardcoded list, so a new need is a data change.
        for (const need of NEEDS) {
            const level = Math.min(100, this[need.id] + need.growth);
            this[need.id] = level;
            if (level > need.painAbove) this.happiness = Math.max(0, this.happiness - need.painRate);
        }
        if (S.weather === 'rain') this.happiness = Math.max(0, this.happiness - 0.005);
        // Filth is depressing; a bench underfoot is a nice rest
        const filth = litterAt(S, this.x, this.y);
        if (filth) this.happiness = Math.max(0, this.happiness - 0.02 * filth);

        // If queued at a ride, wait
        if (this.queuedAt) {
            this.queueTimer++;
            if (this.queueTimer > 200) {
                // Impatient — leave queue
                this.happiness = Math.max(0, this.happiness - 15);
                const q = S.rideQueues[this.queuedAt];
                if (q) q.queue = Math.max(0, q.queue - 1);
                this.queuedAt = null;
                this.queueTimer = 0;
            }
            return;
        }

        if (this.progress >= 1) {
            this.x = this.targetX;
            this.y = this.targetY;

            // Shop next door? Buy if the need is real.
            const shopDirs = [[0,1],[1,0],[0,-1],[-1,0]];
            for (let d of shopDirs) {
                const nx = this.x + d[0], ny = this.y + d[1];
                if (nx < 0 || nx >= S.gridSize || ny < 0 || ny >= S.gridSize) continue;
                const cell = S.map[nx][ny];
                if (cell && SHOP_TYPES.has(cell)) {
                    const sd = BUILD_DATA[cell];
                    // The shop declares which need it serves; the need declares
                    // when to buy, what it resets to, and whether it litters.
                    const need = sd.shop ? NEED_BY_ID[sd.shop] : undefined;
                    let bought = false;
                    if (need) {
                        if (this[need.id] > need.buyAbove) { this[need.id] = need.resetTo; bought = true; }
                    } else if (sd.shop === 'balloon' && !this.hasBalloon && Math.random() < BALLOON_BUY_CHANCE) {
                        this.hasBalloon = true;
                        this.happiness = Math.min(100, this.happiness + BALLOON_HAPPINESS);
                        bought = true;
                    }
                    if (bought && this.money >= sd.price) {
                        earn(sd.price, 'shops');
                        this.money -= sd.price;
                        S.shopSales++;
                        if (need?.litters) dropLitter(S, this.x, this.y);
                        const sk = `${nx},${ny}`;
                        if (!S.shopStats[sk]) S.shopStats[sk] = { sales: 0, earned: 0 };
                        S.shopStats[sk].sales++;
                        S.shopStats[sk].earned += sd.price;
                        this.happiness = Math.min(100, this.happiness + 6);
                        if (Math.random() > 0.85) logEvent(`A guest spent $${sd.price} at ${S.rideNames[sk] || cell}.`, 'good');
                        break;
                    }
                }
            }

            // Check if adjacent to a ride — chance to queue
            if (Math.random() < 0.15) {
                const dirs = [[0,1],[1,0],[0,-1],[-1,0]];
                for (let d of dirs) {
                    const nx = this.x + d[0], ny = this.y + d[1];
                    if (nx >= 0 && nx < S.gridSize && ny >= 0 && ny < S.gridSize) {
                        const cell = S.map[nx][ny];
                        if (cell && RIDE_TYPES.has(cell)) {
                            // Find anchor
                            const key = S.anchorOf[`${nx},${ny}`];
                            const aKey = key ? `${key.ax},${key.ay}` : `${nx},${ny}`;
                            const q = S.rideQueues[aKey];
                            if (q && !q.broken && q.queue < BUILD_DATA[cell].capacity * 2) {
                                q.queue++;
                                this.queuedAt = aKey;
                                this.queueTimer = 0;
                                return;
                            }
                        }
                    }
                }
            }

            // Occasionally drop trash while strolling
            if (Math.random() < 0.006 && S.map[this.x]?.[this.y] === 'path') dropLitter(S, this.x, this.y);

            // Normal path wandering
            let neighbors = [];
            const dirs = [[0,1],[1,0],[0,-1],[-1,0]];
            for (let d of dirs) {
                let nx = this.x + d[0];
                let ny = this.y + d[1];
                if (nx >= 0 && nx < S.gridSize && ny >= 0 && ny < S.gridSize) {
                    if (S.map[nx][ny] === 'path' || S.map[nx][ny] === 'entrance') {
                        neighbors.push({x: nx, y: ny});
                    }
                }
            }

            if (neighbors.length > 0) {
                let next = neighbors[Math.floor(Math.random() * neighbors.length)];
                if (neighbors.length > 1 && next.x === this.lastX && next.y === this.lastY) {
                    next = neighbors.find(n => n.x !== this.lastX || n.y !== this.lastY) || next;
                }
                this.lastX = this.x;
                this.lastY = this.y;
                this.targetX = next.x;
                this.targetY = next.y;
                this.progress = 0;
            }

            // Scenery happiness boost — check surroundings
            const dirs2 = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]];
            for (let d of dirs2) {
                const nx = this.x + d[0], ny = this.y + d[1];
                if (nx >= 0 && nx < S.gridSize && ny >= 0 && ny < S.gridSize) {
                    const cell = S.map[nx][ny];
                    if (cell && SCENERY_TYPES.has(cell)) {
                        this.happiness = Math.min(100, this.happiness + 0.3);
                    }
                }
            }

            // Night penalty if no lamps nearby
            if (isNight) {
                let hasLamp = false;
                for (let d of dirs2) {
                    const nx = this.x + d[0], ny = this.y + d[1];
                    if (nx >= 0 && nx < S.gridSize && ny >= 0 && ny < S.gridSize && S.map[nx][ny] === 'lamp') {
                        hasLamp = true; break;
                    }
                }
                if (!hasLamp) this.happiness = Math.max(0, this.happiness - 0.5);
            }

        } else {
            this.progress += this.speed;
        }
    }

    draw() {
        // Don't draw if queued
        if (this.queuedAt) return;

        let currentMapX = this.x + (this.targetX - this.x) * this.progress;
        let currentMapY = this.y + (this.targetY - this.y) * this.progress;
        let pos = toScreen(currentMapX, currentMapY);

        ctx.beginPath();
        let hop = Math.sin(this.progress * Math.PI) * 4;
        ctx.arc(pos.x, pos.y - 4 - hop, 3, 0, Math.PI*2);
        ctx.fillStyle = this.color;
        ctx.fill();

        // Balloon on a string
        if (this.hasBalloon) {
            const bob = Math.sin(simClock * 0.003 + this.x * 7) * 1.5;
            ctx.strokeStyle = 'rgba(148,163,184,0.7)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(pos.x + 2, pos.y - 6 - hop);
            ctx.lineTo(pos.x + 4, pos.y - 16 - hop + bob);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(pos.x + 4, pos.y - 19 - hop + bob, 3, 0, Math.PI * 2);
            ctx.fillStyle = this.balloonColor;
            ctx.fill();
        }

        // Happiness indicator — tiny emoji above head for very happy / unhappy
        if (this.happiness >= 85) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = '6px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('★', pos.x, pos.y - 12 - hop);
        } else if (this.happiness <= 20) {
            ctx.fillStyle = '#ef4444';
            ctx.font = '6px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!', pos.x, pos.y - 12 - hop);
        }
    }
}

// ────── Ride Queue Processing ──────

function processRideQueues() {
    for (let key in S.rideQueues) {
        const q = S.rideQueues[key];
        const [ax, ay] = key.split(',').map(Number);
        const type = S.map[ax]?.[ay];
        if (!type || !RIDE_TYPES.has(type)) { delete S.rideQueues[key]; continue; }

        const data = BUILD_DATA[type];

        // ── Breakdowns ──
        if (q.broken) {
            q.repairTimer -= 1.5;
            if (q.repairTimer <= 0) {
                q.broken = false;
                const bill = Math.ceil(data.cost * 0.08);
                spend(bill, 'repairs');
                logEvent(`${S.rideNames[key] || type} repaired — mechanic invoice: $${bill}.`, 'info');
            }
            continue;
        }
        if (Math.random() < 0.006 && (q.queue + q.ridersOnBoard) > 0) {
            q.broken = true;
            q.breakdowns = (q.breakdowns || 0) + 1;
            q.repairTimer = 20 + Math.random() * 25;
            logEvent(`${S.rideNames[key] || type} broke down! A mechanic has been dispatched.`, 'bad');
            // Everyone bails from the queue, annoyed
            for (let g of S.visualGuests) {
                if (g.queuedAt === key) {
                    g.happiness = Math.max(0, g.happiness - 20);
                    g.queuedAt = null;
                    g.queueTimer = 0;
                }
            }
            q.queue = 0;
            q.ridersOnBoard = 0;
            continue;
        }

        q.cycleTimer += 1.5; // seconds per economy tick

        if (q.cycleTimer >= data.cycleTime) {
            // Ride cycle complete — riders disembark happy
            if (q.riders === undefined) { q.riders = 0; q.earned = 0; q.breakdowns = 0; }
            const sceneryBonus = getSceneryBonusAt(S, ax, ay);
            const nightBonus = isNight ? data.nightBonus : 0;
            const excitementTotal = data.excitement + sceneryBonus + nightBonus;

            // Boost happiness for riders
            let ridersProcessed = 0;
            for (let g of S.visualGuests) {
                if (g.queuedAt === key && ridersProcessed < q.ridersOnBoard) {
                    g.happiness = Math.min(100, g.happiness + excitementTotal * 0.3);
                    g.ridesRidden++;
                    g.queuedAt = null;
                    g.queueTimer = 0;
                    ridersProcessed++;
                }
            }

            // Revenue from riders
            const ticketPrice = Math.ceil(data.cost * 0.005) + Math.floor(sceneryBonus * 0.5);
            const revenue = q.ridersOnBoard * ticketPrice;
            if (revenue > 0) {
                earn(revenue, 'rides');
                q.earned += revenue;
                q.riders += ridersProcessed;
                if (Math.random() > 0.7) {
                    logEvent(`${S.rideNames[key] || type} earned $${revenue} from ${q.ridersOnBoard} riders!`, 'good');
                }
            }

            // Load new riders from queue
            q.ridersOnBoard = Math.min(q.queue, data.capacity);
            q.queue -= q.ridersOnBoard;
            q.cycleTimer = 0;
        }
    }
}

// ────── Economy Loop ──────
// Driven by the fixed-timestep loop at the bottom of this file, not its own
// setInterval. economyTick() itself is unchanged.

function economyTick() {
    // Advance time
    S.gameTime = (S.gameTime + TIME_SPEED) % 24;
    if (S.gameTime < TIME_SPEED) {
        S.dayCount++;
        logEvent(`— Day ${S.dayCount} begins —`, 'info');
        runDailyBooks();
    }

    // Weather roll
    S.weatherTicks--;
    if (S.weatherTicks <= 0) {
        S.weatherTicks = 25 + Math.floor(Math.random() * 30);
        const prev = S.weather;
        const r = Math.random();
        S.weather = r < 0.55 ? 'clear' : r < 0.8 ? 'cloudy' : 'rain';
        if (S.weather !== prev) {
            if (S.weather === 'rain') logEvent('Rain moves in — attendance will dip.', 'bad');
            else if (prev === 'rain') logEvent('The rain clears. Guests are coming back!', 'good');
            else if (S.weather === 'cloudy') logEvent('Clouds drift over the park.', 'info');
        }
    }

    // Check park open/closed
    // The gate is 3 tiles wide — a path touching any of them opens the park
    let connected = false;
    const dirs = [[0,1],[1,0],[0,-1],[-1,0]];
    for (const [ex, ey] of ENTRANCE_TILES) {
        for (const d of dirs) {
            const nx = ex + d[0], ny = ey + d[1];
            if (nx >= 0 && nx < S.gridSize && ny >= 0 && ny < S.gridSize && S.map[nx][ny] === 'path') {
                connected = true; break;
            }
        }
        if (connected) break;
    }

    if (connected && !S.isParkOpen) {
        S.isParkOpen = true;
        logEvent('Path connected to Entrance! The park is now OPEN.', 'good');
    } else if (!connected && S.isParkOpen) {
        S.isParkOpen = false;
        logEvent('Path to Entrance severed. The park is CLOSED.', 'bad');
    }

    // Night + weather arrival penalties
    const nightMultiplier = isNight ? 0.4 : 1.0;
    const weatherMultiplier = S.weather === 'rain' ? 0.45 : S.weather === 'cloudy' ? 0.85 : 1.0;

    if (S.isParkOpen) {
        // Attendance = rating × happiness × night × weather × price appeal × marketing
        const happinessMultiplier = 0.5 + (S.parkHappiness / 100) * 1.0;
        const pv = perceivedValue();
        // Cheap tickets draw crowds; overpricing empties the park
        const priceMultiplier = S.admissionPrice <= pv
            ? 1 + (pv - S.admissionPrice) * 0.05
            : Math.max(0.08, 1 - (S.admissionPrice - pv) * 0.14);
        const campaignMultiplier = S.marketing.key ? 1 + MARKETING_CAMPAIGNS[S.marketing.key].boost : 1;
        const cleanMultiplier = 0.7 + (S.cleanliness / 100) * 0.3;
        let targetGuests = Math.floor((parkRating(S) / 3) * happinessMultiplier * nightMultiplier
                                      * weatherMultiplier * priceMultiplier * campaignMultiplier * cleanMultiplier);

        if (S.guests < targetGuests) {
            const newGuests = Math.floor(Math.random() * 3) + 1;
            S.guests += newGuests;
            for (let i = 0; i < newGuests; i++) {
                S.visualGuests.push(new Guest(ENTRANCE_X, ENTRANCE_Y));
                // Each arrival pays admission at the gate
                if (S.admissionPrice > 0) earn(S.admissionPrice, 'admission');
            }
        }
        if (S.guests > targetGuests && S.guests > 0) {
            S.guests -= 1;
            const leaver = S.visualGuests.pop();
            if (leaver && inspectedGuest === leaver) closeGuestPanel();
        }

        // Process ride queues
        processRideQueues();

        // Calculate park happiness average
        if (S.visualGuests.length > 0) {
            let totalHappy = 0;
            for (let g of S.visualGuests) totalHappy += g.happiness;
            S.parkHappiness = totalHappy / S.visualGuests.length;
        }

        // Day/night flavor events
        if (isNight && Math.random() > 0.95) {
            logEvent('The park glows under the night sky...', 'info');
        }
        const hour = Math.floor(S.gameTime);
        if (hour === 6 && S.gameTime - hour < TIME_SPEED) {
            logEvent('Dawn breaks — guests are arriving!', 'good');
        }
        if (hour === 19 && S.gameTime - hour < TIME_SPEED) {
            logEvent('Night falls over the park...', 'info');
        }

        // Midnight fireworks show!
        if (hour === 0 && S.gameTime - hour < TIME_SPEED && !fireworksActive) {
            fireworksActive = true;
            fireworksTimer = FIREWORK_SHOW_TICKS;
            logEvent('✦ MIDNIGHT FIREWORKS! The sky lights up! ✦', 'good');
            // Big happiness boost for everyone watching
            for (let g of S.visualGuests) {
                g.happiness = Math.min(100, g.happiness + 25);
            }
        }

        // Count down fireworks show
        if (fireworksActive) {
            fireworksTimer--;
            if (fireworksTimer <= 0) {
                fireworksActive = false;
                logEvent('The fireworks finale dazzles the crowd!', 'good');
                // Final happiness bump
                for (let g of S.visualGuests) {
                    g.happiness = Math.min(100, g.happiness + 10);
                }
            }
        }

    } else {
        if (S.guests > 0) {
            S.guests = Math.max(0, S.guests - 5);
            while (S.visualGuests.length > S.guests) S.visualGuests.pop();
        }
    }

    // Guests, staff and FX advance in simTick(); this is the slow tick.
    recomputeCleanliness(S);
    checkObjectives();
}

// ── Daily bookkeeping: wages, interest, research, campaigns, inspectors ──
function runDailyBooks() {
    // Reset the day's snapshot
    S.dayLedger = emptyLedger();   // one definition, in core/state.ts

    // Wages
    const wages = dailyWages(S);
    if (wages > 0) {
        spend(wages, 'wages');
        if (S.funds < 0) logEvent(`Payroll of ${money(wages)} put you in the red!`, 'bad');
    }

    // Loan interest
    if (S.loanBalance > 0) {
        const interest = Math.ceil(S.loanBalance * DAILY_INTEREST);
        spend(interest, 'interest');
        logEvent(`Loan interest charged: ${money(interest)}.`, 'info');
    }

    // Research progress
    const nextTool = RESEARCH_ORDER.find(t => !S.research.unlocked.includes(t));
    if (nextTool && S.research.budget > 0 && S.funds >= S.research.budget) {
        spend(S.research.budget, 'research');
        S.research.progress += S.research.budget / 6;
        if (S.research.progress >= 100) {
            S.research.progress = 0;
            S.research.unlocked.push(nextTool);
            refreshPalette();
            logEvent(`🔬 R&D breakthrough: ${TYPE_LABEL[nextTool]} is now available to build!`, 'good');
            sfx('award');
        }
    }

    // Marketing countdown
    if (S.marketing.key) {
        S.marketing.daysLeft--;
        if (S.marketing.daysLeft <= 0) {
            logEvent(`${MARKETING_CAMPAIGNS[S.marketing.key].label} has ended.`, 'info');
            S.marketing = { key: null, daysLeft: 0 };
        }
    }

    // Inspectors every 3 days
    if (S.dayCount - S.lastAwardDay >= 3) {
        S.lastAwardDay = S.dayCount;
        evaluateAwards();
    }

    // Bankruptcy warning
    if (S.funds < -2000) logEvent('You are deep in debt. Consider a loan or raising prices.', 'bad');

    renderMgmt();
    saveGame();
}

// ────── Math & Drawing Functions ──────
// toScreen returns WORLD-space px (camera transform is applied in render);
// toMap converts raw screen px → grid coords, accounting for zoom/pan.

function camOffset() {
    return { x: canvas.width / 2 + panX, y: canvas.height / 4 + 50 + panY };
}

function toScreen(mapX, mapY) {
    const x = (mapX - mapY) * (TILE_W / 2);
    const y = (mapX + mapY) * (TILE_H / 2);
    return { x, y };
}

function toMap(screenX, screenY) {
    const o = camOffset();
    const adjX = (screenX - o.x) / zoom;
    const adjY = (screenY - o.y) / zoom;
    // The inverse transform maps each tile's diamond onto a unit SQUARE
    // centered on its integer coords, so round (not floor) is the exact
    // hit test — floor only resolved the bottom quadrant correctly and
    // shifted the other three a tile back.
    const mapX = Math.round((adjX / (TILE_W / 2) + adjY / (TILE_H / 2)) / 2);
    const mapY = Math.round((adjY / (TILE_H / 2) - adjX / (TILE_W / 2)) / 2);
    return { x: mapX, y: mapY };
}

function drawPoly(x, y, color, borderColor = null) {
    ctx.beginPath();
    ctx.moveTo(x, y - TILE_H / 2);
    ctx.lineTo(x + TILE_W / 2, y);
    ctx.lineTo(x, y + TILE_H / 2);
    ctx.lineTo(x - TILE_W / 2, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (borderColor) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// Center of an n×n block, and its diamond half-extents
function blockCenter(ax, ay, sz) { return toScreen(ax + (sz - 1) / 2, ay + (sz - 1) / 2); }
function padHalf(sz) { return { w: TILE_W * sz / 2, h: TILE_H * sz / 2 }; }

// Draw an n×n diamond footprint (multi-tile base pad)
function drawPolyN(ax, ay, sz, color, borderColor = null) {
    const c = blockCenter(ax, ay, sz);
    const { w, h } = padHalf(sz);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - h);   // top
    ctx.lineTo(c.x + w, c.y);   // right
    ctx.lineTo(c.x, c.y + h);   // bottom
    ctx.lineTo(c.x - w, c.y);   // left
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (borderColor) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// ────── Procedural Object Renderers ──────

// Soft ambient-occlusion ellipse under objects — cheap depth for everything
function drawGroundShadow(cx, cy, w) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w, w * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fill();
}

// ── Multi-tile footprint helpers ──
// An n×n pad is a diamond reaching TILE_W*n/2 horizontally and TILE_H*n/2
// vertically from its center. Rides are authored against these so
// structures genuinely occupy their block instead of floating on it.
// PAD_W/PAD_H track the block currently being drawn (set in pass 2).
let PAD_W = TILE_W;   // half-width of the current pad diamond
let PAD_H = TILE_H;   // half-height
function setPad(sz) { const p = padHalf(sz); PAD_W = p.w; PAD_H = p.h; }

// A deck/slab covering the pad, inset by `k` (0..1), with optional height
// so it reads as a raised platform with a visible front edge.
function drawIsoDeck(cx, cy, k, topFill, sideFill, lift) {
    const w = PAD_W * k, h = PAD_H * k;
    const L = lift || 0;
    if (L > 0) {
        // Front-facing sides (south-west and south-east faces)
        ctx.fillStyle = sideFill;
        ctx.beginPath();
        ctx.moveTo(cx - w, cy - L); ctx.lineTo(cx, cy + h - L);
        ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + w, cy - L); ctx.lineTo(cx, cy + h - L);
        ctx.lineTo(cx, cy + h); ctx.lineTo(cx + w, cy);
        ctx.closePath(); ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - h - L); ctx.lineTo(cx + w, cy - L);
    ctx.lineTo(cx, cy + h - L); ctx.lineTo(cx - w, cy - L);
    ctx.closePath();
    ctx.fillStyle = topFill; ctx.fill();
}

// Perimeter fence posts + rail around the pad — instantly sells "this
// whole block is the ride."
function drawPadFence(cx, cy, k, postColor, railColor) {
    const w = PAD_W * k, h = PAD_H * k;
    const corners = [[0, -h], [w, 0], [0, h], [-w, 0]];
    ctx.strokeStyle = railColor; ctx.lineWidth = 1.5;
    for (let e = 0; e < 4; e++) {
        const a = corners[e], b = corners[(e + 1) % 4];
        for (let s = 0; s < 4; s++) {
            const t0 = s / 4, t1 = (s + 1) / 4;
            const x0 = cx + a[0] + (b[0] - a[0]) * t0, y0 = cy + a[1] + (b[1] - a[1]) * t0;
            const x1 = cx + a[0] + (b[0] - a[0]) * t1, y1 = cy + a[1] + (b[1] - a[1]) * t1;
            ctx.beginPath(); ctx.moveTo(x0, y0 - 6); ctx.lineTo(x1, y1 - 6); ctx.stroke();
            ctx.fillStyle = postColor;
            ctx.fillRect(x0 - 0.75, y0 - 7, 1.5, 7);
        }
    }
}

// The park entrance — a fixed 3-tile gate, drawn once at its centre tile.
// Straight out of the RCT playbook: paved plaza, twin ticket kiosks with
// attendants, turnstiles, a big arch carrying the park name, and flags.
function drawEntrance(cx, cy) {
    // The gate spans three tiles along the grid's y axis, so every element is
    // positioned from those tiles' real screen coords — otherwise the kiosks
    // and arch end up on the wrong isometric diagonal.
    const centre = toScreen(ENTRANCE_X, ENTRANCE_Y);
    const back   = toScreen(ENTRANCE_X, ENTRANCE_Y - 1);   // up-and-right on screen
    const front  = toScreen(ENTRANCE_X, ENTRANCE_Y + 1);   // down-and-left on screen
    // Convert to offsets relative to the passed-in centre
    const dx = cx - centre.x, dy = cy - centre.y;
    const B = { x: back.x + dx,  y: back.y + dy };
    const F = { x: front.x + dx, y: front.y + dy };
    // Unit vector along the gate, pointing from back to front
    const ax = F.x - B.x, ay = F.y - B.y;
    const alen = Math.hypot(ax, ay);
    const ux = ax / alen, uy = ay / alen;

    const t = simClock * 0.003;

    // Draws one ticket kiosk. `flip` mirrors the window side so the pair reads
    // as facing each other across the gateway.
    const kiosk = (p, flip) => {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        // Side wall for iso depth, on the away side
        ctx.fillStyle = '#7f1d1d';
        ctx.beginPath();
        ctx.moveTo(p.x + flip * 9, p.y - 23); ctx.lineTo(p.x + flip * 14, p.y - 26);
        ctx.lineTo(p.x + flip * 14, p.y - 4);  ctx.lineTo(p.x + flip * 9, p.y - 1);
        ctx.closePath(); ctx.fill();
        // Front face
        ctx.fillStyle = '#b91c1c';
        ctx.beginPath(); ctx.roundRect(p.x - 9, p.y - 23, 18, 22, 2); ctx.fill();
        // Striped hipped roof
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.moveTo(p.x - 13, p.y - 23); ctx.lineTo(p.x, p.y - 32);
        ctx.lineTo(p.x + flip * 16, p.y - 29); ctx.lineTo(p.x + flip * 13 - flip * 0, p.y - 23);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#dc2626';
        for (let s = 0; s < 3; s++) {
            ctx.beginPath();
            ctx.moveTo(p.x - 11 + s * 8, p.y - 23); ctx.lineTo(p.x - 8.5 + s * 8, p.y - 23);
            ctx.lineTo(p.x - 1 + s * 3.2, p.y - 30.5); ctx.lineTo(p.x - 2.6 + s * 3.2, p.y - 30.5);
            ctx.closePath(); ctx.fill();
        }
        // Service window with an attendant
        ctx.fillStyle = '#0b1120'; ctx.fillRect(p.x - 6.5, p.y - 18, 13, 8);
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(p.x, p.y - 14.2, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.arc(p.x, p.y - 15.2, 2.5, Math.PI, 0); ctx.fill();
        // Counter shelf + fascia sign
        ctx.fillStyle = '#fbbf24'; ctx.fillRect(p.x - 8, p.y - 9.6, 16, 1.8);
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.roundRect(p.x - 8, p.y - 7.4, 16, 5, 1); ctx.fill();
        ctx.fillStyle = '#fde047'; ctx.font = 'bold 4.5px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('TICKETS', p.x, p.y - 3.4);
        if (isNight) {
            ctx.fillStyle = '#fef08a';
            ctx.shadowBlur = 10; ctx.shadowColor = '#fde047';
            ctx.beginPath(); ctx.arc(p.x, p.y - 25, 1.7, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    };

    // Low wall running along the gate axis, tying the kiosks to the arch
    const wall = (from, to) => {
        ctx.fillStyle = '#991b1b';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y - 11); ctx.lineTo(to.x, to.y - 11);
        ctx.lineTo(to.x, to.y - 1);      ctx.lineTo(from.x, from.y - 1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fca5a5';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y - 11.5); ctx.lineTo(to.x, to.y - 11.5);
        ctx.lineTo(to.x, to.y - 9.5);      ctx.lineTo(from.x, from.y - 9.5);
        ctx.closePath(); ctx.fill();
    };

    // Arch springs from points just inside each flanking tile
    const springB = { x: B.x + ux * 11, y: B.y + uy * 11 };
    const springF = { x: F.x - ux * 11, y: F.y - uy * 11 };
    const apexY = cy - 56;

    // ── Painted back-to-front so overlaps read correctly ──
    wall(B, springB);
    kiosk(B, 1);                     // rear kiosk (up-right)

    // Arch: dark core, red body, bright highlight
    const archStroke = (w, col, lift) => {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(springB.x, springB.y - 2 - lift);
        ctx.quadraticCurveTo(cx, apexY - lift, springF.x, springF.y - 2 - lift);
        ctx.stroke();
        ctx.lineCap = 'butt';
    };
    archStroke(10, '#7f1d1d', 0);
    archStroke(6, '#dc2626', 2);
    archStroke(2, '#fca5a5', 4);

    // Turnstiles across the gateway, spaced along the gate axis
    [-0.42, 0, 0.42].forEach(k => {
        const sx = cx + ux * k * alen, sy = cy + uy * k * alen;
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(sx, sy - 2, 4.5, Math.PI, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.fillRect(sx - 0.9, sy - 6.5, 1.8, 4.5);
    });

    // Park-name banner hung at the arch apex
    const bannerY = apexY - 4;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.roundRect(cx - 46, bannerY, 92, 16, 3); ctx.fill();
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect(cx - 46, bannerY, 92, 16, 3); ctx.stroke();
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 11px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DYNAMICS PARK', cx, bannerY + 8.5);
    ctx.textBaseline = 'alphabetic';

    // Flagpoles at the banner's ends
    [-46, 46].forEach((ox, i) => {
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(cx + ox, bannerY + 2); ctx.lineTo(cx + ox, bannerY - 16); ctx.stroke();
        ctx.fillStyle = i ? '#3b82f6' : '#22c55e';
        const fw = (i ? 10 : -10) + Math.sin(t + i * 2) * 2;
        ctx.beginPath();
        ctx.moveTo(cx + ox, bannerY - 16);
        ctx.quadraticCurveTo(cx + ox + fw * 0.6, bannerY - 14 + Math.sin(t * 2 + i) * 1.5, cx + ox + fw, bannerY - 12);
        ctx.lineTo(cx + ox, bannerY - 9);
        ctx.closePath(); ctx.fill();
    });

    // Chase lights tracing the arch
    if (isNight) {
        for (let i = 0; i <= 12; i++) {
            const k = i / 12, v = 1 - k;
            const px = v * v * springB.x + 2 * v * k * cx + k * k * springF.x;
            const py = v * v * (springB.y - 6) + 2 * v * k * (apexY - 4) + k * k * (springF.y - 6);
            const lit = (Math.floor(simClock * 0.004 + i) % 3) !== 0;
            ctx.fillStyle = lit ? (i % 2 ? '#fef08a' : '#fb7185') : 'rgba(148,163,184,0.5)';
            if (lit) { ctx.shadowBlur = 7; ctx.shadowColor = ctx.fillStyle; }
            ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    wall(springF, F);
    kiosk(F, -1);                    // front kiosk (down-left) overlaps the arch leg
}

// Park boundary fence around the whole plot, RCT style, with a gap at the gate
function drawParkFence() {
    const postMat = '#78716c', railMat = 'rgba(120,113,108,0.75)';
    const seg = (ax, ay, bx, by) => {
        const a = toScreen(ax, ay), b = toScreen(bx, by);
        ctx.strokeStyle = railMat; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 7); ctx.lineTo(b.x, b.y - 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 3); ctx.lineTo(b.x, b.y - 3); ctx.stroke();
        ctx.fillStyle = postMat;
        ctx.fillRect(a.x - 0.9, a.y - 9, 1.8, 9);
    };
    const N = S.gridSize;
    for (let i = 0; i < N; i++) {
        // West edge — leave a gap across the three entrance rows
        if (i < ENTRANCE_Y - 1 || i > ENTRANCE_Y + 1) seg(-0.5, i - 0.5, -0.5, i + 0.5);
        seg(N - 0.5, i - 0.5, N - 0.5, i + 0.5);   // east
        seg(i - 0.5, -0.5, i + 0.5, -0.5);         // north
        seg(i - 0.5, N - 0.5, i + 0.5, N - 0.5);   // south
    }
}

function drawTree(cx, cy) {
    drawGroundShadow(cx, cy, 13);
    const h = tileHash(cx, cy);
    const variant = Math.floor(h * 3);           // 3 deterministic species
    const sway = Math.sin(simClock * 0.0009 + cx * 0.1) * 1.6;
    // Root flare + tapered trunk
    ctx.fillStyle = '#57430f';
    ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.moveTo(cx - 2.8, cy); ctx.lineTo(cx + 2.8, cy);
    ctx.lineTo(cx + 1.4 + sway * 0.4, cy - 17); ctx.lineTo(cx - 1.4 + sway * 0.4, cy - 17);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(cx + 0.6, cy - 17, 1.6, 17);
    const tx = cx + sway;
    if (variant === 0) {
        // Broad deciduous — layered blobs, lit from upper-left
        const blobs = [[0, -24, 12], [-8, -18, 8.5], [8, -18, 8.5], [-4, -29, 7], [5, -28, 6.5]];
        ctx.fillStyle = '#14532d';
        blobs.forEach(([ox, oy, r]) => { ctx.beginPath(); ctx.arc(tx + ox + 1.5, cy + oy + 1.5, r, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#16a34a';
        blobs.forEach(([ox, oy, r]) => { ctx.beginPath(); ctx.arc(tx + ox, cy + oy, r, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#4ade80';
        ctx.beginPath(); ctx.arc(tx - 4, cy - 28, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(tx - 9, cy - 20, 3.6, 0, Math.PI * 2); ctx.fill();
    } else if (variant === 1) {
        // Conifer — stacked tiers
        for (let i = 0; i < 4; i++) {
            const w = 13 - i * 2.6, yy = cy - 8 - i * 8;
            ctx.fillStyle = ['#14532d', '#166534', '#15803d', '#16a34a'][i];
            ctx.beginPath();
            ctx.moveTo(tx, yy - 12); ctx.lineTo(tx + w, yy); ctx.lineTo(tx - w, yy);
            ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#4ade80';
        ctx.beginPath(); ctx.moveTo(tx, cy - 44); ctx.lineTo(tx + 3, cy - 38); ctx.lineTo(tx - 3, cy - 38); ctx.closePath(); ctx.fill();
    } else {
        // Palm — arcing fronds
        ctx.strokeStyle = '#166534'; ctx.lineWidth = 3;
        for (let i = 0; i < 7; i++) {
            const a = -Math.PI / 2 + (i - 3) * 0.42;
            ctx.beginPath();
            ctx.moveTo(tx, cy - 18);
            ctx.quadraticCurveTo(tx + Math.cos(a) * 9, cy - 26, tx + Math.cos(a) * 16, cy - 22 + Math.abs(i - 3) * 1.6);
            ctx.stroke();
        }
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.4;
        for (let i = 0; i < 7; i++) {
            const a = -Math.PI / 2 + (i - 3) * 0.42;
            ctx.beginPath();
            ctx.moveTo(tx, cy - 18);
            ctx.quadraticCurveTo(tx + Math.cos(a) * 9, cy - 27, tx + Math.cos(a) * 15, cy - 23 + Math.abs(i - 3) * 1.6);
            ctx.stroke();
        }
        ctx.fillStyle = '#a16207';
        [[-2, -17], [2, -16], [0, -14]].forEach(([ox, oy]) => {
            ctx.beginPath(); ctx.arc(tx + ox, cy + oy, 1.5, 0, Math.PI * 2); ctx.fill();
        });
    }
}

function drawTrashCan(cx, cy) {
    const full = (S.litter[`${Math.round(cx)},${Math.round(cy)}`] || 0);
    drawGroundShadow(cx, cy, 7);
    // Tapered bin with hoop bands
    ctx.fillStyle = '#3f4a5a';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 1); ctx.lineTo(cx + 5, cy - 1);
    ctx.lineTo(cx + 4, cy - 13); ctx.lineTo(cx - 4, cy - 13);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
        const yy = cy - 3 - i * 3.5;
        ctx.beginPath(); ctx.moveTo(cx - 4.7 + i * 0.25, yy); ctx.lineTo(cx + 4.7 - i * 0.25, yy); ctx.stroke();
    }
    // Domed lid with a swing flap
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.ellipse(cx, cy - 13.5, 5.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.ellipse(cx, cy - 14.6, 4.4, 1.8, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.ellipse(cx, cy - 14.2, 2.4, 0.9, 0, 0, Math.PI * 2); ctx.fill();
    // Recycle marking
    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('♺', cx, cy - 6);
    // Overflowing when the area is filthy
    if (full > 1) {
        ctx.fillStyle = '#a8a29e';
        ctx.beginPath(); ctx.arc(cx - 2, cy - 16, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(cx + 2.2, cy - 16.6, 1.2, 0, Math.PI * 2); ctx.fill();
    }
}

function drawBench(cx, cy) {
    drawGroundShadow(cx, cy, 11);
    const h = tileHash(cx, cy);
    // Cast-iron legs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(cx - 10, cy - 6, 2, 6);
    ctx.fillRect(cx + 8, cy - 6, 2, 6);
    // Slatted seat
    for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#a16207' : '#b45309';
        ctx.fillRect(cx - 12, cy - 8 - i * 1.6, 24, 1.4);
    }
    // Slatted back, angled
    ctx.save();
    ctx.translate(cx, cy - 10);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#a16207' : '#b45309';
        ctx.fillRect(-12, -3 - i * 2.4, 24, 1.8);
    }
    ctx.restore();
    // Armrests
    ctx.fillStyle = '#374151';
    ctx.fillRect(cx - 12.5, cy - 12, 2, 5);
    ctx.fillRect(cx + 10.5, cy - 12, 2, 5);
    // Sometimes a guest is resting here
    if (h > 0.55) {
        const col = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7'][Math.floor(h * 4) % 4];
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.roundRect(cx - 3 + (h - 0.5) * 10, cy - 16, 6, 8, 2); ctx.fill();
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(cx + (h - 0.5) * 10, cy - 17.5, 2.4, 0, Math.PI * 2); ctx.fill();
    }
}

function drawFlowerBed(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 1.0, '#3f2d16', '#2a1d0e', 3);
    setPad(2);
    const gy = cy - 3;
    // Stone border ring
    const { w, h } = padHalf(1);
    ctx.strokeStyle = '#a8a29e'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, gy - h); ctx.lineTo(cx + w, gy); ctx.lineTo(cx, gy + h); ctx.lineTo(cx - w, gy);
    ctx.closePath(); ctx.stroke();
    // Tilled soil rows
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(cx - 18 + i * 3, gy + i * 2); ctx.lineTo(cx + 18 + i * 3, gy + i * 2); ctx.stroke();
    }
    // Flower clusters — deterministic layout, gentle sway
    const t = simClock * 0.0015;
    const cols = ['#ec4899', '#eab308', '#3b82f6', '#a855f7', '#ef4444', '#f97316'];
    for (let i = 0; i < 9; i++) {
        const hh = tileHash(cx + i * 13, cy - i * 7);
        const ox = (i % 3 - 1) * 9 + (hh - 0.5) * 5;
        const oy = (Math.floor(i / 3) - 1) * 5 + (hh - 0.5) * 2;
        const fx = cx + ox + Math.sin(t + i) * 0.7, fy = gy + oy - 3;
        // Stem + leaves
        ctx.strokeStyle = '#15803d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(fx, fy + 4); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath(); ctx.ellipse(fx - 1.6, fy + 2, 1.6, 0.7, -0.4, 0, Math.PI * 2); ctx.fill();
        // 5-petal bloom with a center
        const col = cols[Math.floor(hh * cols.length)];
        ctx.fillStyle = col;
        for (let p = 0; p < 5; p++) {
            const pa = (p / 5) * Math.PI * 2 + hh * 3;
            ctx.beginPath(); ctx.arc(fx + Math.cos(pa) * 1.7, fy + Math.sin(pa) * 1.2, 1.3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.arc(fx, fy, 1, 0, Math.PI * 2); ctx.fill();
    }
}

function drawLamp(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 1.0, '#94a3b8', '#64748b', 2);
    setPad(2);
    const gy = cy - 2;
    // Fluted base
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.ellipse(cx, gy, 4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.roundRect(cx - 2.6, gy - 5, 5.2, 5, 1); ctx.fill();
    // Tapered post with highlight
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(cx - 1.6, gy - 5); ctx.lineTo(cx + 1.6, gy - 5);
    ctx.lineTo(cx + 1.1, gy - 26); ctx.lineTo(cx - 1.1, gy - 26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(226,232,240,0.35)';
    ctx.fillRect(cx - 1.3, gy - 26, 0.9, 21);
    // Cross-arm + scroll bracket
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx - 3, gy - 23); ctx.quadraticCurveTo(cx, gy - 26, cx + 3, gy - 23); ctx.stroke();
    // Glass lantern housing
    const lit = isNight || (window._nightAlpha || 0) > 0.15;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.moveTo(cx - 4, gy - 28); ctx.lineTo(cx + 4, gy - 28); ctx.lineTo(cx + 2.4, gy - 34); ctx.lineTo(cx - 2.4, gy - 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lit ? '#fef08a' : 'rgba(226,232,240,0.55)';
    ctx.beginPath(); ctx.moveTo(cx - 3.2, gy - 28.6); ctx.lineTo(cx + 3.2, gy - 28.6); ctx.lineTo(cx + 2, gy - 33.4); ctx.lineTo(cx - 2, gy - 33.4); ctx.closePath();
    if (lit) { ctx.shadowBlur = isNight ? 22 : 8; ctx.shadowColor = '#fde047'; }
    ctx.fill(); ctx.shadowBlur = 0;
    // Finial cap
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.moveTo(cx - 3, gy - 34); ctx.lineTo(cx + 3, gy - 34); ctx.lineTo(cx, gy - 37.5); ctx.closePath(); ctx.fill();
    // Halo + moths at night
    if (isNight) {
        const g = ctx.createRadialGradient(cx, gy - 31, 0, cx, gy - 31, 16);
        g.addColorStop(0, 'rgba(254,240,138,0.4)');
        g.addColorStop(1, 'rgba(254,240,138,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, gy - 31, 16, 0, Math.PI * 2); ctx.fill();
        const mt = simClock * 0.004;
        ctx.fillStyle = 'rgba(226,232,240,0.6)';
        for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(cx + Math.sin(mt + i * 3) * 7, gy - 31 + Math.cos(mt * 1.3 + i * 2) * 5, 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawFountain(cx, cy) {
    drawGroundShadow(cx, cy, 16);
    drawPoly(cx, cy, '#cbd5e1');
    // Basin with water
    ctx.beginPath(); ctx.ellipse(cx, cy - 2, 14, 6, 0, 0, Math.PI * 2); ctx.fillStyle = '#94a3b8'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy - 3, 12, 5, 0, 0, Math.PI * 2); ctx.fillStyle = '#3b82f6'; ctx.fill();
    const t = simClock * 0.005;
    // Water shimmer
    ctx.fillStyle = 'rgba(191, 219, 254, 0.6)';
    for (let i = 0; i < 3; i++) {
        const sx = cx + Math.sin(t + i * 2.1) * 8;
        ctx.beginPath(); ctx.ellipse(sx, cy - 3 + Math.cos(t + i) * 1.5, 2, 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Center column + arcing jets
    ctx.fillStyle = '#64748b'; ctx.fillRect(cx - 1.5, cy - 14, 3, 11);
    const h = 16 + Math.sin(t) * 2;
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.quadraticCurveTo(cx - 7, cy - 14 - h * 0.7, cx - 9, cy - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.quadraticCurveTo(cx + 7, cy - 14 - h * 0.7, cx + 9, cy - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 14 - h * 0.5); ctx.stroke();
    // Falling droplets
    ctx.fillStyle = 'rgba(147, 197, 253, 0.9)';
    for (let i = 0; i < 4; i++) {
        const dp = (t * 0.6 + i * 0.25) % 1;
        ctx.beginPath();
        ctx.arc(cx + (i - 1.5) * 5 * dp, cy - 14 - Math.sin(dp * Math.PI) * h * 0.8, 1, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCarousel(cx, cy) {
    // 1×1 rides get the same treatment as the big ones: their own raised,
    // fenced pad sized to a single tile (half-extents TILE_W/2 × TILE_H/2).
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#b45309', '#7c2d12', 4);
    drawPadFence(cx, cy - 4, 0.98, '#fcd34d', 'rgba(252,211,77,0.45)');
    setPad(2);
    const gy = cy - 4;

    // Rotating platform
    ctx.beginPath(); ctx.ellipse(cx, gy - 3, 25, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#92400e'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, gy - 6, 24, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#fbbf24'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, gy - 6, 24, 9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#fef3c7'; ctx.lineWidth = 1.5; ctx.stroke();
    // Platform sunburst
    const t = simClock * 0.001;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
        const a = t + i * Math.PI / 5;
        ctx.beginPath(); ctx.moveTo(cx, gy - 6);
        ctx.lineTo(cx + Math.cos(a) * 23, gy - 6 + Math.sin(a) * 8.5); ctx.stroke();
    }
    // Center column
    ctx.fillStyle = '#78350f'; ctx.fillRect(cx - 3, gy - 42, 6, 36);
    ctx.fillStyle = '#fde68a'; ctx.fillRect(cx - 1, gy - 42, 2, 36);

    // Horses — far side first so near ones overlap correctly
    const order = [0, 1, 2, 3, 4, 5].sort((a, b) => Math.sin(t + a * Math.PI / 3) - Math.sin(t + b * Math.PI / 3));
    for (const i of order) {
        const angle = t + i * (Math.PI / 3);
        const px = cx + Math.cos(angle) * 19;
        const py = gy - 7 + Math.sin(angle) * 7;
        const bob = Math.sin(t * 5 + i * 1.7) * 2.5;
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py - 28); ctx.lineTo(px, py + bob + 5); ctx.stroke();
        const hc = ['#f472b6', '#60a5fa', '#facc15', '#4ade80', '#c084fc', '#fb923c'][i];
        // Horse body / haunch / neck / head / legs / tail
        ctx.fillStyle = hc;
        ctx.beginPath(); ctx.ellipse(px, py + bob - 4, 6.5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(px + 3.5, py + bob - 10, 3.6, 7, 1.6); ctx.fill();
        ctx.beginPath(); ctx.roundRect(px + 3, py + bob - 12.5, 5.5, 3.4, 1.6); ctx.fill();
        ctx.fillRect(px - 5, py + bob - 1, 1.8, 5);
        ctx.fillRect(px + 2.6, py + bob - 1, 1.8, 5);
        ctx.strokeStyle = hc; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(px - 6, py + bob - 5); ctx.lineTo(px - 9, py + bob - 1); ctx.stroke();
        // Saddle + tiny rider
        ctx.fillStyle = '#7f1d1d'; ctx.fillRect(px - 2.5, py + bob - 7.5, 5, 2);
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(px, py + bob - 11, 1.7, 0, Math.PI * 2); ctx.fill();
    }

    // Striped canopy with scalloped valance
    ctx.beginPath(); ctx.moveTo(cx, gy - 56); ctx.lineTo(cx - 30, gy - 30); ctx.lineTo(cx + 30, gy - 30); ctx.closePath();
    const grad = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
    for (let s = 0; s <= 8; s++) grad.addColorStop(s / 8, s % 2 === 0 ? '#ef4444' : '#ffffff');
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, gy - 30, 30, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#dc2626'; ctx.fill();
    ctx.fillStyle = '#fca5a5';
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 30, gy - 29 + Math.sin(a) * 10, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // Gold finial + flag
    ctx.beginPath(); ctx.arc(cx, gy - 58, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#fde047'; ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(cx, gy - 62); ctx.lineTo(cx + 8, gy - 59); ctx.lineTo(cx, gy - 56); ctx.closePath(); ctx.fill();

    // Canopy bulbs at night
    if (isNight) {
        for (let i = 0; i < 14; i++) {
            const a = t * 2 + i * Math.PI / 7;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * 30, gy - 29 + Math.sin(a) * 10, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = i % 2 ? '#fef08a' : '#f0abfc';
            ctx.shadowBlur = 6; ctx.shadowColor = ctx.fillStyle;
            ctx.fill(); ctx.shadowBlur = 0;
        }
    }
}

function drawTeaCups(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#9d174d', '#6b0f36', 4);
    drawPadFence(cx, cy - 4, 0.98, '#f9a8d4', 'rgba(249,168,212,0.45)');
    setPad(2);
    const gy = cy - 4;
    const t = simClock * 0.001;

    // Spinning platter with pinwheel pattern
    ctx.beginPath(); ctx.ellipse(cx, gy - 3, 24, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#be185d'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, gy - 6, 23, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#ec4899'; ctx.fill();
    // Pinwheel wedges — elliptical so they stay flush with the platter
    ctx.fillStyle = 'rgba(253,242,248,0.3)';
    for (let i = 0; i < 6; i++) {
        const a = t * 0.6 + i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(cx, gy - 6);
        ctx.ellipse(cx, gy - 6, 23, 9, 0, a, a + 0.42);
        ctx.closePath();
        ctx.fill();
    }
    // Center hub cap
    ctx.beginPath(); ctx.ellipse(cx, gy - 7, 5, 2.4, 0, 0, Math.PI * 2); ctx.fillStyle = '#fbcfe8'; ctx.fill();

    // Cups — sorted so near-side draws last
    const cups = [0, 1, 2, 3, 4].map(i => ({ i, a: t + i * (Math.PI * 2 / 5) }));
    cups.sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
    for (const c of cups) {
        const px = cx + Math.cos(c.a) * 14;
        const py = gy - 7 + Math.sin(c.a) * 5.5;
        const col = ['#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'][c.i];
        // Saucer
        ctx.beginPath(); ctx.ellipse(px, py + 2, 9, 4, 0, 0, Math.PI * 2); ctx.fillStyle = '#fdf2f8'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(px, py + 2, 9, 4, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#f9a8d4'; ctx.lineWidth = 1; ctx.stroke();
        // Tapered cup body with a highlight
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(px - 6.5, py - 7); ctx.lineTo(px + 6.5, py - 7);
        ctx.quadraticCurveTo(px + 5, py + 2, px, py + 2);
        ctx.quadraticCurveTo(px - 5, py + 2, px - 6.5, py - 7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath(); ctx.ellipse(px - 3, py - 3.5, 1.6, 3, -0.3, 0, Math.PI * 2); ctx.fill();
        // Rim + interior
        ctx.beginPath(); ctx.ellipse(px, py - 7, 6.5, 2.8, 0, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(px, py - 7, 5, 2, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(15,23,42,0.3)'; ctx.fill();
        // Riders peeking over the rim
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(px - 2, py - 8.5, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 2, py - 8.5, 1.6, 0, Math.PI * 2); ctx.fill();
        // Handle whips around as the cup spins on its own axis
        const ha = t * 4 + c.i * 2;
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(px + Math.cos(ha) * 7.5, py - 3 + Math.sin(ha) * 2.5, 2.2, 0, Math.PI * 2); ctx.stroke();
    }

    // Pole-mounted deck lights at night
    if (isNight) {
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + 0.4;
            const lx = cx + Math.cos(a) * 26, ly = gy - 2 + Math.sin(a) * 11;
            ctx.fillStyle = '#94a3b8'; ctx.fillRect(lx - 0.6, ly - 12, 1.2, 12);
            ctx.fillStyle = '#fef08a';
            ctx.shadowBlur = 8; ctx.shadowColor = '#fde047';
            ctx.beginPath(); ctx.arc(lx, ly - 13, 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

function drawBumperCars(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#475569', '#2b3547', 4);
    setPad(2);
    const gy = cy - 4;
    const t = simClock * 0.002;

    // Polished arena floor with reflective sheen
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2); ctx.fill();
    const shine = ctx.createLinearGradient(cx - 26, gy - 12, cx + 26, gy + 4);
    shine.addColorStop(0, 'rgba(148,163,184,0.28)');
    shine.addColorStop(0.5, 'rgba(148,163,184,0.05)');
    shine.addColorStop(1, 'rgba(148,163,184,0.22)');
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 25, 10, 0, 0, Math.PI * 2); ctx.fill();
    // Padded perimeter wall
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Cars, depth-sorted, with skid marks
    const cars = [
        { c: '#ef4444', x: Math.sin(t) * 15,        y: Math.cos(t * 1.2) * 6 },
        { c: '#3b82f6', x: Math.cos(t * 0.8) * 13,  y: Math.sin(t * 1.5) * 6 },
        { c: '#eab308', x: Math.cos(t * 1.1) * 17,  y: Math.sin(t * 0.9) * 7 },
        { c: '#22c55e', x: Math.sin(t * 1.3 + 2) * 11, y: Math.cos(t * 0.7) * 5 },
    ].sort((a, b) => a.y - b.y);
    for (const car of cars) {
        const px = cx + car.x, py = gy - 6 + car.y;
        // Power antenna to the ceiling grid
        ctx.strokeStyle = 'rgba(148,163,184,0.85)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px + 3, py - 3); ctx.lineTo(px + 5, py - 24); ctx.stroke();
        // Rubber bumper skirt
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.ellipse(px, py + 1.5, 7.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.ellipse(px, py + 0.5, 6.5, 3, 0, 0, Math.PI * 2); ctx.fill();
        // Shell + windshield
        ctx.fillStyle = car.c;
        ctx.beginPath(); ctx.roundRect(px - 5, py - 5, 10, 6, [4, 4, 2, 2]); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.roundRect(px - 3.5, py - 4.5, 7, 2, 1); ctx.fill();
        // Driver: torso + head
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.roundRect(px - 2, py - 8, 4, 4, 1.5); ctx.fill();
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(px, py - 9, 2, 0, Math.PI * 2); ctx.fill();
        // Contact spark
        if (Math.sin(t * 30 + px) > 0.8) {
            ctx.fillStyle = '#fef08a';
            ctx.shadowBlur = 8; ctx.shadowColor = '#fde047';
            ctx.beginPath(); ctx.arc(px + 5, py - 24, 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    // Canopy posts + electrified ceiling grid
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2.5;
    [-24, 24].forEach(ox => {
        ctx.beginPath(); ctx.moveTo(cx + ox, gy - 8); ctx.lineTo(cx + ox, gy - 30); ctx.stroke();
    });
    ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
    ctx.beginPath(); ctx.ellipse(cx, gy - 30, 27, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.45)'; ctx.lineWidth = 0.75;
    for (let i = -3; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(cx + i * 8, gy - 33); ctx.lineTo(cx + i * 8, gy - 27); ctx.stroke();
    }
    // Marquee at night
    if (isNight) {
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            ctx.fillStyle = (Math.floor(t * 2 + i) % 2) ? '#38bdf8' : '#fb7185';
            ctx.shadowBlur = 6; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 27, gy - 30 + Math.sin(a) * 9, 1.4, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

function drawDropTower(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#52525b', '#33333a', 4);
    drawPadFence(cx, cy - 4, 0.98, '#facc15', 'rgba(250,204,21,0.4)');
    setPad(2);
    const gy = cy - 4;
    const topY = gy - 96;

    // Concrete base block
    ctx.fillStyle = '#3f3f46';
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 15, 6, 0, 0, Math.PI * 2); ctx.fill();

    // Three-column lattice tower with proper truss
    const colX = [-6, 0, 6];
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2.2;
    colX.forEach(ox => {
        ctx.beginPath(); ctx.moveTo(cx + ox, gy - 6); ctx.lineTo(cx + ox, topY); ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(100,116,139,0.9)'; ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
        const y0 = gy - 6 - i * 9, y1 = y0 - 9;
        ctx.beginPath(); ctx.moveTo(cx - 6, y0); ctx.lineTo(cx + 6, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 6, y0); ctx.lineTo(cx - 6, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 6, y1); ctx.lineTo(cx + 6, y1); ctx.stroke();
    }
    // Top house + beacon
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.roundRect(cx - 9, topY - 8, 18, 9, 2); ctx.fill();
    ctx.fillStyle = '#7f1d1d'; ctx.fillRect(cx - 9, topY - 1, 18, 2);
    if (Math.sin(simClock * 0.005) > 0) {
        ctx.fillStyle = '#fca5a5';
        ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444';
        ctx.beginPath(); ctx.arc(cx, topY - 11, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }

    // Drop cycle: climb, hang, plummet, settle
    const cycle = 6000;
    const t = (simClock % cycle) / cycle;
    let ringY = 0;
    if (t < 0.5) ringY = t * 2;
    else if (t < 0.6) ringY = 1;
    else if (t < 0.65) ringY = 1 - (t - 0.6) * 20;
    else ringY = 0;
    const actualY = gy - 12 - ringY * 74;
    const dropping = t >= 0.6 && t < 0.66;

    // Hoist cables
    ctx.strokeStyle = 'rgba(203,213,225,0.6)'; ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(cx - 4, topY); ctx.lineTo(cx - 4, actualY - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 4, topY); ctx.lineTo(cx + 4, actualY - 4); ctx.stroke();

    // Gondola ring with outward-facing seats
    ctx.fillStyle = '#a16207';
    ctx.beginPath(); ctx.ellipse(cx, actualY + 2, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath(); ctx.ellipse(cx, actualY, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
        const rx = cx - 12 + i * 6;
        const ry = actualY - 1 + Math.abs(i - 2) * 0.4;
        // Seat back + harness
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.roundRect(rx - 2.4, ry - 5, 4.8, 6, 1.5); ctx.fill();
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(rx, ry - 6, 1.9, 0, Math.PI * 2); ctx.fill();
        // Arms fly up on the drop
        ctx.strokeStyle = '#fcd9b6'; ctx.lineWidth = 1;
        const armY = dropping ? -11 : -7;
        ctx.beginPath(); ctx.moveTo(rx - 1.8, ry - 4); ctx.lineTo(rx - 3, ry + armY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx + 1.8, ry - 4); ctx.lineTo(rx + 3, ry + armY); ctx.stroke();
    }
    // Motion blur streaks while plummeting
    if (dropping) {
        ctx.strokeStyle = 'rgba(250,204,21,0.4)'; ctx.lineWidth = 1.5;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath(); ctx.moveTo(cx + i * 7, actualY - 6); ctx.lineTo(cx + i * 7, actualY - 26); ctx.stroke();
        }
    }

    // Tower lights at night
    if (isNight) {
        for (let i = 0; i < 9; i++) {
            ctx.fillStyle = (Math.floor(simClock * 0.004 + i) % 2) ? '#fef08a' : '#7dd3fc';
            ctx.shadowBlur = 5; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(cx - 7.5, gy - 14 - i * 10, 1.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + 7.5, gy - 14 - i * 10, 1.3, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// ── 2×2 Ride Renderers (drawn at center of 2×2 block) ──

function drawSwingingShip(cx, cy) {
    // Raised deck across the whole pad + safety fence
    drawIsoDeck(cx, cy, 0.9, '#3f4c60', '#2b3547', 5);
    drawPadFence(cx, cy - 5, 0.9, '#94a3b8', 'rgba(148,163,184,0.5)');

    // Ground line sits on the deck top; frame spans the pad's full width
    const gy = cy - 5;
    const apex = gy - 74;

    // Solid tapered A-frame legs, splayed to the pad corners
    const legGrad = ctx.createLinearGradient(cx - 56, 0, cx + 56, 0);
    legGrad.addColorStop(0, '#475569'); legGrad.addColorStop(0.5, '#94a3b8'); legGrad.addColorStop(1, '#475569');
    ctx.fillStyle = legGrad;
    ctx.beginPath(); ctx.moveTo(cx - 56, gy + 4); ctx.lineTo(cx - 4, apex); ctx.lineTo(cx + 4, apex); ctx.lineTo(cx - 44, gy + 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 56, gy + 4); ctx.lineTo(cx + 4, apex); ctx.lineTo(cx - 4, apex); ctx.lineTo(cx + 44, gy + 4); ctx.closePath(); ctx.fill();
    // Rear legs (offset back for isometric depth)
    ctx.fillStyle = 'rgba(51,65,85,0.85)';
    ctx.beginPath(); ctx.moveTo(cx - 40, gy - 12); ctx.lineTo(cx - 3, apex - 3); ctx.lineTo(cx + 2, apex - 3); ctx.lineTo(cx - 32, gy - 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 40, gy - 12); ctx.lineTo(cx + 3, apex - 3); ctx.lineTo(cx - 2, apex - 3); ctx.lineTo(cx + 32, gy - 12); ctx.closePath(); ctx.fill();
    // Footings on the deck
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx - 58, gy + 2, 16, 5);
    ctx.fillRect(cx + 42, gy + 2, 16, 5);
    // Cross beams
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(cx - 36, gy - 32, 72, 4);
    ctx.fillStyle = '#64748b'; ctx.fillRect(cx - 22, gy - 52, 44, 3);

    const t = simClock * 0.002;
    const angle = Math.sin(t) * Math.PI / 2.9;
    ctx.save();
    ctx.translate(cx, apex);
    ctx.rotate(angle);
    // Twin swing arms
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-5, 52); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(5, 52); ctx.stroke();
    // Hull — wide enough to read at pad scale
    const hullGrad = ctx.createLinearGradient(0, 48, 0, 82);
    hullGrad.addColorStop(0, '#f59e0b'); hullGrad.addColorStop(0.45, '#d97706'); hullGrad.addColorStop(1, '#78350f');
    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    ctx.moveTo(-44, 48);
    ctx.quadraticCurveTo(-38, 80, 0, 82);
    ctx.quadraticCurveTo(38, 80, 44, 48);
    ctx.quadraticCurveTo(24, 60, 0, 61);
    ctx.quadraticCurveTo(-24, 60, -44, 48);
    ctx.closePath(); ctx.fill();
    // Gunwale + hull planking
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-44, 48); ctx.quadraticCurveTo(0, 63, 44, 48); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,53,15,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-38, 62); ctx.quadraticCurveTo(0, 74, 38, 62); ctx.stroke();
    // Riders
    for (let i = -3; i <= 3; i++) {
        const ry = 52 + Math.abs(i) * 1.2;
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(i * 11, ry, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ['#ef4444','#3b82f6','#22c55e','#a855f7','#f97316','#ec4899','#eab308'][i + 3];
        ctx.fillRect(i * 11 - 2.6, ry + 2, 5.2, 5);
        // Arms up
        ctx.strokeStyle = '#fcd9b6'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(i * 11 - 2, ry + 2); ctx.lineTo(i * 11 - 4, ry - 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * 11 + 2, ry + 2); ctx.lineTo(i * 11 + 4, ry - 4); ctx.stroke();
    }
    // Dragon figureheads
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.moveTo(-44, 48); ctx.lineTo(-54, 36); ctx.lineTo(-40, 52); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(44, 48); ctx.lineTo(54, 36); ctx.lineTo(40, 52); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Pivot hub
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(cx, apex, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, apex, 5.5, 0, Math.PI * 2); ctx.stroke();

    // String lights along the A-frame at night
    if (isNight) {
        for (let i = 0; i <= 7; i++) {
            const k = i / 7;
            ctx.fillStyle = i % 2 ? '#fef08a' : '#7dd3fc';
            ctx.shadowBlur = 4; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(cx - 52 + k * 48, gy + 2 - k * 74, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + 52 - k * 48, gy + 2 - k * 74, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

function drawHauntedHouse(cx, cy) {
    // Dead-earth yard covering the pad, with an iron fence
    drawIsoDeck(cx, cy, 0.94, '#2a2438', '#1b1726', 3);
    drawPadFence(cx, cy - 3, 0.94, '#0f172a', 'rgba(15,23,42,0.75)');
    // Scraggly graveyard bits on the front corners of the pad
    ctx.fillStyle = '#3f3a52';
    ctx.beginPath(); ctx.roundRect(cx - 40, cy + 4, 7, 9, [3, 3, 0, 0]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 33, cy + 6, 6, 8, [3, 3, 0, 0]); ctx.fill();

    const gy = cy - 3;   // ground line on the yard
    const bw = 44;       // half-width of the house — fills the pad
    const wallTop = gy - 52;

    // Side wall (isometric depth face)
    ctx.fillStyle = '#131a2b';
    ctx.beginPath();
    ctx.moveTo(cx + bw, wallTop); ctx.lineTo(cx + bw + 10, wallTop - 8);
    ctx.lineTo(cx + bw + 10, gy - 14); ctx.lineTo(cx + bw, gy - 6);
    ctx.closePath(); ctx.fill();

    // Front facade with vertical siding
    const wallGrad = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
    wallGrad.addColorStop(0, '#161f33'); wallGrad.addColorStop(0.5, '#25304a'); wallGrad.addColorStop(1, '#161f33');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(cx - bw, wallTop, bw * 2, gy - wallTop - 4);
    ctx.strokeStyle = 'rgba(8,12,22,0.5)'; ctx.lineWidth = 1;
    for (let i = -bw + 6; i < bw; i += 9) {
        ctx.beginPath(); ctx.moveTo(cx + i, wallTop); ctx.lineTo(cx + i, gy - 4); ctx.stroke();
    }

    // Sagging gable roof, overhanging the walls
    ctx.fillStyle = '#0b1120';
    ctx.beginPath();
    ctx.moveTo(cx - bw - 8, wallTop + 2);
    ctx.quadraticCurveTo(cx - 20, wallTop - 26, cx, wallTop - 34);
    ctx.quadraticCurveTo(cx + 20, wallTop - 26, cx + bw + 8, wallTop + 2);
    ctx.closePath(); ctx.fill();
    // Roof shingle rows
    ctx.strokeStyle = 'rgba(71,85,105,0.35)'; ctx.lineWidth = 1;
    for (let r = 1; r <= 3; r++) {
        const ry = wallTop + 2 - r * 7;
        ctx.beginPath(); ctx.moveTo(cx - bw - 8 + r * 8, ry); ctx.quadraticCurveTo(cx, ry - 12, cx + bw + 8 - r * 8, ry); ctx.stroke();
    }

    // Twin towers rising from the pad corners
    [-1, 1].forEach(s => {
        const tx = cx + s * (bw - 10);
        ctx.fillStyle = '#1b2438';
        ctx.fillRect(tx - 8, wallTop - 30, 16, 42);
        ctx.fillStyle = '#0b1120';
        ctx.beginPath(); ctx.moveTo(tx - 11, wallTop - 30); ctx.lineTo(tx, wallTop - 56); ctx.lineTo(tx + 11, wallTop - 30); ctx.closePath(); ctx.fill();
        // Weathervane
        ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx, wallTop - 56); ctx.lineTo(tx, wallTop - 64); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tx - 3, wallTop - 62); ctx.lineTo(tx + 3, wallTop - 62); ctx.stroke();
    });

    // Flickering windows
    const flick = (o, sp) => Math.sin(simClock * sp + o) > -0.2;
    const litWin = (wx, wy, w, h, o, sp) => {
        const on = flick(o, sp);
        ctx.fillStyle = on ? '#fbbf24' : '#111827';
        ctx.fillRect(wx, wy, w, h);
        if (on) {
            ctx.save();
            ctx.shadowBlur = 12; ctx.shadowColor = '#f59e0b';
            ctx.fillRect(wx, wy, w, h);
            ctx.restore();
        }
        // Cross mullions
        ctx.strokeStyle = '#0b1120'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(wx + w / 2, wy); ctx.lineTo(wx + w / 2, wy + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx, wy + h / 2); ctx.lineTo(wx + w, wy + h / 2); ctx.stroke();
    };
    litWin(cx - 34, wallTop + 10, 12, 14, 0, 0.005);
    litWin(cx + 22, wallTop + 10, 12, 14, 1.4, 0.004);
    litWin(cx - 8, wallTop + 8, 16, 12, 2.6, 0.006);
    litWin(cx + (bw - 10) - 4, wallTop - 22, 8, 10, 3.3, 0.005);
    litWin(cx - (bw - 10) - 4, wallTop - 22, 8, 10, 0.8, 0.0045);

    // Arched entrance with a spilling green glow
    ctx.fillStyle = '#050810';
    ctx.beginPath(); ctx.moveTo(cx - 13, gy - 4); ctx.lineTo(cx - 13, gy - 26);
    ctx.quadraticCurveTo(cx, gy - 42, cx + 13, gy - 26); ctx.lineTo(cx + 13, gy - 4);
    ctx.closePath(); ctx.fill();
    const doorGlow = ctx.createLinearGradient(cx, gy - 26, cx, gy - 4);
    doorGlow.addColorStop(0, 'rgba(34,197,94,0)');
    doorGlow.addColorStop(1, 'rgba(74,222,128,0.4)');
    ctx.fillStyle = doorGlow;
    ctx.beginPath(); ctx.moveTo(cx - 13, gy - 4); ctx.lineTo(cx - 13, gy - 26);
    ctx.quadraticCurveTo(cx, gy - 42, cx + 13, gy - 26); ctx.lineTo(cx + 13, gy - 4);
    ctx.closePath(); ctx.fill();
    // Entry steps down to the yard
    ctx.fillStyle = '#3f3a52';
    ctx.fillRect(cx - 15, gy - 4, 30, 3);
    ctx.fillRect(cx - 18, gy - 1, 36, 3);

    // Sign board
    ctx.fillStyle = '#0b1120';
    ctx.beginPath(); ctx.roundRect(cx - 26, wallTop - 12, 52, 12, 2); ctx.fill();
    ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(cx - 26, wallTop - 12, 52, 12, 2); ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 9px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('HAUNTED', cx, wallTop - 3);

    // Bats at night
    if (isNight) {
        const bt = simClock * 0.003;
        for (let i = 0; i < 6; i++) {
            const bx = cx + Math.sin(bt + i * 1.7) * 48;
            const by = wallTop - 44 + Math.cos(bt * 0.7 + i * 1.3) * 16;
            const flap = 2 + Math.sin(bt * 6 + i) * 2;
            ctx.fillStyle = '#1e293b';
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 6, by - flap); ctx.lineTo(bx - 2, by + 1.5); ctx.fill();
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 6, by - flap); ctx.lineTo(bx + 2, by + 1.5); ctx.fill();
        }
        // Eerie mist pooling in the yard
        const mist = ctx.createLinearGradient(cx, gy - 12, cx, gy + 12);
        mist.addColorStop(0, 'rgba(74,222,128,0)');
        mist.addColorStop(1, 'rgba(74,222,128,0.13)');
        ctx.fillStyle = mist;
        ctx.beginPath(); ctx.ellipse(cx, gy + 6, PAD_W * 0.9, PAD_H * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
}

function drawFerrisWheel(cx, cy) {
    // Concrete pad + fence covering the full block
    drawIsoDeck(cx, cy, 0.92, '#3b4759', '#28313f', 4);
    drawPadFence(cx, cy - 4, 0.92, '#93c5fd', 'rgba(147,197,253,0.45)');

    const gy = cy - 4;
    const wheelR = 56;
    const hubY = gy - 66;
    const t = simClock * 0.0005;

    // Boarding platform under the wheel (front of the pad)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.ellipse(cx, gy - 4, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.ellipse(cx, gy - 6, 28, 8, 0, 0, Math.PI * 2); ctx.fill();

    // Rear A-frame legs first (depth), then front pair
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx - 34, gy - 14); ctx.lineTo(cx, hubY); ctx.lineTo(cx + 34, gy - 14); ctx.stroke();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - 46, gy + 4); ctx.lineTo(cx, hubY); ctx.lineTo(cx + 46, gy + 4); ctx.stroke();
    // Leg cross-braces
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 30, gy - 22); ctx.lineTo(cx + 30, gy - 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 18, gy - 44); ctx.lineTo(cx + 18, gy - 44); ctx.stroke();
    // Footings
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx - 51, gy + 2, 14, 5);
    ctx.fillRect(cx + 37, gy + 2, 14, 5);

    // Double rim with cross-bracing between
    ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, hubY, wheelR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, hubY, wheelR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, hubY, wheelR - 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
    // Zigzag truss between the rims
    ctx.strokeStyle = 'rgba(147,197,253,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = i % 2 ? wheelR : wheelR - 9;
        const px = cx + Math.cos(a) * r, py = hubY + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();

    // Spokes + gondolas (12 cabins)
    const colors = ['#ef4444','#3b82f6','#eab308','#22c55e','#ec4899','#8b5cf6','#f97316','#06b6d4','#f43f5e','#a3e635','#38bdf8','#fbbf24'];
    for (let i = 0; i < 12; i++) {
        const angle = t + i * (Math.PI * 2 / 12);
        const sx = cx + Math.cos(angle) * (wheelR - 9);
        const sy = hubY + Math.sin(angle) * (wheelR - 9);
        ctx.beginPath(); ctx.moveTo(cx, hubY); ctx.lineTo(sx, sy);
        ctx.strokeStyle = 'rgba(203,213,225,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
        const gx = cx + Math.cos(angle) * wheelR;
        const gyy = hubY + Math.sin(angle) * wheelR;
        // Hanger — gondolas always hang level
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(gx, gyy); ctx.lineTo(gx, gyy + 4); ctx.stroke();
        // Cabin with canopy, body, and passengers
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.roundRect(gx - 7.5, gyy + 4, 15, 5, [3, 3, 0, 0]); ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath(); ctx.roundRect(gx - 7, gyy + 8, 14, 7, [0, 0, 4, 4]); ctx.fill();
        ctx.fillStyle = 'rgba(15,23,42,0.35)';
        ctx.fillRect(gx - 5, gyy + 9.5, 10, 3.5);
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(gx - 2.5, gyy + 10.5, 1.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 2.5, gyy + 10.5, 1.3, 0, Math.PI * 2); ctx.fill();
    }

    // Hub with spinner detail
    ctx.beginPath(); ctx.arc(cx, hubY, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171'; ctx.fill();
    ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
        const a = t * 6 + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(cx, hubY); ctx.lineTo(cx + Math.cos(a) * 7, hubY + Math.sin(a) * 7); ctx.stroke();
    }

    // Night lights chasing the rim + spoke tips
    if (isNight) {
        for (let i = 0; i < 28; i++) {
            const la = (i / 28) * Math.PI * 2;
            const lit = (Math.floor(simClock * 0.004 + i * 0.5) % 3) !== 0;
            ctx.beginPath(); ctx.arc(cx + Math.cos(la) * wheelR, hubY + Math.sin(la) * wheelR, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = lit ? (i % 2 ? '#fef08a' : '#f0abfc') : 'rgba(148,163,184,0.4)';
            if (lit) { ctx.shadowBlur = 6; ctx.shadowColor = ctx.fillStyle; }
            ctx.fill(); ctx.shadowBlur = 0;
        }
    }
}

function drawCoaster(cx, cy) {
    // Gravel pad + perimeter fence across the whole block
    drawIsoDeck(cx, cy, 0.94, '#3a4557', '#27303d', 4);
    drawPadFence(cx, cy - 4, 0.94, '#f87171', 'rgba(248,113,113,0.4)');

    const gy = cy - 4;

    // Track profile, sampled once and reused. Spans the pad's full width.
    if (!coasterPath) {
        const pts = [];
        const seg = (x0, y0, x1, y1, x2, y2, n) => {
            for (let i = 0; i <= n; i++) {
                const u = i / n, v = 1 - u;
                pts.push({ x: v * v * x0 + 2 * v * u * x1 + u * u * x2, y: v * v * y0 + 2 * v * u * y1 + u * u * y2 });
            }
        };
        seg(-58, 2, -52, -104, -14, -28, 26);   // lift hill
        seg(-14, -28, 4, 10, 20, -20, 16);      // valley dip
        seg(20, -20, 38, -62, 58, 2, 22);       // airtime hill → station
        coasterPath = pts;
    }
    const path = coasterPath;

    // Lattice support towers from track down to the pad
    for (let i = 3; i < path.length - 3; i += 6) {
        const p = path[i];
        if (p.y > -10) continue;
        const topY = gy + p.y + 2, botY = gy + 2;
        ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + p.x - 3, topY); ctx.lineTo(cx + p.x - 4, botY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + p.x + 3, topY); ctx.lineTo(cx + p.x + 4, botY); ctx.stroke();
        // Zigzag bracing
        ctx.strokeStyle = 'rgba(71,85,105,0.8)'; ctx.lineWidth = 1;
        const rungs = Math.max(2, Math.floor((botY - topY) / 9));
        for (let r = 0; r < rungs; r++) {
            const y0 = topY + (botY - topY) * (r / rungs);
            const y1 = topY + (botY - topY) * ((r + 1) / rungs);
            ctx.beginPath(); ctx.moveTo(cx + p.x - 3.5, y0); ctx.lineTo(cx + p.x + 3.5, y1); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + p.x + 3.5, y0); ctx.lineTo(cx + p.x - 3.5, y1); ctx.stroke();
        }
        // Footing
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx + p.x - 6, botY - 1, 12, 3);
    }

    // Track: dark spine, ties, twin bright rails
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 6;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y) : ctx.moveTo(cx + p.x, gy + p.y));
    ctx.stroke();
    ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 1.2;
    for (let i = 0; i < path.length; i += 2) {
        const p = path[i];
        ctx.beginPath();
        ctx.moveTo(cx + p.x - 3, gy + p.y + 2.5);
        ctx.lineTo(cx + p.x + 3, gy + p.y - 3.5);
        ctx.stroke();
    }
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y - 3) : ctx.moveTo(cx + p.x, gy + p.y - 3));
    ctx.stroke();
    ctx.strokeStyle = '#fecaca'; ctx.lineWidth = 1;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y - 4.5) : ctx.moveTo(cx + p.x, gy + p.y - 4.5));
    ctx.stroke();

    // Chain-lift dogs on the climb
    ctx.strokeStyle = 'rgba(226,232,240,0.5)'; ctx.lineWidth = 1;
    for (let i = 2; i < 24; i += 3) {
        const p = path[i];
        ctx.beginPath(); ctx.moveTo(cx + p.x - 1, gy + p.y + 1); ctx.lineTo(cx + p.x + 1, gy + p.y - 1); ctx.stroke();
    }

    // Station house on the pad's front-right, with platform
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx + 30, gy - 22, 30, 20);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(cx + 30, gy - 2, 34, 4);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.moveTo(cx + 26, gy - 22); ctx.lineTo(cx + 45, gy - 34); ctx.lineTo(cx + 64, gy - 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(cx + 36, gy - 16, 7, 9);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(cx + 48, gy - 16, 8, 14);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('COASTER', cx + 45, gy - 24);

    // Train — 4 linked cars riding the real track, tilting with the slope
    const T = (simClock % 4600) / 4600;
    const idx = Math.floor(T * (path.length - 1));
    for (let c = 3; c >= 0; c--) {
        const i = Math.max(0, idx - c * 3);
        const p = path[i];
        const pn = path[Math.min(path.length - 1, i + 1)];
        const ang = Math.atan2(pn.y - p.y, pn.x - p.x);
        ctx.save();
        ctx.translate(cx + p.x, gy + p.y - 6);
        ctx.rotate(ang);
        ctx.fillStyle = c === 0 ? '#60a5fa' : '#2563eb';
        ctx.beginPath(); ctx.roundRect(-6, -4.5, 12, 7, 2); ctx.fill();
        ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-6, 1, 12, 2);
        // Riders with arms up
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(-2, -6, 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(2.5, -6, 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fcd9b6'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(-3, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2.5, -7); ctx.lineTo(3.5, -10); ctx.stroke();
        ctx.restore();
    }

    // Track bulbs at night
    if (isNight) {
        for (let i = 0; i < path.length; i += 6) {
            const p = path[i];
            ctx.fillStyle = (Math.floor(simClock * 0.003 + i) % 2) ? '#fef08a' : '#fb7185';
            ctx.shadowBlur = 5; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(cx + p.x, gy + p.y - 7, 1.3, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// ── Shops & Services ──

// Deterministic per-tile variation (world coords are stable per tile)
function tileHash(cx, cy) {
    const n = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

// Shared kiosk shell — gives every shop the same solid iso construction
// (deck, side wall, body, counter, scalloped awning, server) so details
// are all that differ between them.
function drawKiosk(cx, cy, c) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, c.deck, c.deckSide, 4);
    setPad(2);
    const gy = cy - 4;

    // Side wall for isometric depth
    ctx.fillStyle = c.wallDark;
    ctx.beginPath();
    ctx.moveTo(cx + 15, gy - 28); ctx.lineTo(cx + 22, gy - 34);
    ctx.lineTo(cx + 22, gy - 12); ctx.lineTo(cx + 15, gy - 6);
    ctx.closePath(); ctx.fill();

    // Body + interior shadow
    ctx.fillStyle = c.wall;
    ctx.fillRect(cx - 15, gy - 28, 30, 22);
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    ctx.fillRect(cx - 12, gy - 25, 24, 11);

    // Server behind the counter
    ctx.fillStyle = c.uniform || '#f8fafc';
    ctx.beginPath(); ctx.roundRect(cx - 3.5, gy - 21, 7, 8, 2); ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath(); ctx.arc(cx, gy - 23, 2.6, 0, Math.PI * 2); ctx.fill();
    if (c.hat) { ctx.fillStyle = c.hat; ctx.beginPath(); ctx.roundRect(cx - 3, gy - 26.5, 6, 2.6, 1); ctx.fill(); }

    // Counter slab + front face
    ctx.fillStyle = c.counterTop;
    ctx.fillRect(cx - 18, gy - 14, 36, 3);
    ctx.fillStyle = c.counter;
    ctx.fillRect(cx - 16, gy - 11, 32, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(cx - 16, gy - 6, 32, 1.5);

    // Scalloped striped awning
    ctx.fillStyle = c.awning;
    ctx.beginPath();
    ctx.moveTo(cx - 21, gy - 15); ctx.lineTo(cx - 16, gy - 30);
    ctx.lineTo(cx + 16, gy - 30); ctx.lineTo(cx + 21, gy - 15);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.awningAlt;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 7.4 - 2, gy - 30); ctx.lineTo(cx + i * 7.4 + 1.6, gy - 30);
        ctx.lineTo(cx + i * 8.6 + 2, gy - 15); ctx.lineTo(cx + i * 8.6 - 2.4, gy - 15);
        ctx.closePath(); ctx.fill();
    }
    // Scalloped hem
    ctx.fillStyle = c.awning;
    for (let i = -4; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(cx + i * 5.2, gy - 15, 2.6, 0, Math.PI); ctx.fill();
    }
    return gy;
}

function drawFoodStall(cx, cy) {
    const gy = drawKiosk(cx, cy, {
        deck: '#a16207', deckSide: '#713f12',
        wall: '#b45309', wallDark: '#7c2d12',
        counterTop: '#fde68a', counter: '#92400e',
        awning: '#dc2626', awningAlt: '#fef2f2',
        uniform: '#f8fafc', hat: '#ffffff'
    });
    // Menu board
    ctx.fillStyle = '#1c1917';
    ctx.beginPath(); ctx.roundRect(cx - 13, gy - 25, 11, 9, 1); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    for (let i = 0; i < 3; i++) ctx.fillRect(cx - 11.5, gy - 23 + i * 2.4, 7 - i, 1);
    // Griddle with sizzling burgers + heat wisp
    ctx.fillStyle = '#27272a'; ctx.fillRect(cx + 1, gy - 16.5, 11, 2.5);
    ctx.fillStyle = '#78350f';
    ctx.beginPath(); ctx.arc(cx + 4, gy - 17, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 9, gy - 17, 1.6, 0, Math.PI * 2); ctx.fill();
    const t = simClock * 0.002;
    ctx.strokeStyle = 'rgba(226,232,240,0.4)'; ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
        const ph = (t * 0.4 + i * 0.5) % 1;
        ctx.beginPath();
        ctx.moveTo(cx + 4 + i * 5, gy - 18);
        ctx.quadraticCurveTo(cx + 6 + i * 5 + Math.sin(t * 3 + i) * 2, gy - 22 - ph * 6, cx + 4 + i * 5, gy - 26 - ph * 6);
        ctx.globalAlpha = 1 - ph; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // Rooftop burger sign
    ctx.fillStyle = '#78350f';
    ctx.beginPath(); ctx.ellipse(cx, gy - 33, 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.ellipse(cx, gy - 35, 6, 3.4, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#4ade80'; ctx.fillRect(cx - 5.5, gy - 33.4, 11, 1.2);
    ctx.fillStyle = '#fef3c7';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - 3 + i * 3, gy - 36.5, 0.5, 0, Math.PI * 2); ctx.fill(); }
}

function drawDrinkStall(cx, cy) {
    const gy = drawKiosk(cx, cy, {
        deck: '#0369a1', deckSide: '#075985',
        wall: '#0284c7', wallDark: '#0c4a6e',
        counterTop: '#e0f2fe', counter: '#075985',
        awning: '#0ea5e9', awningAlt: '#f0f9ff',
        uniform: '#bae6fd', hat: '#0ea5e9'
    });
    // Soda fountain taps
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(cx - 13, gy - 24, 10, 8);
    ctx.fillStyle = '#334155';
    for (let i = 0; i < 3; i++) ctx.fillRect(cx - 11.5 + i * 3, gy - 18, 1.4, 2.4);
    // Cup pyramid on the counter
    const cupCols = ['#f8fafc', '#f8fafc', '#f8fafc'];
    cupCols.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx + 3 + i * 4, gy - 14); ctx.lineTo(cx + 6.4 + i * 4, gy - 14);
        ctx.lineTo(cx + 5.8 + i * 4, gy - 19); ctx.lineTo(cx + 3.6 + i * 4, gy - 19);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ef4444'; ctx.fillRect(cx + 4.4 + i * 4, gy - 21.5, 0.9, 2.6);
    });
    // Ice cooler
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(cx - 16, gy - 5, 8, 4, 1); ctx.fill();
    ctx.fillStyle = '#7dd3fc'; ctx.fillRect(cx - 15, gy - 4.5, 6, 1);
    // Giant cup sign with bubbles
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(cx - 5, gy - 32); ctx.lineTo(cx + 5, gy - 32);
    ctx.lineTo(cx + 3.6, gy - 43); ctx.lineTo(cx - 3.6, gy - 43);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0ea5e9'; ctx.fillRect(cx - 4.4, gy - 40, 8.8, 7);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(cx + 1.5, gy - 48, 1.6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const bt = simClock * 0.003;
    for (let i = 0; i < 3; i++) {
        const bp = (bt + i * 0.33) % 1;
        ctx.beginPath(); ctx.arc(cx - 2 + i * 2, gy - 33 - bp * 6, 0.9, 0, Math.PI * 2); ctx.fill();
    }
}

function drawRestroom(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#64748b', '#3f4a5a', 4);
    setPad(2);
    const gy = cy - 4;
    // Side wall
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(cx + 14, gy - 26); ctx.lineTo(cx + 21, gy - 32);
    ctx.lineTo(cx + 21, gy - 8); ctx.lineTo(cx + 14, gy - 2);
    ctx.closePath(); ctx.fill();
    // Brick front wall
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx - 14, gy - 26, 28, 24);
    ctx.strokeStyle = 'rgba(71,85,105,0.4)'; ctx.lineWidth = 0.75;
    for (let r = 0; r < 6; r++) {
        const ry = gy - 24 + r * 4;
        ctx.beginPath(); ctx.moveTo(cx - 14, ry); ctx.lineTo(cx + 14, ry); ctx.stroke();
        for (let b = 0; b < 4; b++) {
            const bx = cx - 14 + b * 7 + (r % 2 ? 3.5 : 0);
            ctx.beginPath(); ctx.moveTo(bx, ry); ctx.lineTo(bx, ry + 4); ctx.stroke();
        }
    }
    // Overhanging roof + vent pipe
    ctx.fillStyle = '#475569';
    ctx.beginPath(); ctx.moveTo(cx - 18, gy - 26); ctx.lineTo(cx, gy - 36); ctx.lineTo(cx + 22, gy - 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.fillRect(cx - 18, gy - 27, 40, 2);
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(cx + 7, gy - 42, 2.6, 8);
    ctx.beginPath(); ctx.ellipse(cx + 8.3, gy - 42, 2.6, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    // Two doorways with pictogram signs
    ([[-7, '#3b82f6'], [7, '#ec4899']] as [number, string][]).forEach(([ox, col]) => {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx + ox - 4.5, gy - 18, 9, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(cx + ox - 3.5, gy - 17, 7, 15);
        // Sign plate + figure
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.roundRect(cx + ox - 3.5, gy - 24, 7, 5, 1); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx + ox, gy - 22.4, 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(cx + ox - 0.9, gy - 21.2, 1.8, 2.4);
        // Door handle
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx + ox + (ox > 0 ? -3 : 2), gy - 11, 1.2, 1.2);
    });
    // WC placard
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.roundRect(cx - 8, gy - 33, 16, 6, 1); ctx.fill();
    ctx.fillStyle = '#e0f2fe'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('RESTROOM', cx, gy - 28.5);
    if (isNight) {
        ctx.fillStyle = '#4ade80';
        ctx.shadowBlur = 8; ctx.shadowColor = '#22c55e';
        ctx.beginPath(); ctx.arc(cx, gy - 30, 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }
}

function drawBalloonStand(cx, cy) {
    setPad(1);
    drawIsoDeck(cx, cy, 0.98, '#9f1239', '#6b0f2a', 4);
    setPad(2);
    const gy = cy - 4;
    const t = simClock * 0.002;

    // Vendor cart with wheels and a striped skirt
    ctx.fillStyle = '#881337';
    ctx.beginPath(); ctx.roundRect(cx - 11, gy - 13, 22, 11, 2); ctx.fill();
    ctx.fillStyle = '#be123c';
    for (let i = 0; i < 5; i++) ctx.fillRect(cx - 10 + i * 4.4, gy - 12, 2.2, 9);
    ctx.fillStyle = '#fecdd3'; ctx.fillRect(cx - 12, gy - 15, 24, 2.5);
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(cx - 7, gy - 1.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 7, gy - 1.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath(); ctx.arc(cx - 7, gy - 1.5, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 7, gy - 1.5, 0.9, 0, Math.PI * 2); ctx.fill();

    // Vendor standing beside the cart
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath(); ctx.roundRect(cx - 16, gy - 16, 6, 9, 2); ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath(); ctx.arc(cx - 13, gy - 18.5, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e11d48';
    ctx.beginPath(); ctx.roundRect(cx - 16, gy - 21.5, 6, 2.6, 1); ctx.fill();

    // Balloon bouquet on strings from the cart post
    ctx.fillStyle = '#78716c'; ctx.fillRect(cx + 9, gy - 30, 1.5, 17);
    const cols = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#ec4899', '#f97316'];
    for (let i = 0; i < 7; i++) {
        const ang = -0.9 + (i / 6) * 1.8;
        const dist = 12 + (i % 3) * 5;
        const bx = cx + 9.7 + Math.sin(ang + Math.sin(t + i) * 0.06) * dist;
        const by = gy - 32 - Math.cos(ang) * dist + Math.sin(t * 1.2 + i) * 1.6;
        ctx.strokeStyle = 'rgba(203,213,225,0.55)'; ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx + 9.7, gy - 30);
        ctx.quadraticCurveTo((cx + 9.7 + bx) / 2 + 2, (gy - 30 + by) / 2, bx, by + 4.2);
        ctx.stroke();
        // Balloon with highlight and knot
        ctx.fillStyle = cols[i];
        ctx.beginPath(); ctx.ellipse(bx, by, 3.6, 4.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.ellipse(bx - 1.2, by - 1.6, 1.1, 1.5, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = cols[i];
        ctx.beginPath(); ctx.moveTo(bx - 1, by + 4.2); ctx.lineTo(bx + 1, by + 4.2); ctx.lineTo(bx, by + 5.6); ctx.closePath(); ctx.fill();
    }
}

// ── Go-Karts (2×2) ──

function drawGoKarts(cx, cy) {
    // The track IS the pad — asphalt diamond covering the whole block
    drawIsoDeck(cx, cy, 0.96, '#2f3947', '#1f262f', 3);

    const gy = cy - 3;
    // Track ring drawn in the pad's isometric proportions (2:1)
    const RX = PAD_W * 0.78, RY = PAD_H * 0.78;
    const IX = PAD_W * 0.40, IY = PAD_H * 0.40;

    // Asphalt ring with an infield hole
    ctx.beginPath();
    ctx.ellipse(cx, gy, RX, RY, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, gy, IX, IY, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = '#3f4854';
    ctx.fill('evenodd');
    // Rubber-marked racing line
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.ellipse(cx, gy, (RX + IX) / 2, (RY + IY) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    // Center dashes
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = 'rgba(229,231,235,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, gy, (RX + IX) / 2, (RY + IY) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Red/white kerbing, outer and inner
    const kerb = (rx, ry, n) => {
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2;
            ctx.strokeStyle = i % 2 ? '#f8fafc' : '#ef4444';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(cx, gy, rx, ry, 0, a0, a1); ctx.stroke();
        }
    };
    kerb(RX, RY, 24);
    kerb(IX, IY, 16);

    // Grass infield with tire stacks and a hay bale
    ctx.fillStyle = '#14532d';
    ctx.beginPath(); ctx.ellipse(cx, gy, IX - 2, IY - 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.beginPath(); ctx.ellipse(cx - 4, gy - 2, IX * 0.5, IY * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a';
    [[-8, -2], [7, 2], [1, -4]].forEach(([ox, oy]) => {
        ctx.beginPath(); ctx.ellipse(cx + ox, gy + oy, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#d4a72c';
    ctx.beginPath(); ctx.roundRect(cx - 3, gy + 4, 8, 4, 1); ctx.fill();

    // Start/finish gantry straddling the front straight
    const gantryY = gy + RY - 4;
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx - 30, gantryY - 30, 3, 30);
    ctx.fillRect(cx + 27, gantryY - 30, 3, 30);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - 30, gantryY - 34, 60, 5);
    for (let fx = 0; fx < 15; fx++) {
        for (let fy = 0; fy < 2; fy++) {
            ctx.fillStyle = (fx + fy) % 2 === 0 ? '#0f172a' : '#f8fafc';
            ctx.fillRect(cx - 30 + fx * 4, gantryY - 34 + fy * 2.5, 4, 2.5);
        }
    }
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('GO-KARTS', cx, gantryY - 37);
    // Start/finish line painted on the asphalt
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#f8fafc' : '#334155';
        ctx.fillRect(cx - 6 + (i % 2) * 3, gy + IY + (i / 6) * (RY - IY), 3, 2.5);
    }

    // 5 karts racing, sorted so near-side ones draw last
    const t = simClock * 0.0012;
    const kcolors = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7'];
    const karts = [];
    for (let i = 0; i < 5; i++) {
        const a = t * (1 + i * 0.05) + i * 1.28;
        karts.push({ a, i, y: Math.sin(a) });
    }
    karts.sort((p, q) => p.y - q.y);
    for (const k of karts) {
        const lane = (k.i % 2) ? 0.93 : 0.72;
        const kx = cx + Math.cos(k.a) * ((RX + IX) / 2) * (lane * 1.06);
        const ky = gy + Math.sin(k.a) * ((RY + IY) / 2) * (lane * 1.06);
        if (isNight) {
            const dx = -Math.sin(k.a), dy = Math.cos(k.a) * 0.5;
            const g = ctx.createRadialGradient(kx, ky, 0, kx + dx * 16, ky + dy * 16, 16);
            g.addColorStop(0, 'rgba(254,240,138,0.4)');
            g.addColorStop(1, 'rgba(254,240,138,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(kx + dx * 9, ky + dy * 9, 16, 0, Math.PI * 2); ctx.fill();
        }
        // Shadow + tires
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(kx, ky + 3, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.ellipse(kx - 5, ky + 2, 2.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(kx + 5, ky + 2, 2.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
        // Chassis + nose cone
        ctx.fillStyle = kcolors[k.i];
        ctx.beginPath(); ctx.roundRect(kx - 7, ky - 4, 14, 7, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(kx - 6, ky - 3.5, 12, 1.5);
        // Driver: seat, torso, helmet with visor
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.roundRect(kx - 3, ky - 8, 6, 5, 2); ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath(); ctx.arc(kx, ky - 8.5, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(kx, ky - 8, 2.6, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
        // Rear wing
        ctx.fillStyle = '#334155';
        ctx.fillRect(kx - 4, ky - 6, 8, 1.5);
    }
}

// ── Breakdown smoke + alert ──

function drawBreakdownSmoke(cx, cy) {
    const t = simClock * 0.001;
    for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i * 0.33) % 1;
        const sx = cx + Math.sin(t + i * 2) * 4;
        const sy = cy - 30 - ph * 25;
        ctx.beginPath();
        ctx.arc(sx, sy, 4 + ph * 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100, 116, 139, ${0.5 * (1 - ph)})`;
        ctx.fill();
    }
    // Bouncing alert
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', cx, cy - 62 + Math.sin(t * 4) * 2);
}

// ── Rain overlay (screen-space) ──

function drawRainFX() {
    const target = S.weather === 'rain' ? 0.5 : 0;
    rainAlpha += (target - rainAlpha) * 0.03;
    if (rainAlpha < 0.02) { rainDrops.length = 0; return; }
    while (rainDrops.length < 110) {
        rainDrops.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: 6 + Math.random() * 8 });
    }
    ctx.strokeStyle = `rgba(147, 184, 216, ${rainAlpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d of rainDrops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2, d.y + d.s);
        d.y += d.s;
        d.x -= 1.5;
        if (d.y > canvas.height) { d.y = -10; d.x = Math.random() * (canvas.width + 40); }
    }
    ctx.stroke();
}

// ── Hover tooltip for rides & shops (screen-space) ──

function drawTooltip() {
    const { x, y } = hoveredCell;
    if (x < 0 || y < 0 || x >= S.gridSize || y >= S.gridSize) return;
    const cell = S.map[x]?.[y];
    if (!cell || (!RIDE_TYPES.has(cell) && !SHOP_TYPES.has(cell))) return;
    const a = S.anchorOf[`${x},${y}`] || { ax: x, ay: y };
    const aKey = `${a.ax},${a.ay}`;
    const lines = [(S.rideNames[aKey] || TYPE_LABEL[cell] || cell).toUpperCase()];
    if (RIDE_TYPES.has(cell)) {
        const q = S.rideQueues[aKey];
        if (q) lines.push(q.broken ? 'BROKEN — mechanic en route' : `Queue: ${q.queue}  |  Riding: ${q.ridersOnBoard}`);
    } else {
        const sd = BUILD_DATA[cell];
        lines.push(`Shop — $${sd.price} per sale`);
    }
    lines.push('click to inspect');
    const w = 176, h = 12 + lines.length * 14;
    let tx = mouseX + 14, ty = mouseY - h - 8;
    if (tx + w > canvas.width) tx = mouseX - w - 14;
    if (ty < 0) ty = mouseY + 16;
    ctx.fillStyle = 'rgba(15,23,42,0.88)';
    ctx.beginPath(); ctx.roundRect(tx, ty, w, h, 6); ctx.fill();
    ctx.textAlign = 'left';
    lines.forEach((ln, i) => {
        ctx.fillStyle = i === 0 ? '#93c5fd' : ln.startsWith('BROKEN') ? '#f87171' : ln === 'click to inspect' ? '#64748b' : '#e2e8f0';
        ctx.font = i === 0 ? 'bold 10px monospace' : '9px monospace';
        ctx.fillText(ln, tx + 9, ty + 16 + i * 14);
    });
}

// ── MEGA COASTER (4×4) — the park's headliner ──
function drawMegaCoaster(cx, cy) {
    drawIsoDeck(cx, cy, 0.96, '#39424f', '#252c36', 5);
    drawPadFence(cx, cy - 5, 0.96, '#fb7185', 'rgba(251,113,133,0.4)');
    const gy = cy - 5;

    // Track: lift hill → drop → vertical loop → airtime hill → brake run
    if (!megaCoasterPath) {
        const pts = [];
        const q = (x0, y0, x1, y1, x2, y2, n) => {
            for (let i = 1; i <= n; i++) {
                const u = i / n, v = 1 - u;
                pts.push({ x: v*v*x0 + 2*v*u*x1 + u*u*x2, y: v*v*y0 + 2*v*u*y1 + u*u*y2 });
            }
        };
        pts.push({ x: -120, y: 6 });
        q(-120, 6, -114, -110, -86, -152, 26);      // lift hill
        q(-86, -152, -62, -164, -44, -62, 18);      // first drop
        q(-44, -62, -24, -8, 0, -10, 12);           // into the loop bottom
        // Vertical loop, center (0,-52) r 42, swept from the bottom
        const LC = { x: 0, y: -52 }, LR = 42;
        for (let i = 1; i <= 32; i++) {
            const a = Math.PI / 2 + (i / 32) * Math.PI * 2;
            pts.push({ x: LC.x + Math.cos(a) * LR, y: LC.y + Math.sin(a) * LR });
        }
        q(0, -10, 26, -8, 48, -56, 16);             // airtime hill up
        q(48, -56, 68, -96, 90, -42, 18);           // crest and down
        q(90, -42, 108, -14, 120, 6, 12);           // brake run into station
        megaCoasterPath = pts;
        megaCoasterLoop = { c: LC, r: LR };
    }
    const path = megaCoasterPath;
    const loop = megaCoasterLoop;

    // Lattice support towers (skip the loop's own span — it self-supports)
    for (let i = 2; i < path.length - 2; i += 5) {
        const p = path[i];
        if (p.y > -14) continue;
        const inLoop = Math.hypot(p.x - loop.c.x, p.y - loop.c.y) < loop.r + 6;
        if (inLoop) continue;
        const topY = gy + p.y + 2, botY = gy + 3;
        ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + p.x - 4, topY); ctx.lineTo(cx + p.x - 5, botY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + p.x + 4, topY); ctx.lineTo(cx + p.x + 5, botY); ctx.stroke();
        ctx.strokeStyle = 'rgba(71,85,105,0.85)'; ctx.lineWidth = 1;
        const rungs = Math.max(2, Math.floor((botY - topY) / 11));
        for (let r = 0; r < rungs; r++) {
            const y0 = topY + (botY - topY) * (r / rungs), y1 = topY + (botY - topY) * ((r + 1) / rungs);
            ctx.beginPath(); ctx.moveTo(cx + p.x - 4.5, y0); ctx.lineTo(cx + p.x + 4.5, y1); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + p.x + 4.5, y0); ctx.lineTo(cx + p.x - 4.5, y1); ctx.stroke();
        }
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx + p.x - 7, botY - 1, 14, 4);
    }
    // The loop's support spine
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx + loop.c.x, gy + loop.c.y + loop.r); ctx.lineTo(cx + loop.c.x, gy + 3); ctx.stroke();
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 16, gy + 3); ctx.lineTo(cx + loop.c.x, gy + loop.c.y + 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 16, gy + 3); ctx.lineTo(cx + loop.c.x, gy + loop.c.y + 18); ctx.stroke();

    // Track: spine, ties, twin rails
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#831843'; ctx.lineWidth = 7;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y) : ctx.moveTo(cx + p.x, gy + p.y));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(253,164,175,0.9)'; ctx.lineWidth = 1.3;
    for (let i = 0; i < path.length; i += 2) {
        const p = path[i];
        ctx.beginPath(); ctx.moveTo(cx + p.x - 3.5, gy + p.y + 3); ctx.lineTo(cx + p.x + 3.5, gy + p.y - 4); ctx.stroke();
    }
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y - 3.5) : ctx.moveTo(cx + p.x, gy + p.y - 3.5));
    ctx.stroke();
    ctx.strokeStyle = '#fecdd3'; ctx.lineWidth = 1;
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(cx + p.x, gy + p.y - 5) : ctx.moveTo(cx + p.x, gy + p.y - 5));
    ctx.stroke();

    // Chain lift on the climb
    ctx.strokeStyle = 'rgba(226,232,240,0.55)'; ctx.lineWidth = 1;
    for (let i = 2; i < 26; i += 3) {
        const p = path[i];
        ctx.beginPath(); ctx.moveTo(cx + p.x - 1.5, gy + p.y + 1); ctx.lineTo(cx + p.x + 1.5, gy + p.y - 1.5); ctx.stroke();
    }

    // Station building + covered queue house on the pad's front-right
    ctx.fillStyle = '#1e293b'; ctx.fillRect(cx + 84, gy - 28, 40, 26);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(cx + 80, gy - 2, 48, 5);
    ctx.fillStyle = '#e11d48';
    ctx.beginPath(); ctx.moveTo(cx + 78, gy - 28); ctx.lineTo(cx + 104, gy - 44); ctx.lineTo(cx + 130, gy - 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(cx + 92, gy - 21, 8, 11);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(cx + 106, gy - 21, 10, 19);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MEGA COASTER', cx + 104, gy - 32);
    // Switchback queue rails
    ctx.strokeStyle = 'rgba(148,163,184,0.55)'; ctx.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
        ctx.beginPath(); ctx.moveTo(cx + 60, gy + 4 + r * 5); ctx.lineTo(cx + 82, gy + 4 + r * 5); ctx.stroke();
    }

    // Train — 5 cars on the real track, banking through the loop
    const T = (simClock % 7000) / 7000;
    const idx = Math.floor(T * (path.length - 1));
    for (let c = 4; c >= 0; c--) {
        const i = Math.max(0, idx - c * 3);
        const p = path[i], pn = path[Math.min(path.length - 1, i + 1)];
        const ang = Math.atan2(pn.y - p.y, pn.x - p.x);
        ctx.save();
        ctx.translate(cx + p.x, gy + p.y - 7);
        ctx.rotate(ang);
        ctx.fillStyle = c === 0 ? '#fb7185' : '#e11d48';
        ctx.beginPath(); ctx.roundRect(-7, -5, 14, 8, 2.5); ctx.fill();
        ctx.fillStyle = '#881337'; ctx.fillRect(-7, 1.5, 14, 2);
        ctx.fillStyle = '#fcd9b6';
        ctx.beginPath(); ctx.arc(-2.5, -6.5, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(2.5, -6.5, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fcd9b6'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-2.5, -7.5); ctx.lineTo(-4, -11); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2.5, -7.5); ctx.lineTo(4, -11); ctx.stroke();
        ctx.restore();
    }

    // Night bulbs along the whole layout
    if (isNight) {
        for (let i = 0; i < path.length; i += 5) {
            const p = path[i];
            ctx.fillStyle = (Math.floor(simClock * 0.003 + i) % 2) ? '#fef08a' : '#fb7185';
            ctx.shadowBlur = 6; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(cx + p.x, gy + p.y - 8, 1.4, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// Queue visualization — draw small dots near ride
function drawRideQueue(ax, ay, queueCount, sz) {
    if (queueCount <= 0) return;
    const n = sz || 1;
    const center = blockCenter(ax, ay, n);
    const ph = padHalf(n);
    const dots = Math.min(queueCount, 14);
    for (let i = 0; i < dots; i++) {
        const angle = (i / dots) * Math.PI * 2;
        const r = 8 + (i % 3) * 3;
        const qx = center.x + Math.cos(angle) * (ph.w * 0.72 + r);
        const qy = center.y + Math.sin(angle) * (ph.h * 0.72 + r);
        ctx.beginPath();
        ctx.arc(qx, qy - 2, 2, 0, Math.PI*2);
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
    }
}

// ────── Fireworks System ──────

class FireworkShell {
    x: number; y: number; targetY: number;
    speed: number; color: string;
    trail: { x: number; y: number; alpha: number }[];
    alive: boolean;

    constructor() {
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
        this.trail.forEach(t => t.alpha *= 0.85);
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
            if (style === 1) speed = 2.5 + Math.random() * 0.5;           // ring: uniform speed
            if (style === 2) speed = (i % 5 === 0) ? 4 : 1.5 + Math.random(); // star: long points
            const c = (i % 3 === 0) ? color2 : this.color;
            fireworkParticles.push(new FireworkParticle(this.x, this.y, angle, speed, c));
        }
    }
    draw() {
        // Trail
        for (let t of this.trail) {
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

class FireworkParticle {
    x: number; y: number;
    vx: number; vy: number;
    color: string;
    alpha: number; decay: number; gravity: number;
    size: number; sparkle: boolean;

    constructor(x, y, angle, speed, color) {
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.color = color;
        this.alpha = 1;
        this.decay = 0.012 + Math.random() * 0.015;
        this.gravity = 0.03;
        this.size = 1.5 + Math.random() * 1.5;
        this.sparkle = Math.random() > 0.7;  // some particles twinkle
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += this.gravity;
        this.vx *= 0.98;
        this.vy *= 0.98;
        this.alpha -= this.decay;
    }
    draw() {
        if (this.alpha <= 0) return;
        const flickr = this.sparkle ? (0.5 + Math.sin(simClock * 0.02 + this.x) * 0.5) : 1;
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

function updateFireworks() {
    // Launch new shells periodically during the show
    if (fireworksActive && Math.random() < 0.12) {
        fireworkShells.push(new FireworkShell());
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

function drawFireworks() {
    for (let s of fireworkShells) s.draw();
    for (let p of fireworkParticles) p.draw();
}

// ────── Sprite table ──────
// id -> how to draw it. Replaces the two `else if (cell === '...')` chains the
// renderer used to carry (one for 1x1, one for multi-tile), which meant adding a
// ride touched the renderer in two places and silently drew nothing if you
// missed one.
//
// Kept separate from content/ on purpose: content/ is pure data with no canvas
// dependency, so a headless simulation -- and the server's save validation --
// can import it. Phase 4 splits this into render/sprites/<id>.ts.
type SpriteFn = (cx: number, cy: number) => void;

const SPRITES: Record<string, SpriteFn> = {
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

// ────── Main Render Loop ──────

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = document.documentElement.classList.contains('dark');
    const na = window._nightAlpha || 0;
    const lampGlows = []; // world positions of lamps, collected during the grid pass

    // Draw sky background (canvas CSS bg is static, so we paint over it)
    if (na > 0) {
        // Night sky gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (isDark) {
            skyGrad.addColorStop(0, `rgba(3, 7, 18, ${na})`);
            skyGrad.addColorStop(1, `rgba(15, 23, 42, ${na * 0.5})`);
        } else {
            skyGrad.addColorStop(0, `rgba(15, 23, 60, ${na})`);
            skyGrad.addColorStop(1, `rgba(30, 41, 80, ${na * 0.7})`);
        }
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Stars — seeded pseudo-random positions based on canvas size
        if (na > 0.2) {
            const starAlpha = Math.min(1, (na - 0.2) * 3);
            const starCount = 60;
            for (let i = 0; i < starCount; i++) {
                // Deterministic positions so they don't jump around
                const sx = ((i * 7919 + 104729) % canvas.width);
                const sy = ((i * 6271 + 73757) % (canvas.height * 0.5));
                const twinkle = 0.5 + Math.sin(simClock * 0.002 + i * 1.7) * 0.5;
                const size = (i % 3 === 0) ? 2 : 1;
                ctx.beginPath();
                ctx.arc(sx, sy, size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${starAlpha * twinkle * 0.8})`;
                ctx.fill();
            }
        }
    }

    // ── Enter world space (zoom + pan camera) ──
    const camO = camOffset();
    ctx.save();
    ctx.translate(camO.x, camO.y);
    ctx.scale(zoom, zoom);

    // Day/Night-aware tile colors for both themes
    let grassColor, grassBorder, pathColor, pathBorder;
    if (isDark) {
        grassColor  = isNight ? '#0a3318' : '#14532d';
        grassBorder = isNight ? '#0d4422' : '#166534';
        pathColor   = isNight ? '#4a4540' : '#78716c';
        pathBorder  = isNight ? '#3d3a36' : '#64748b';
    } else {
        grassColor  = isNight ? '#4a9c6e' : '#86efac';
        grassBorder = isNight ? '#38855a' : '#4ade80';
        pathColor   = isNight ? '#b0a89e' : '#e2e8f0';
        pathBorder  = isNight ? '#8a8278' : '#cbd5e1';
    }

    // ════ PASS 1 — GROUND ════
    // Every tile's floor: grass, path, or (at anchors) the full 2×2 pad.
    // Child tiles of 2×2 buildings draw NOTHING here — repainting them
    // after the anchor was exactly what clipped the structures.
    for (let x = 0; x < S.gridSize; x++) {
        for (let y = 0; y < S.gridSize; y++) {
            const cell = S.map[x][y];
            const anchor = S.anchorOf[`${x},${y}`];
            if (anchor && (anchor.ax !== x || anchor.ay !== y)) continue;
            const screenPos = toScreen(x, y);
            const csz = cell ? (BUILD_DATA[cell]?.size || 1) : 1;
            if (cell && csz > 1) {
                drawPolyN(x, y, csz, isDark ? '#2e3d52' : '#c3ced9', RIDE_ACCENT[cell] || (isDark ? '#475569' : '#94a3b8'));
                // Concrete expansion joints across the pad
                const c2 = blockCenter(x, y, csz);
                const ph = padHalf(csz);
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
                ctx.lineWidth = 1;
                for (let g = 1; g < csz; g++) {
                    const f = g / csz;
                    ctx.beginPath();
                    ctx.moveTo(c2.x - ph.w + ph.w * f, c2.y + ph.h * f - ph.h);
                    ctx.lineTo(c2.x + ph.w * f, c2.y + ph.h - ph.h * f);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(c2.x + ph.w - ph.w * f, c2.y + ph.h * f - ph.h);
                    ctx.lineTo(c2.x - ph.w * f, c2.y + ph.h - ph.h * f);
                    ctx.stroke();
                }
            } else if (cell === 'path' || cell === 'entrance') {
                drawPoly(screenPos.x, screenPos.y, pathColor, pathBorder);
                // Paving joints for texture
                ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(screenPos.x - TILE_W / 4, screenPos.y - TILE_H / 4);
                ctx.lineTo(screenPos.x + TILE_W / 4, screenPos.y + TILE_H / 4);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(screenPos.x + TILE_W / 4, screenPos.y - TILE_H / 4);
                ctx.lineTo(screenPos.x - TILE_W / 4, screenPos.y + TILE_H / 4);
                ctx.stroke();
                // Trash lying on the pavement
                drawLitterAt(x, y, screenPos.x, screenPos.y);
            } else {
                drawPoly(screenPos.x, screenPos.y, grassColor, grassBorder);
            }
        }
    }

    // Park boundary fence sits between the ground and the objects
    drawParkFence();

    // ════ PASS 2 — OBJECTS + GUESTS, depth-sorted (painter's algorithm) ════
    // Depth = grid x+y of the object's FRONT corner, so a 2×2 ride sorts by
    // its front tile and nothing behind it can paint over it. Guests carry
    // their exact fractional position and weave behind/in front correctly.
    const drawables = [];
    for (let x = 0; x < S.gridSize; x++) {
        for (let y = 0; y < S.gridSize; y++) {
            const cell = S.map[x][y];
            if (!cell) continue;
            const anchor = S.anchorOf[`${x},${y}`];
            if (anchor && (anchor.ax !== x || anchor.ay !== y)) continue;
            const screenPos = toScreen(x, y);
            const sz = BUILD_DATA[cell]?.size || 1;

            if (sz > 1) {
                const center = blockCenter(x, y, sz);
                const aKey = `${x},${y}`;
                // Depth = the block's FRONT corner tile, so nothing behind
                // it can ever paint over the structure.
                drawables.push({ d: x + y + 2 * (sz - 1), fn: () => {
                    // Structures are authored to the pad's real footprint
                    setPad(sz);
                    SPRITES[cell]?.(center.x, center.y);
                    setPad(2);
                    const q = S.rideQueues[aKey];
                    if (q && q.queue > 0) drawRideQueue(x, y, q.queue, sz);
                    if (q && q.broken) drawBreakdownSmoke(center.x, center.y);
                }});
            } else {
                if (cell === 'lamp') lampGlows.push({ x: screenPos.x, y: screenPos.y });
                drawables.push({ d: x + y, fn: () => {
                    // The gate is not an attraction; it is drawn once, below.
                    if (cell !== 'entrance') SPRITES[cell]?.(screenPos.x, screenPos.y);
                    if (RIDE_TYPES.has(cell)) {
                        const q = S.rideQueues[`${x},${y}`];
                        if (q && q.broken) drawBreakdownSmoke(screenPos.x, screenPos.y);
                        if (q && q.queue > 0) {
                            const dots = Math.min(q.queue, 8);
                            for (let i = 0; i < dots; i++) {
                                const angle = (i / dots) * Math.PI * 2;
                                ctx.beginPath();
                                ctx.arc(screenPos.x + Math.cos(angle) * (TILE_W * 0.45), screenPos.y + Math.sin(angle) * (TILE_H * 0.45) - 2, 2, 0, Math.PI * 2);
                                ctx.fillStyle = '#8b5cf6';
                                ctx.fill();
                            }
                        }
                    }
                }});
            }
        }
    }

    // Guests join the same depth sort at their exact interpolated positions
    S.visualGuests.forEach(guest => {
        const gd = (guest.x + (guest.targetX - guest.x) * guest.progress)
                 + (guest.y + (guest.targetY - guest.y) * guest.progress);
        drawables.push({ d: gd + 0.6, fn: () => {
            guest.draw();
            // Selection ring on the inspected guest
            if (guest === inspectedGuest && !guest.queuedAt) {
                const mx = guest.x + (guest.targetX - guest.x) * guest.progress;
                const my = guest.y + (guest.targetY - guest.y) * guest.progress;
                const p = toScreen(mx, my);
                ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.ellipse(p.x, p.y, 7, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x - 3, p.y - 19); ctx.lineTo(p.x + 3, p.y - 19); ctx.closePath();
                ctx.fillStyle = '#60a5fa'; ctx.fill();
            }
        }});
    });

    // Staff share the depth sort too
    S.staff.forEach(w => {
        const mx = w.x + (w.tx - w.x) * w.progress, my = w.y + (w.ty - w.y) * w.progress;
        drawables.push({ d: mx + my + 0.7, fn: () => drawStaffOne(w) });
    });

    // The fixed gate draws once, at its centre tile's depth
    {
        const gp = toScreen(ENTRANCE_X, ENTRANCE_Y);
        drawables.push({ d: ENTRANCE_X + ENTRANCE_Y + 1, fn: () => drawEntrance(gp.x, gp.y) });
    }

    drawables.sort((a, b) => a.d - b.d);
    for (const dr of drawables) dr.fn();

    // Hover highlight — drawn after objects so the target tile always reads
    if (hoveredCell.x >= 0 && hoveredCell.y >= 0 && hoveredCell.x < S.gridSize && hoveredCell.y < S.gridSize) {
        const hx = hoveredCell.x, hy = hoveredCell.y;
        const hCell = S.map[hx][hy];
        const toolData = BUILD_DATA[currentTool];
        if (currentTool === 'bulldozer') {
            const sp = toScreen(hx, hy);
            drawPoly(sp.x, sp.y, (hCell === 'entrance') ? 'rgba(156, 163, 175, 0.5)' : 'rgba(239, 68, 68, 0.45)');
        } else if (toolData && toolData.size > 1) {
            const tsz = toolData.size;
            let fits = true;
            for (let dx = 0; dx < tsz && fits; dx++) {
                for (let dy = 0; dy < tsz && fits; dy++) {
                    if (hx + dx >= S.gridSize || hy + dy >= S.gridSize || S.map[hx + dx]?.[hy + dy] !== null) fits = false;
                }
            }
            for (let dx = 0; dx < tsz; dx++) {
                for (let dy = 0; dy < tsz; dy++) {
                    const px = hx + dx, py = hy + dy;
                    if (px < S.gridSize && py < S.gridSize) {
                        const sp = toScreen(px, py);
                        const canPlace = S.map[px]?.[py] === null;
                        drawPoly(sp.x, sp.y, canPlace ? 'rgba(59, 130, 246, 0.4)' : 'rgba(239, 68, 68, 0.4)');
                    }
                }
            }
            // Outline the whole footprint so big builds read as one block
            drawPolyN(hx, hy, tsz, 'rgba(0,0,0,0)', fits ? 'rgba(96,165,250,0.95)' : 'rgba(248,113,113,0.95)');
        } else {
            const sp = toScreen(hx, hy);
            drawPoly(sp.x, sp.y, 'rgba(59, 130, 246, 0.45)');
        }
    }

    // ── Leave world space — overlays below are screen-space ──
    ctx.restore();

    // Night tint over the entire scene (after grid+guests, before fireworks)
    if (na > 0.05) {
        ctx.fillStyle = isDark
            ? `rgba(3, 7, 30, ${na * 0.4})`
            : `rgba(15, 23, 60, ${na * 0.35})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Lamp light pools — drawn OVER the night tint so they genuinely
    // illuminate the sidewalk (and anyone strolling under them)
    if (na > 0.08 && lampGlows.length) {
        for (const g of lampGlows) {
            const sx = g.x * zoom + camO.x;
            const sy = (g.y - 6) * zoom + camO.y;
            const r = TILE_W * 1.5 * zoom;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.scale(1, 0.55);
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
            grad.addColorStop(0, `rgba(254, 240, 138, ${0.34 * na})`);
            grad.addColorStop(0.55, `rgba(253, 224, 71, ${0.15 * na})`);
            grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }

    // Rain overlay
    drawRainFX();

    // Fireworks advance in simTick(); render only paints them.
    if (fireworkShells.length > 0 || fireworkParticles.length > 0) {
        drawFireworks();
    }

    // Hover tooltip
    drawTooltip();

    // Minimap (own canvas) — every 6th frame is plenty
    if (minimapOn && (++miniFrame % 6 === 0)) drawMinimap();

}

// ────── Interaction Logic ──────

function handleInteraction(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    // Map CSS px → canvas backing-store px (guards against any scale mismatch)
    mouseX = (clientX - rect.left) * (canvas.width / rect.width);
    mouseY = (clientY - rect.top) * (canvas.height / rect.height);
    const gridPos = toMap(mouseX, mouseY);
    if (gridPos.x >= 0 && gridPos.x < S.gridSize && gridPos.y >= 0 && gridPos.y < S.gridSize) {
        hoveredCell = gridPos;
        if (isDragging || e.type === 'mousedown' || e.type === 'touchstart') {
            buildInCell(gridPos.x, gridPos.y);
        }
    } else {
        hoveredCell = { x: -1, y: -1 };
    }
}

function buildInCell(x, y) {
    const currentCell = S.map[x][y];

    // Protect Entrance
    if (currentCell === 'entrance') {
        if (currentTool === 'bulldozer') logEvent('Cannot bulldoze the Main Entrance!', 'bad');
        return;
    }

    // ── Bulldozer ──
    if (currentTool === 'bulldozer') {
        if (currentCell === null) return;

        // Find anchor for this tile
        const aInfo = S.anchorOf[`${x},${y}`];
        if (aInfo) {
            const { ax, ay } = aInfo;
            const type = S.map[ax][ay];
            const data = BUILD_DATA[type];
            if (!data) return;

            // Refund & clear all tiles
            const refund = Math.floor(data.cost * 0.5);
            earn(refund, 'refunds');

            const sz = data.size;
            const cleared = [];
            for (let dx = 0; dx < sz; dx++) {
                for (let dy = 0; dy < sz; dy++) {
                    cleared.push({ x: ax + dx, y: ay + dy });
                    S.map[ax+dx][ay+dy] = null;
                    delete S.anchorOf[`${ax+dx},${ay+dy}`];
                }
            }
            pushUndo({ kind: 'demolish', type, cells: cleared, cost: data.cost, refund,
                       key: `${ax},${ay}`, name: S.rideNames[`${ax},${ay}`] });
            sfx('demolish');
            const dKey = `${ax},${ay}`;
            logEvent(`Demolished "${S.rideNames[dKey] || type}". Refund: $${refund}`, 'info');
            delete S.rideQueues[dKey];
            delete S.rideNames[dKey];
            delete S.shopStats[dKey];
            if (inspectedKey === dKey) closeRidePanel();
        } else {
            // Simple single-tile without anchor (path, etc.)
            if (currentCell === 'path') {
            } else if (BUILD_DATA[currentCell]) {
                const refund = Math.floor(BUILD_DATA[currentCell].cost * 0.5);
                earn(refund, 'refunds');
            }
            const sKey = `${x},${y}`;
            delete S.rideNames[sKey];
            delete S.shopStats[sKey];
            if (inspectedKey === sKey) closeRidePanel();
            S.map[x][y] = null;
        }
        updateUI();
        return;
    }

    // ── Build ──
    const toolData = BUILD_DATA[currentTool];
    if (!toolData) return;
    const sz = toolData.size;

    // Check all tiles are empty and in bounds
    for (let dx = 0; dx < sz; dx++) {
        for (let dy = 0; dy < sz; dy++) {
            const cx = x + dx, cy2 = y + dy;
            if (cx >= S.gridSize || cy2 >= S.gridSize || S.map[cx]?.[cy2] !== null) {
                if (!isDragging || currentTool !== 'path') {
                    if (sz > 1) logEvent(`Need a clear ${sz}×${sz} area to build ${currentTool}.`, 'bad');
                }
                return;
            }
        }
    }

    if (S.funds < toolData.cost) {
        if (!isDragging || currentTool !== 'path') {
            logEvent(`Insufficient funds for ${currentTool}.`, 'bad');
        }
        return;
    }

    // Place it
    spend(toolData.cost, 'construction');

    const placed = [];
    for (let dx = 0; dx < sz; dx++) {
        for (let dy = 0; dy < sz; dy++) {
            placed.push({ x: x + dx, y: y + dy });
            S.map[x+dx][y+dy] = currentTool;
            S.anchorOf[`${x+dx},${y+dy}`] = { ax: x, ay: y };
        }
    }
    pushUndo({ kind: 'build', type: currentTool, cells: placed, cost: toolData.cost,
               key: `${x},${y}` });
    sfx('build');

    // Initialize ride queue + give it a name
    const newKey = `${x},${y}`;
    if (RIDE_TYPES.has(currentTool)) {
        S.rideQueues[newKey] = { queue: 0, ridersOnBoard: 0, cycleTimer: 0, broken: false, repairTimer: 0, riders: 0, earned: 0, breakdowns: 0 };
        S.rideNames[newKey] = nextName(currentTool);
        logEvent(`"${S.rideNames[newKey]}" is now open! (${TYPE_LABEL[currentTool]})`, 'good');
    } else if (SHOP_TYPES.has(currentTool)) {
        S.shopStats[newKey] = { sales: 0, earned: 0 };
        S.rideNames[newKey] = nextName(currentTool);
        logEvent(`"${S.rideNames[newKey]}" is open for business!`, 'good');
    }

    checkObjectives();
    updateUI();
}

// Event Listeners — build, pan (right/middle/Shift-drag), zoom (wheel)
canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
        panX += e.clientX - panStart.x;
        panY += e.clientY - panStart.y;
        panStart = { x: e.clientX, y: e.clientY };
        return;
    }
    handleInteraction(e);
});
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); handleInteraction(e); }, {passive: false});
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const csx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const csy = (e.clientY - rect.top) * (canvas.height / rect.height);
    // Clicking a guest opens their profile (bulldozer excepted)
    if (currentTool !== 'bulldozer') {
        const g = guestAtScreen(csx, csy);
        if (g) { openGuestPanel(g); return; }
    }
    // Clicking an existing ride/shop inspects it instead of failing a build
    const gp = toMap(csx, csy);
    if (currentTool !== 'bulldozer' && gp.x >= 0 && gp.y >= 0 && gp.x < S.gridSize && gp.y < S.gridSize) {
        const cell = S.map[gp.x]?.[gp.y];
        if (cell && (RIDE_TYPES.has(cell) || SHOP_TYPES.has(cell))) {
            openRidePanel(anchorKeyAt(gp.x, gp.y));
            return;
        }
    }
    isDragging = true;
    handleInteraction(e);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const o = camOffset();
    const wx = (mx - o.x) / zoom, wy = (my - o.y) / zoom;
    zoom = Math.min(1.8, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    panX = mx - canvas.width / 2 - wx * zoom;
    panY = my - (canvas.height / 4 + 50) - wy * zoom;
}, { passive: false });
canvas.addEventListener('touchstart', (e) => { isDragging = true; handleInteraction(e); });
window.addEventListener('mouseup', () => { isDragging = false; isPanning = false; });
window.addEventListener('touchend', () => isDragging = false);

// Ride name editing — commit as you type
const rideNameInput = document.getElementById('ride-name') as HTMLInputElement;
rideNameInput.addEventListener('input', () => {
    if (!inspectedKey) return;
    S.rideNames[inspectedKey] = rideNameInput.value.trim() || 'Unnamed';
});
rideNameInput.addEventListener('change', saveGame);
rideNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') rideNameInput.blur(); });
// ── Keyboard shortcuts ──
window.addEventListener('keydown', (e) => {
    // Never hijack typing in the rename field or a form
    const tgt = e.target as HTMLElement;
    const tag = (tgt.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
        if (e.key === 'Escape') tgt.blur();
        return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undoLast(); return; }
    if (e.key === 'Escape') {
        if (!document.getElementById('mgmt').classList.contains('hidden')) closeMgmt();
        else if (inspectedGuest) closeGuestPanel();
        else if (inspectedKey) closeRidePanel();
        return;
    }
    if (k >= '1' && k <= '9') { const t = HOTKEY_TOOLS[+k - 1]; if (t) setTool(t, null); return; }
    if (k === 'b') { setTool('bulldozer', document.querySelector<HTMLElement>('.build-btn[data-arg="bulldozer"]')); return; }
    if (k === ' ') { e.preventDefault(); setSpeed(gameSpeed === 0 ? 1 : 0); return; }
    if (k === '+' || k === '=') { setSpeed(3); return; }
    if (k === '-') { setSpeed(1); return; }
    if (k === 'm') { document.getElementById('mgmt').classList.contains('hidden') ? openMgmt() : closeMgmt(); return; }
    if (k === 'n') { toggleMinimap(); return; }
});
// Keep open panels' live numbers ticking
setInterval(() => {
    if (document.hidden) return;
    if (inspectedKey) renderRideStats();
    if (inspectedGuest) renderGuestStats();
    if (mgmtTab === 'staff' && !document.getElementById('mgmt').classList.contains('hidden')) renderMgmt();
}, 700);

// Minimap click-to-jump
document.getElementById('minimap').addEventListener('click', minimapJump);

// ── Theme ──
// Moved here from the marketing nav's pill toggle. The initial .dark class is
// set by the render-blocking script in index.html; this only handles flips.
function syncThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    const dark = document.documentElement.classList.contains('dark');
    icon.classList.toggle('fa-moon', dark);
    icon.classList.toggle('fa-sun', !dark);
    icon.classList.toggle('text-blue-400', dark);
    icon.classList.toggle('text-yellow-500', !dark);
}

function toggleTheme() {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('color-theme', dark ? 'dark' : 'light');
    syncThemeIcon();
}

function toggleObjectives() {
    document.getElementById('objective-list')?.classList.toggle('hidden');
}

// ── Delegated action dispatch ──
// Replaces the 50 inline onclick= attributes the monolith used. Delegation (as
// opposed to binding each button) is what lets the SAME table serve markup that
// renderMgmt() generates at runtime, which is otherwise unbindable at startup.
//
// Phase 4 replaces this with per-module listeners in ui/; until then it is the
// single place any DOM control reaches game code.
const ACTIONS: Record<string, (arg: string, el: HTMLElement) => void> = {
    setTool:            (arg, el) => setTool(arg, el),
    setSpeed:           (arg) => setSpeed(Number(arg)),
    openMgmt:           (arg) => openMgmt(arg),
    closeMgmt,
    // No closeAccount entry: the panel closes itself (its own × button and
    // backdrop, bound in ui/auth.ts via data-close) rather than round-
    // tripping through the global dispatch table it otherwise stays out of.
    openAccount:        () => authUI.open(),
    newGame,
    buyLand,
    undoLast,
    toggleMinimap,
    toggleSound,
    toggleTheme,
    toggleObjectives,
    closeGuestPanel,
    closeRidePanel,
    renameRandom,
    demolishInspected,
    hireStaff:          (arg) => hireStaff(arg),
    fireStaff:          (arg) => fireStaff(arg),
    startCampaign:      (arg) => startCampaign(arg),
    borrow:             (arg) => borrow(Number(arg)),
    repay:              (arg) => repay(Number(arg)),
    setAdmission:       (_a, el) => setAdmission((el as HTMLInputElement).value),
    setResearchBudget:  (_a, el) => setResearchBudget((el as HTMLInputElement).value),
};

function dispatchAction(e: Event, kind: 'click' | 'input') {
    const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-act]');
    if (!el) return;
    // Range sliders fire input, buttons fire click. Without this split a slider
    // would also run its action on the click that starts the drag.
    const isRange = el instanceof HTMLInputElement && el.type === 'range';
    if (isRange !== (kind === 'input')) return;
    const fn = ACTIONS[el.dataset.act!];
    if (!fn) {
        console.warn(`[actions] no handler for data-act="${el.dataset.act}"`);
        return;
    }
    fn(el.dataset.arg ?? '', el);
}

document.addEventListener('click', (e) => dispatchAction(e, 'click'));
document.addEventListener('input', (e) => dispatchAction(e, 'input'));

// Dev-only: lets the smoke test assert that every data-act in the DOM resolves
// to a handler. Stripped from production builds by the DEV constant.
if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>;
    w.__ACTIONS__ = Object.keys(ACTIONS);
    // Lets tests drive a save without waiting 12s for the autosave interval, and
    // gives the browser console a handle on the live state object.
    w.__GAME__ = {
        state: S,
        saveGame,
        loadGame,
        Guest,
        /** Simulated milliseconds. Frozen while paused -- that is the invariant
         *  tests/loop.spec.ts checks. */
        get simClock() { return simClock; },
        get gameSpeed() { return gameSpeed; },
    };
}

// Start
renderObjectives();
updateLandButton();
renderPalette();          // must precede refreshPalette(): it creates the buttons
refreshPalette();
setTool(currentTool, null);
if (restored) hydrateEntities();
recomputeCleanliness(S);
syncThemeIcon();
document.getElementById('btn-minimap').classList.add('text-blue-500');
if (restored) {
    logEvent(`Park restored from autosave — welcome back to Day ${S.dayCount}.`, 'good');
} else {
    logEvent('Tip: press M for management, 1-9 for tools, B to bulldoze, Ctrl+Z to undo.', 'info');
}
updateUI();

// ────── Accounts & cloud saves (phase 7-8) ──────
// Local-first, and additive: nothing below can stop someone playing with no
// account at all (ARCHITECTURE §5-6, BACKEND-HANDOFF.md §1). ui/auth.ts owns
// the sync engine and every account/slot/conflict UI; main.ts only supplies
// the four callbacks below and two buttons' worth of open()/close().
startPlaytimeTracking();

/** Replace the live park with one loaded from the server (a slot switch, or
 *  a conflict resolved via "use theirs"). Rehydration happens separately in
 *  onExternalStateChange -- see mountAuthUI's ordering. */
function applyExternalState(newState: GameState) {
    Object.assign(S, newState);
}

/** Everything boot does after loading a save, replayed for a save that
 *  arrived after boot instead of at it. */
function refreshAfterExternalStateChange() {
    hydrateEntities();
    recomputeCleanliness(S);
    renderObjectives();
    updateLandButton();
    refreshPalette();
    updateUI();
}

const authUI = mountAuthUI(document.getElementById('account'), {
    api: createApi(),
    getState: () => S,
    applyState: applyExternalState,
    getPlaytimeMs,
    onExternalStateChange: refreshAfterExternalStateChange,
    ensurePlaytimeAtLeast,
});

// ────── The loop ──────

/** One entity step. Everything here advances in simulated time. */
function simTick() {
    for (const guest of S.visualGuests) guest.update();
    updateStaff(S);
    updateFireworks();
}

/**
 * Fixed-timestep accumulator.
 *
 * `simMs` is zero while paused, so a single `gameSpeed` multiplier is all it
 * takes for setSpeed(0) to genuinely stop the park -- including the shop
 * revenue a "paused" game used to keep earning.
 *
 * The wall-clock delta is clamped so returning to a backgrounded tab replays a
 * quarter-second, not the twenty minutes you were away.
 */
function frame(now: number) {
    const wall = Math.min(now - lastFrameAt, MAX_CATCHUP_MS);
    lastFrameAt = now;

    const simMs = wall * gameSpeed;
    simClock += simMs;
    tickAccumulator += simMs;
    economyAccumulator += simMs;

    let steps = 0;
    while (tickAccumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        simTick();
        tickAccumulator -= TICK_MS;
        steps++;
    }
    // Hit the ceiling: drop the backlog instead of spiralling further behind.
    if (steps >= MAX_STEPS_PER_FRAME) tickAccumulator = 0;

    while (economyAccumulator >= ECONOMY_TICK_MS) {
        economyTick();
        economyAccumulator -= ECONOMY_TICK_MS;
        updateUI();
    }

    render();
    requestAnimationFrame(frame);
}

lastFrameAt = performance.now();
requestAnimationFrame(frame);
