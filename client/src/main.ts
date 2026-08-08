import './styles/app.css';
import { createGameState, type RideQueue, type GameState } from './core/state';
import { SAVE_KEY, loadFromLocalStorage, saveToLocalStorage } from './save/schema';
import * as Fin from './sim/finance';
import { evaluateAwards as evaluateAwardsSim } from './sim/awards';
import { getSceneryBonusAt } from './sim/scenery';
import { isNightAt } from './sim/time';
import { litterAt, dropLitter, recomputeCleanliness } from './sim/litter';
import {
    pathTiles, staffCount, dailyWages, bfsRoute, stepRoute, wanderStep, updateStaff,
    hireStaff as hireStaffSim, fireStaff as fireStaffSim,
} from './sim/staff';
import { checkObjectives as checkObjectivesSim } from './sim/objectives';
import { processRideQueues as processRideQueuesSim } from './sim/rides';
import { createGuest, updateGuest as updateGuestSim } from './sim/guests';
import { perceivedValue as perceivedValueSim, economyTick as economyTickSim } from './sim/economy';
import { logEvent } from './ui/eventlog';
import { updateStatusBar as updateStatusBarSim } from './ui/statusbar';
import { renderObjectives as renderObjectivesSim } from './ui/objectives';
import {
    openMgmt as openMgmtSim, closeMgmt as closeMgmtSim, renderMgmt as renderMgmtSim,
    money, LOAN_LIMIT, mgmtTab,
} from './ui/management';
import {
    nextName as nextNameSim, randomName, anchorKeyAt as anchorKeyAtSim,
    openRidePanel as openRidePanelSim, closeRidePanel, renderRideStats as renderRideStatsSim,
    openGuestPanel as openGuestPanelSim, closeGuestPanel, renderGuestStats as renderGuestStatsSim,
    inspectedKey, inspectedGuest,
} from './ui/inspectors';
import { isUnlocked as isUnlockedSim, renderPalette as renderPaletteSim, refreshPalette as refreshPaletteSim } from './ui/palette';
import { TILE_W, TILE_H, toScreen, camOffset as camOffsetImpl, toMap as toMapImpl } from './render/camera';
import {
    drawPoly as drawPolyImpl, drawPolyN as drawPolyNImpl, drawGroundShadow as drawGroundShadowImpl,
    drawIsoDeck as drawIsoDeckImpl, drawPadFence as drawPadFenceImpl,
    blockCenter, padHalf, setPad, PAD_W, PAD_H, tileHash, drawTileQuad,
} from './render/iso';
import { simClock, isNight, advanceSimClock, setIsNight } from './render/clock';
import { drawEntrance as drawEntranceImpl, drawEntranceNight as drawEntranceNightImpl, drawParkFence as drawParkFenceImpl } from './render/sprites/scenery';
import { rebuildAnchors } from './sim/anchors';
import { SPRITES } from './render/sprites';
import {
    setRotationAngle, setGridSize, rotation, rotationAngle, depthOf, blockCorners,
} from './render/camera';
import {
    panDelta, panKeyDown, panKeyUp, clearHeldKeys,
    MIN_ZOOM, MAX_ZOOM,
} from './render/navigation';
import { drawGuestSprite, guestOffset } from './render/guestsprite';
import { drawEntranceSprite } from './render/entrancesprite';
import {
    drawBreakdownSmoke as drawBreakdownSmokeImpl, drawRainFX as drawRainFXImpl,
    drawTooltip as drawTooltipImpl, drawRideQueue as drawRideQueueImpl,
} from './render/effects';
import { drawStaffOne as drawStaffOneImpl, drawLitterAt as drawLitterAtImpl } from './render/entities';
import {
    FIREWORK_COLORS, updateFireworks as updateFireworksImpl, drawFireworks as drawFireworksImpl,
    hasActiveFireworks as hasActiveFireworksImpl,
} from './render/fireworks';
import {
    minimapOn, toggleMinimap as toggleMinimapImpl, drawMinimap as drawMinimapImpl, minimapJump as minimapJumpImpl,
} from './render/minimap';
import { createApi } from './net/client';
import { mountAuthUI } from './ui/auth';
import { getPlaytimeMs, startPlaytimeTracking, ensureAtLeast as ensurePlaytimeAtLeast } from './save/playtime';
// One source of truth for every buildable thing. These were nine hand-synced
// tables in the monolith; they are all derived from content/ now.
import {
    BUILD_DATA, RIDE_TYPES, SHOP_TYPES, SCENERY_TYPES, TYPE_LABEL, NAME_POOL,
    RIDE_ACCENT, MINI_COLORS, RESEARCH_ORDER, HOTKEY_TOOLS,
    NEEDS, NEED_BY_ID, BALLOON_BUY_CHANCE, BALLOON_HAPPINESS,
    STAFF_KINDS, MARKETING_CAMPAIGNS,
} from './content';
import type { StaffKindId, MarketingCampaignId } from './content';
import type { Staff } from './sim/staff';
import type { GuestLike } from './ui/inspectors';

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

// Track profiles were memoized onto the draw functions themselves
// (drawCoaster.path = ...). Both coasterPath and megaCoaster's pair are now
// private module state inside render/sprites/rides.ts and
// render/sprites/megacoaster.ts respectively -- nothing outside those draw
// functions ever touched them.


// --- Isometric Game Engine (v3 — shops & guest needs, breakdowns, weather, objectives, land expansion, zoom/pan, autosave) ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const nightOverlay = document.getElementById('night-overlay');

// ── Game state ──
// Everything persisted lives on S (see core/state.ts). Session and view state
// -- camera, current tool, speed, open panels, audio, undo, transient FX --
// stays module-level below until phase 4 gives it homes in ui/ and render/.
const S = createGameState();

// RCT-style park entrance: a fixed 3-tile-wide gate on the west edge that the
// player can never build on or bulldoze. Guests spawn at its centre tile.
const ENTRANCE_X = 0;
const ENTRANCE_Y = 7;                    // centre of the gate — never moves
const ENTRANCE_TILES = [[0, 6], [0, 7], [0, 8]];
function isEntranceTile(x: number, y: number) { return x === ENTRANCE_X && y >= ENTRANCE_Y - 1 && y <= ENTRANCE_Y + 1; }

// null means NO tool armed -- look-and-pan mode, and the state a new park
// starts in. The game used to boot straight into build mode with Path armed,
// so the very first click on the map laid a path whether you meant it or not.
// Clicking an armed tool again returns here (see setTool/clearTool).
let currentTool: string | null = null;
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

// simClock/isNight moved to render/clock.ts (phase 4) -- imported below,
// read directly everywhere here since main.ts is now a reader of both
// except the two sites that call their setters (the fixed-timestep loop,
// updateUI()).
let tickAccumulator = 0;
let economyAccumulator = 0;
let lastFrameAt = 0;

// Weather FX (the weather itself is S.weather) -- rainDrops/rainAlpha moved
// into render/effects.ts, private to drawRainFX (phase 4).

// Land expansion
const LAND_COSTS = [5000, 12000, 25000, 45000, 80000];

// Fireworks -- the particle system itself (FireworkShell/FireworkParticle,
// FIREWORK_COLORS, updateFireworks/drawFireworks) moved to
// render/fireworks.ts (phase 4). fireworksActive/fireworksTimer stay here:
// they're set from evaluateAwards/checkObjectives/economyTick, none of
// which have moved.
let fireworksActive = false;
let fireworksTimer = 0;           // ticks remaining in the show



// Ride naming / ride-inspector panel moved to ui/inspectors.ts (phase 4).
// nextName/anchorKeyAt/openRidePanel/renderRideStats keep zero/one-arg
// wrappers here for their many call sites; closeRidePanel needed no wrapper
// (same signature either side). renameRandom/demolishInspected stay in
// main.ts fully -- both call saveGame()/buildInCell(), which are still
// main.ts residents, and moving them would mean ui/inspectors.ts importing
// back from here.
function nextName(type: string) { return nextNameSim(type, S); }
function anchorKeyAt(x: number, y: number) { return anchorKeyAtSim(S, x, y); }
function openRidePanel(key: string) { openRidePanelSim(S, key); }
function renderRideStats() { renderRideStatsSim(S); }

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

/**
 * One reversible action. `refund`/`name` only exist on demolish entries -- a
 * build has nothing to refund and the ride wasn't named yet.
 */
interface UndoEntry {
    kind: 'build' | 'demolish';
    type: string;
    cells: { x: number; y: number }[];
    cost: number;
    key: string;
    refund?: number;
    name?: string;
}

let undoStack: UndoEntry[] = [];

// Research — rides unlock in order as you invest


function isUnlocked(tool: string) { return isUnlockedSim(S, tool); }

// Ledger — sim/finance.ts is the only thing allowed to write S.funds. These are
// thin bindings so the ~40 existing call sites keep reading the same.
const earn = (amount: number, bucket: Fin.IncomeBucket) => Fin.earn(S, amount, bucket);
const spend = (amount: number, bucket: Fin.ExpenseBucket) => Fin.spend(S, amount, bucket);
const unearn = (amount: number, bucket: Fin.IncomeBucket) => Fin.unearn(S, amount, bucket);
const unspend = (amount: number, bucket: Fin.ExpenseBucket) => Fin.unspend(S, amount, bucket);

// ── Litter ── moved to sim/litter.ts (phase 4); call sites below pass S.

// ── Staff ──
// pathTiles/bfsRoute/stepRoute/wanderStep/updateStaff/staffCount/dailyWages
// moved to sim/staff.ts (phase 4). hireStaff/fireStaff stay here as thin
// wrappers -- the event-log/sound/UI-refresh calls are ui/render concerns
// that haven't moved yet, same pattern as evaluateAwards() above.
function hireStaff(kind: StaffKindId) {
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

function fireStaff(kind: StaffKindId) {
    const removed = fireStaffSim(S, kind);
    if (!removed) return;
    logEvent(`${removed.name} (${STAFF_KINDS[kind].label}) has left the park.`, 'info');
    if (mgmtTab === 'staff') renderMgmt();
}

// Drawn per-worker so staff can join the scene's depth sort
// drawStaffOne/drawLitterAt moved to render/entities.ts (phase 4).
function drawStaffOne(w: Staff) { drawStaffOneImpl(ctx, w); }
function drawLitterAt(x: number, y: number, sx: number, sy: number) { drawLitterAtImpl(ctx, S, x, y, sx, sy); }

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
function pushUndo(entry: UndoEntry) {
    undoStack.push(entry);
    if (undoStack.length > 25) undoStack.shift();
}

function undoLast() {
    const e = undoStack.pop();
    if (!e) { logEvent('Nothing left to undo.', 'info'); return; }
    if (e.kind === 'build') {
        // Remove what was built and refund the full cost
        for (const c of e.cells) { S.map[c.x][c.y] = null; }
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

        }
        unearn(e.refund, 'refunds');        // reverse the demolition refund
        if (RIDE_TYPES.has(e.type)) {
            S.rideQueues[e.key] = { queue: 0, ridersOnBoard: 0, cycleTimer: 0, broken: false, repairTimer: 0, riders: 0, earned: 0, breakdowns: 0 };
        }
        if (e.name) S.rideNames[e.key] = e.name;
        logEvent(`Restored ${e.name || TYPE_LABEL[e.type] || e.type}.`, 'info');
    }
    // Both branches edited the map; re-derive once rather than per branch.
    rebuildAnchors(S);
    updateUI();
    saveGame();
}

// ── Sound (synthesized, no assets) ──
let audioCtx: AudioContext | null = null, soundOn = false,
    ambienceNodes: { src: AudioBufferSourceNode; gain: GainNode; lp: BiquadFilterNode } | null = null;

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

function sfx(kind: string) {
    if (!soundOn || !audioCtx) return;
    const now = audioCtx.currentTime;
    const tone = (freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
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
// mgmtTab/openMgmt/closeMgmt/row/C/money/renderMgmt moved to ui/management.ts
// (phase 4). Wrappers below keep the zero/one-arg signatures the ~10 call
// sites throughout this file already use; `mgmtTab` is imported directly
// since main.ts only ever reads it (hireStaff/fireStaff wrappers, the 'm'
// keyboard shortcut) -- ui/management.ts is the only writer.
function openMgmt(tab?: string) { openMgmtSim(S, tab); }
function closeMgmt() { closeMgmtSim(); }
function renderMgmt() { renderMgmtSim(S); }

function perceivedValue() { return perceivedValueSim(S); }
function setAdmission(v: string) {
    S.admissionPrice = parseInt(v, 10);
    const lbl = document.getElementById('price-label');
    if (lbl) lbl.textContent = money(S.admissionPrice);
    saveGame();
}
function setResearchBudget(v: string) { S.research.budget = parseInt(v, 10); renderMgmt(); saveGame(); }

function borrow(amount: number) {
    if (S.loanBalance + amount > LOAN_LIMIT) { logEvent('Your credit limit is maxed out.', 'bad'); sfx('error'); return; }
    S.loanBalance += amount;
    earn(amount, 'loans');
    logEvent(`Borrowed ${money(amount)}. Interest accrues daily.`, 'info');
    sfx('money'); updateUI(); renderMgmt(); saveGame();
}
function repay(amount: number) {
    const pay = Math.min(amount, S.loanBalance);
    if (pay <= 0) { logEvent('You have no outstanding loan.', 'info'); return; }
    if (S.funds < pay) { logEvent('Not enough cash to make that repayment.', 'bad'); sfx('error'); return; }
    S.loanBalance -= pay;
    spend(pay, 'loanRepaid');
    logEvent(`Repaid ${money(pay)} of your loan.`, 'good');
    updateUI(); renderMgmt(); saveGame();
}
function startCampaign(key: MarketingCampaignId) {
    const c = MARKETING_CAMPAIGNS[key];
    if (S.funds < c.cost) { logEvent(`Not enough cash for the ${c.label}.`, 'bad'); sfx('error'); return; }
    spend(c.cost, 'marketing');
    S.marketing = { key, daysLeft: c.days };
    logEvent(`${c.label} launched! +${Math.round(c.boost * 100)}% attendance for ${c.days} days.`, 'good');
    sfx('money'); updateUI(); renderMgmt(); saveGame();
}

// money0/paletteButton/renderPalette/refreshPalette moved to ui/palette.ts
// (phase 4); wrappers keep the zero-arg signatures the ~5 call sites use.
function renderPalette() { renderPaletteSim(); }
function refreshPalette() { refreshPaletteSim(S); }

// ═══════════════════════════════════════════════════════════
//  GUEST INSPECTOR
// ═══════════════════════════════════════════════════════════
// openGuestPanel/closeGuestPanel/renderGuestStats moved to ui/inspectors.ts
// (phase 4). guestAtScreen stays -- it's a click hit-test against the
// camera transform (toScreen/zoom/camOffset), render/interaction territory
// that hasn't moved yet, not an inspector-panel concern.
function guestAtScreen(sx: number, sy: number) {
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

function openGuestPanel(g: Guest) { openGuestPanelSim(S, g as unknown as GuestLike); }
function renderGuestStats() { renderGuestStatsSim(S); }

// ═══════════════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════════════
// toggleMinimap/drawMinimap/minimapJump moved to render/minimap.ts (phase 4).
// minimapOn is imported directly (render()'s throttle check below only ever
// reads it; toggleMinimap is the sole writer). minimapJump now returns the
// new pan instead of assigning it -- its one call site, at the bottom of
// this file, applies that to panX/panY itself.
let miniFrame = 0;
function toggleMinimap() { toggleMinimapImpl(); }
function drawMinimap() { drawMinimapImpl(S, canvas, zoom, panX, panY); }

// ────── Objectives ──────
// OBJECTIVES data and the pure ladder-advance logic moved to
// sim/objectives.ts (phase 4); checkObjectives() below is a thin wrapper for
// the event-log/fireworks/save side effects that belong to ui/render.
// Moved to ui/objectives.ts (phase 4); wrapper keeps the zero-arg signature.
function renderObjectives() {
    renderObjectivesSim(S);
}

function checkObjectives() {
    for (const o of checkObjectivesSim(S)) {
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
    S.staff = (S.staff as Staff[])
        .filter((w) => w && STAFF_KINDS[w.kind as StaffKindId])
        .map((w) => ({
            ...w,
            tx: w.x, ty: w.y, progress: 1,
            speed: 0.024 + Math.random() * 0.012,
            task: null as string | null, swing: Math.random() * 6,
            route: null as { x: number; y: number }[] | null, reroute: 0, cleaned: w.cleaned || 0,
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
    // The scan is bounded by gridSize, so growing the park invalidates it.
    rebuildAnchors(S);
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

function setSpeed(s: number) {
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

function setTool(tool: string, btnElement: HTMLElement | null) {
    // Clicking the armed tool again disarms it -- the fastest way out of build
    // mode is the button that got you into it, and it needs no extra UI.
    if (tool === currentTool) { clearTool(); return; }
    // Cursor advertises the armed tool: bulldozer gets its own.
    if (!isUnlocked(tool)) {
        const next = RESEARCH_ORDER.find(t => !S.research.unlocked.includes(t));
        logEvent(`${TYPE_LABEL[tool] || tool} isn't researched yet.${next ? ` R&D is working on ${TYPE_LABEL[next]}.` : ''}`, 'bad');
        sfx('error');
        return;
    }
    currentTool = tool;
    syncCursor();
    document.querySelectorAll('.build-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    else {
        const b = document.querySelector<HTMLElement>(`.build-btn[data-act="setTool"][data-arg="${tool}"]`);
        if (b) b.classList.add('active');
    }
}

/** Disarm the current tool: no build preview, no accidental placement. */
function clearTool() {
    currentTool = null;
    // The sentinel, NOT null: drawTooltip() destructures this every frame, and
    // null took the whole render loop down.
    hoveredCell = { x: -1, y: -1 };
    document.querySelectorAll('.build-btn').forEach(btn => btn.classList.remove('active'));
    syncCursor();
    syncCamHud();
}

// formatTime/updateUI/logEvent moved to ui/statusbar.ts and ui/eventlog.ts
// (phase 4). updateUI() keeps its name and zero-arg signature so the ~10
// call sites below don't need touching; it only needs a wrapper because it
// has to push what ui/statusbar.ts computes into render/clock.ts's isNight.
function updateUI() {
    setIsNight(updateStatusBarSim(S));
}

// ────── Guest Entity Class ──────
// getSceneryBonusAt() moved to sim/scenery.ts (phase 4); call sites below pass S.
const GUEST_FIRST = ['Ava','Ben','Cleo','Dev','Elle','Finn','Gia','Hugo','Iris','Jax','Kira','Leo','Mira','Nils','Otto','Pia','Quinn','Rosa','Sam','Tess','Uma','Vic','Wren','Xena','Yuri','Zed'];
const GUEST_LAST = ['Alvarez','Brooks','Chen','Diaz','Evans','Farr','Gupta','Hale','Ito','Jensen','Kaur','Lund','Moss','Novak','Owens','Park','Quist','Reyes','Silva','Tran','Vega','Walsh'];


// The sim-owned fields (position, needs, happiness, queueing, ...) and the
// update() logic that mutates them now live in sim/guests.ts (phase 4) as a
// plain interface + pure function -- this class spreads that data on
// construction and delegates update() to it, keeping only the display-only
// fields (color, balloonColor, name) and draw() here until render/ splits out.
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
    /** Per-guest walk-cycle offset, so a crowd doesn't stride in unison.
     *  Display-only, like color/name -- sim/guests.ts knows nothing about it. */
    walkPhase: number;

    constructor(startX: number, startY: number) {
        Object.assign(this, createGuest(startX, startY));
        this.color = ['#ef4444', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6', '#10b981', '#f97316'][Math.floor(Math.random()*7)];
        this.balloonColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        this.name = GUEST_FIRST[Math.floor(Math.random() * GUEST_FIRST.length)] + ' ' + GUEST_LAST[Math.floor(Math.random() * GUEST_LAST.length)];
        this.walkPhase = Math.random() * 1000;
    }

    update() {
        // Cast: this class carries display fields (color, name, balloonColor)
        // sim/guests.ts's Guest interface doesn't know about, on top of the
        // sim-owned fields it does -- see the class comment above.
        for (const e of updateGuestSim(S, this as any)) logEvent(e.msg, e.type);
    }

    draw() {
        // Don't draw if queued
        if (this.queuedAt) return;

        // Per-guest lane within the tile -- see guestOffset(). Applied in MAP
        // space so the spread turns with the park.
        const off = guestOffset(this.walkPhase);
        let currentMapX = this.x + (this.targetX - this.x) * this.progress + off.ox;
        let currentMapY = this.y + (this.targetY - this.y) * this.progress + off.oy;
        let pos = toScreen(currentMapX, currentMapY);

        let hop = Math.sin(this.progress * Math.PI) * 4;

        // Contact shadow. Two jobs: it anchors the figure to the ground, and
        // it separates overlapping guests in a crowd -- a body reads as being
        // in FRONT of the one behind when it casts over it.
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, 4.2, 2.0, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();

        // Baked walking figure (render/guestsprite.ts). Its anchor is the
        // guest's FEET, so the hop is applied to the blit position rather than
        // being part of the animation -- the sheet's frames are the stride.
        // walkPhase keeps guests out of lockstep; without it a crowd marches
        // in formation. `?? 0` because saves written before this existed
        // hydrate without the field.
        const drewSprite = drawGuestSprite(
            ctx, pos.x, pos.y - hop, this.color,
            this.targetX - this.x, this.targetY - this.y,
            simClock + (this.walkPhase ?? 0),
        );

        if (!drewSprite) {
            // Vector fallback, unchanged: the sheet may not have decoded yet.
            ctx.beginPath();
            ctx.arc(pos.x, pos.y - 4 - hop, 3, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
        }

        // Overhead decorations sit above the head, which is much higher on the
        // baked figure (~20px) than on the 3px dot it replaced.
        const headY = pos.y - hop - (drewSprite ? 21 : 7);
        const handY = pos.y - hop - (drewSprite ? 12 : 6);

        // Balloon on a string
        if (this.hasBalloon) {
            const bob = Math.sin(simClock * 0.003 + this.x * 7) * 1.5;
            ctx.strokeStyle = 'rgba(148,163,184,0.7)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(pos.x + 2, handY);
            ctx.lineTo(pos.x + 4, headY - 4 + bob);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(pos.x + 4, headY - 7 + bob, 3, 0, Math.PI * 2);
            ctx.fillStyle = this.balloonColor;
            ctx.fill();
        }

        // Happiness indicator — tiny emoji above head for very happy / unhappy
        if (this.happiness >= 85) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = '6px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('★', pos.x, headY - 3);
        } else if (this.happiness <= 20) {
            ctx.fillStyle = '#ef4444';
            ctx.font = '6px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!', pos.x, headY - 3);
        }
    }
}

// ────── Ride Queue Processing ──────
// The tick logic moved to sim/rides.ts (phase 4); this wrapper just turns its
// returned events into logEvent() calls, an ui/render concern.
function processRideQueues() {
    for (const e of processRideQueuesSim(S)) logEvent(e.msg, e.type);
}

// ────── Economy Loop ──────
// Driven by the fixed-timestep loop at the bottom of this file, not its own
// setInterval. The tick logic itself (time/day advance, weather, attendance,
// ride queues, midnight fireworks) and the daily-books bookkeeping both moved
// to sim/economy.ts (phase 4). This wrapper turns the returned events/flags
// into UI side effects: logEvent, constructing display-owning Guest instances
// for new arrivals (sim can't -- see sim/guests.ts), closing the guest panel
// if the currently-inspected guest just left, refreshing the palette on a
// research unlock, and the day-roll UI refresh.
//
// fireworksActive/fireworksTimer stay module-level here -- transient FX, not
// part of GameState (see EconomyTickResult's comment in sim/economy.ts) --
// and are threaded through the sim call each tick.
function economyTick() {
    const result = economyTickSim(S, { fireworksActive, fireworksTimer });
    fireworksActive = result.fireworksActive;
    fireworksTimer = result.fireworksTimer;

    for (const e of result.events) logEvent(e.msg, e.type);

    for (let i = 0; i < result.guestsToSpawn; i++) {
        S.visualGuests.push(new Guest(ENTRANCE_X, ENTRANCE_Y));
    }
    if (result.singleLeaver && inspectedGuest === result.singleLeaver) closeGuestPanel();

    if (result.researchUnlocked) {
        refreshPalette();
        sfx('award');
    }
    if (result.checkAwards) evaluateAwards();
    if (result.dayRolled) {
        renderMgmt();
        saveGame();
    }

    checkObjectives();
}

// ────── Math & Drawing Functions ──────
// toScreen/camOffset/toMap moved to render/camera.ts, drawPoly/blockCenter/
// padHalf/drawPolyN/drawGroundShadow/PAD_W/PAD_H/setPad to render/iso.ts
// (phase 4) -- the first render/ slice, and the one that actually pays off
// the "pass ctx explicitly" blocker ARCHITECTURE.md §8 flags: every draw
// function below now takes ctx as its first argument instead of closing
// over the module-level canvas context. toScreen/blockCenter/padHalf/
// setPad keep identical signatures and are imported directly, no wrapper
// needed; camOffset/toMap/drawPoly/drawPolyN/drawGroundShadow need thin
// wrappers here since camera state (zoom/panX/panY) and ctx itself are
// still main.ts residents.
function camOffset() { return camOffsetImpl(canvas, panX, panY); }
function toMap(screenX: number, screenY: number) { return toMapImpl(screenX, screenY, canvas, zoom, panX, panY); }
function drawPoly(x: number, y: number, color: string, borderColor: string = null) { drawPolyImpl(ctx, x, y, color, borderColor); }
function drawPolyN(ax: number, ay: number, sz: number, color: string, borderColor: string = null) { drawPolyNImpl(ctx, ax, ay, sz, color, borderColor); }
function drawGroundShadow(cx: number, cy: number, w: number) { drawGroundShadowImpl(ctx, cx, cy, w); }

function drawIsoDeck(cx: number, cy: number, k: number, topFill: string, sideFill: string, lift: number) { drawIsoDeckImpl(ctx, cx, cy, k, topFill, sideFill, lift); }
function drawPadFence(cx: number, cy: number, k: number, postColor: string, railColor: string) { drawPadFenceImpl(ctx, cx, cy, k, postColor, railColor); }

// drawEntrance/drawParkFence moved to render/sprites/scenery.ts (phase 4);
// thin wrappers since render() still calls these two directly (they're not
// in the SPRITES table -- the gate and the boundary fence are drawn once
// each, not per-cell). Every other scenery/ride/shop draw function's
// main.ts wrapper is gone: now that render/sprites/index.ts's SPRITES table
// imports them directly, the wrappers had no remaining caller.
function drawEntrance(cx: number, cy: number) {
    // Baked gate turns with the map; the vector original is the pre-decode
    // fallback, as with every other sprite. The night bulbs are an overlay on
    // top of the blit -- the gate isn't in SPRITES, so it has no automatic
    // overlay hook and has to do it here.
    if (drawEntranceSprite(ctx, cx, cy)) {
        if (isNight) drawEntranceNightImpl(ctx, cx, cy, ENTRANCE_X, ENTRANCE_Y);
        return;
    }
    drawEntranceImpl(ctx, cx, cy, ENTRANCE_X, ENTRANCE_Y);
}
function drawParkFence() { drawParkFenceImpl(ctx, S, ENTRANCE_Y); }

// drawBreakdownSmoke/drawRainFX/drawTooltip/drawRideQueue moved to
// render/effects.ts (phase 4); rainAlpha/rainDrops moved with drawRainFX
// (private to it, same as coasterPath). drawTooltip needs hoveredCell/
// mouseX/mouseY passed explicitly -- those stay main.ts interaction state.
function drawBreakdownSmoke(cx: number, cy: number) { drawBreakdownSmokeImpl(ctx, cx, cy); }
function drawRainFX() { drawRainFXImpl(ctx, canvas, S.weather); }
function drawTooltip() { drawTooltipImpl(ctx, S, canvas, hoveredCell, mouseX, mouseY); }
function drawRideQueue(ax: number, ay: number, queueCount: number, sz: number) { drawRideQueueImpl(ctx, ax, ay, queueCount, sz); }

// ────── Fireworks System ──────
// FireworkShell/FireworkParticle and updateFireworks/drawFireworks moved to
// render/fireworks.ts (phase 4); wrappers below keep the zero-arg signatures.
function updateFireworks() { updateFireworksImpl(fireworksActive, canvas); }
function drawFireworks() { drawFireworksImpl(ctx); }

// ────── Sprite table ──────
// Moved to render/sprites/index.ts (phase 4), now that every draw function
// it references is itself ctx-explicit and lives in render/. Its integrity
// check (every non-path BUILD_DATA id has a sprite) runs at import time
// there, same as before.

// ────── Main Render Loop ──────

function render() {
    // Rotation happens about the grid centre, so camera.ts needs the current
    // size. Set here rather than at boot because land expansion grows it.
    setGridSize(S.gridSize);
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
                const q = drawTileQuad(ctx, x, y, csz,
                    isDark ? '#2e3d52' : '#c3ced9',
                    RIDE_ACCENT[cell] || (isDark ? '#475569' : '#94a3b8'));
                // Expansion joints, interpolated along the pad's real corners
                // so they stay square to it while the map turns.
                type Pt = { x: number; y: number };
                const lerp = (a: Pt, b: Pt, f: number): Pt => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
                ctx.lineWidth = 1;
                for (let g = 1; g < csz; g++) {
                    const f = g / csz;
                    const p1 = lerp(q[0], q[1], f), p2 = lerp(q[3], q[2], f);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                    const p3 = lerp(q[0], q[3], f), p4 = lerp(q[1], q[2], f);
                    ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
                }
            } else if (cell === 'path' || cell === 'entrance') {
                drawTileQuad(ctx, x, y, 1, pathColor, pathBorder);
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
                drawTileQuad(ctx, x, y, 1, grassColor, grassBorder);
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
                drawables.push({ d: depthOf(x, y) + 2 * (sz - 1), fn: () => {
                    // Structures are authored to the pad's real footprint
                    setPad(sz);
                    SPRITES[cell]?.(ctx, center.x, center.y, S);
                    setPad(2);
                    const q = S.rideQueues[aKey];
                    if (q && q.queue > 0) drawRideQueue(x, y, q.queue, sz);
                    if (q && q.broken) drawBreakdownSmoke(center.x, center.y);
                }});
            } else {
                if (cell === 'lamp') lampGlows.push({ x: screenPos.x, y: screenPos.y });
                drawables.push({ d: depthOf(x, y), fn: () => {
                    // The gate is not an attraction; it is drawn once, below.
                    if (cell !== 'entrance') SPRITES[cell]?.(ctx, screenPos.x, screenPos.y, S);
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

    // Guests join the same depth sort at their exact interpolated positions,
    // INCLUDING their per-guest sub-tile offset -- otherwise the spread that
    // stops them overlapping visually doesn't affect who draws in front, and
    // they flicker past each other.
    S.visualGuests.forEach(guest => {
        const go = guestOffset(guest.walkPhase);
        const gmx = guest.x + (guest.targetX - guest.x) * guest.progress + go.ox;
        const gmy = guest.y + (guest.targetY - guest.y) * guest.progress + go.oy;
        drawables.push({ d: depthOf(gmx, gmy) + 0.6, fn: () => {
            guest.draw();
            // Selection ring on the inspected guest
            if (guest === inspectedGuest && !guest.queuedAt) {
                const so = guestOffset(guest.walkPhase);
                const mx = guest.x + (guest.targetX - guest.x) * guest.progress + so.ox;
                const my = guest.y + (guest.targetY - guest.y) * guest.progress + so.oy;
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
        drawables.push({ d: depthOf(mx, my) + 0.7, fn: () => drawStaffOne(w) });
    });

    // The fixed gate draws once, at its centre tile's depth
    {
        const gp = toScreen(ENTRANCE_X, ENTRANCE_Y);
        drawables.push({ d: ENTRANCE_X + ENTRANCE_Y + 1, fn: () => drawEntrance(gp.x, gp.y) });
    }

    drawables.sort((a, b) => a.d - b.d);
    for (const dr of drawables) dr.fn();

    // Hover highlight — drawn after objects so the target tile always reads
    // `currentTool &&` -- with no tool armed there is nothing to preview, and
    // this must SKIP THE BLOCK rather than return: everything after it (guests,
    // the night tint, lamp pools, rain, fireworks) still has to draw.
    if (currentTool && hoveredCell.x >= 0 && hoveredCell.y >= 0 && hoveredCell.x < S.gridSize && hoveredCell.y < S.gridSize) {
        const hx = hoveredCell.x, hy = hoveredCell.y;
        const hCell = S.map[hx][hy];
        const toolData = BUILD_DATA[currentTool];
        if (currentTool === 'bulldozer') {
            const sp = toScreen(hx, hy);
            drawTileQuad(ctx, hx, hy, 1, (hCell === 'entrance') ? 'rgba(156, 163, 175, 0.5)' : 'rgba(239, 68, 68, 0.45)');
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
    if (hasActiveFireworksImpl()) {
        drawFireworks();
    }

    // Hover tooltip
    drawTooltip();

    // Minimap (own canvas) — every 6th frame is plenty
    if (minimapOn && (++miniFrame % 6 === 0)) drawMinimap();

}

// ────── Interaction Logic ──────

/** Takes either kind: it branches on `e.touches` internally. */
function handleInteraction(e: MouseEvent | TouchEvent) {
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    const touches = 'touches' in e ? e.touches : null;
    if (touches && touches.length > 0) {
        clientX = touches[0].clientX;
        clientY = touches[0].clientY;
    } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
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

function buildInCell(x: number, y: number) {
    // No tool armed: look-and-pan mode, nothing to place.
    if (!currentTool) return;
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

                    // A bulldozed path's litter entry otherwise leaks in the
                    // save forever (ARCHITECTURE.md §3.6) -- it stops
                    // affecting cleanliness the moment the tile is no longer
                    // a path, but never gets deleted, and reappears if a
                    // path is rebuilt on the same tile later.
                    delete S.litter[`${ax+dx},${ay+dy}`];
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
            delete S.litter[sKey]; // see the note in the anchored branch above
            if (inspectedKey === sKey) closeRidePanel();
            S.map[x][y] = null;
        }
        // Single writer: both branches cleared map tiles, so re-derive.
        rebuildAnchors(S);
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
        }
    }
    // Single writer: derive the whole table from the map rather than patching
    // entries here. Patching is what let the two copies drift.
    rebuildAnchors(S);
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


// ── Edge scrolling ──
// The classic tycoon mouse gesture: push the pointer to the edge of the map
// and the view follows. It is the one way to pan continuously without holding
// a modifier or a second button, which is what makes the game playable with a
// mouse alone.
//
// Off by default would make it undiscoverable, on by default annoys people
// reaching for the panels -- so it is on, but only inside a 28px band, only
// while the pointer is genuinely over the canvas, and it is toggleable from
// the camera HUD with the choice remembered.
const EDGE_BAND = 28;
const EDGE_SPEED = 850;          // screen px/sec at zoom 1, ~= the key pan rate
let edgeScroll = localStorage.getItem('c2c_edge_scroll') !== '0';
let pointerOnCanvas = false;
let pointerX = 0, pointerY = 0;

function toggleEdgeScroll() {
    edgeScroll = !edgeScroll;
    try { localStorage.setItem('c2c_edge_scroll', edgeScroll ? '1' : '0'); } catch (e) {}
    syncCamHud();
    logEvent(`Edge scrolling ${edgeScroll ? 'on' : 'off'}.`, 'info');
}

/** Screen-space pan from the pointer sitting in an edge band. */
function edgeDelta(wallMs: number) {
    if (!edgeScroll || !pointerOnCanvas || isPanning) return null;
    const r = canvas.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (pointerX - r.left < EDGE_BAND) dx = 1;
    else if (r.right - pointerX < EDGE_BAND) dx = -1;
    if (pointerY - r.top < EDGE_BAND) dy = 1;
    else if (r.bottom - pointerY < EDGE_BAND) dy = -1;
    if (!dx && !dy) return null;
    const len = Math.hypot(dx, dy);
    const v = (EDGE_SPEED * wallMs) / 1000 / Math.max(0.01, zoom);
    return { dx: (dx / len) * v, dy: (dy / len) * v };
}

/** Cursor tells you what the mouse will do: grabbing while panning, crosshair
 *  over the map when a build tool is armed. */
function syncCursor() {
    canvas.style.cursor = isPanning ? 'grabbing'
        : !currentTool ? 'grab'
        : currentTool === 'bulldozer' ? 'cell'
        : 'crosshair';
}

function syncCamHud() {
    const f = document.getElementById('cam-facing');
    if (f) f.textContent = ['N', 'E', 'S', 'W'][rotation];
    const b = document.getElementById('btn-edge');
    if (b) b.classList.toggle('on', edgeScroll);
}

// ── Camera rotation ──
// Spinning about the grid centre keeps the park on screen, but the point the
// player was actually looking at still drifts, because pan is in screen space
// and the projection under it just changed. So: remember which map tile is at
// the centre of the viewport, rotate, then pan so that same tile is back under
// the crosshair. Without this, every rotation throws the view somewhere else
// and the feature feels broken rather than useful.
// The turn is animated rather than snapped. A quarter turn that happens
// between two frames gives you no idea which way the park went -- you just
// find yourself somewhere else, which is exactly what "Q and E just move me
// around" was describing.
//
// The map plane rotates CONTINUOUSLY (camera.ts's rotationAngle). The
// structures cannot: each is a bitmap baked at four angles with nothing in
// between, so it snaps to the nearest at the 45-degree midpoint -- while
// everything around it is sweeping, which is the moment the swap is least
// visible. Smooth where the geometry allows, quantised where the art forces
// it.
const ROT_MS = 420;               // long enough to read, short enough not to wait
let rotFrom = 0, rotTo = 0, rotT = 1;
let rotPivot: { x: number; y: number } | null = null;   // map tile held under the viewport centre

function rotateView(delta: number) {
    // Chain from wherever the current turn has got to, so hammering E spins
    // continuously instead of restarting from a snapped angle each time.
    rotFrom = rotationAngle;
    rotTo = Math.round(rotTo) + delta;
    rotT = 0;
    rotPivot = toMap(canvas.width / 2, canvas.height / 2);
    syncCamHud();
}

/** Advance the turn. `wallMs` is real time -- rotation is a camera move, so it
 *  keeps going while the game is paused. */
function stepRotation(wallMs: number) {
    if (rotT >= 1) return;
    rotT = Math.min(1, rotT + wallMs / ROT_MS);
    // Smoothstep: eases out of the old angle and into the new one, so the
    // start and stop don't jolt.
    const e = rotT * rotT * (3 - 2 * rotT);
    setRotationAngle(rotFrom + (rotTo - rotFrom) * e);

    // Keep the tile you were looking at pinned under the viewport centre for
    // the whole sweep. Without this the park orbits away from you as it turns.
    if (rotPivot) {
        const p = toScreen(rotPivot.x, rotPivot.y);
        const o = camOffset();
        panX += canvas.width / 2 - (p.x * zoom + o.x);
        panY += canvas.height / 2 - (p.y * zoom + o.y);
    }
    if (rotT >= 1) {
        setRotationAngle(((rotTo % 4) + 4) % 4);   // land exactly on a baked angle
        rotFrom = rotTo = rotationAngle;
        rotPivot = null;
    }
    syncCamHud();
}

/** Frame the whole park, whatever its size and rotation. */
function recenterView() {
    const c = (S.gridSize - 1) / 2;
    const p = toScreen(c, c);
    panX = -p.x * zoom;
    panY = -p.y * zoom + (canvas.height / 2 - (canvas.height / 4 + 50));
}

// Event Listeners — build, pan (drag/keys), zoom (wheel), rotate (Q/E)
canvas.addEventListener('mouseenter', () => { pointerOnCanvas = true; });
canvas.addEventListener('mouseleave', () => { pointerOnCanvas = false; });
canvas.addEventListener('mousemove', (e) => {
    pointerOnCanvas = true;
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (isPanning) {
        panX += e.clientX - panStart.x;
        panY += e.clientY - panStart.y;
        panStart = { x: e.clientX, y: e.clientY };
        return;
    }
    // A left press that has travelled far enough is a drag, not a click.
    if (pendingClick && Math.hypot(e.clientX - pendingClick.x, e.clientY - pendingClick.y) > DRAG_SLOP) {
        pendingClick = null;
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        syncCursor();
        return;
    }
    handleInteraction(e);
});
// Touch: one finger builds (as before), TWO fingers navigate. Without this a
// tablet could only paint -- there was no way to pan or zoom at all.
let pinch: { x: number; y: number; d: number } | null = null;
function touchMid(e: TouchEvent) {
    const a = e.touches[0], b = e.touches[1];
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2,
             d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
}
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
        isDragging = false;               // cancel any build the first finger started
        const m = touchMid(e);
        if (pinch) {
            panX += m.x - pinch.x;
            panY += m.y - pinch.y;
            if (pinch.d > 0) zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (m.d / pinch.d)));
        }
        pinch = m;
        return;
    }
    pinch = null;
    handleInteraction(e);
}, {passive: false});
/**
 * What left-drag does depends on whether a tool is armed.
 *
 *   TOOL ARMED  -> drag paints. Laying a run of path one click at a time is
 *                  miserable, and this is the gesture everyone reaches for.
 *   NO TOOL     -> drag moves the map, and a click inspects.
 *
 * That split is why "no tool armed" had to exist as a real mode rather than a
 * convenience: it is what frees the left button to mean two different things
 * without a modifier. Shift+drag still pans, so build mode keeps a mouse-only
 * way to move without disarming.
 *
 * In look mode the action is DEFERRED: mousedown commits to nothing, and
 * moving past DRAG_SLOP turns it into a pan while releasing inside it counts
 * as a click. The slop is load-bearing -- without it the hand tremor on an
 * ordinary click registers as a one-pixel drag and swallows the click.
 */
const DRAG_SLOP = 4;              // px of movement before a click becomes a drag
let pendingClick: { x: number; y: number } | null = null;   // a left press not yet resolved

canvas.addEventListener('mousedown', (e) => {
    // Middle / right / Shift keep their old jobs: pan, pan, and paint.
    if (e.button === 1 || e.button === 2) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        syncCursor();
        e.preventDefault();
        return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey) {             // Shift+drag pans, even with a tool armed
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        syncCursor();
        e.preventDefault();
        return;
    }

    if (currentTool) {
        // Build mode. Inspecting still wins over a doomed build, exactly as it
        // did before -- clicking a finished ride should open it, not fail to
        // place something on top of it.
        const rect = canvas.getBoundingClientRect();
        const csx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const csy = (e.clientY - rect.top) * (canvas.height / rect.height);
        if (currentTool !== 'bulldozer') {
            const g = guestAtScreen(csx, csy);
            if (g) { openGuestPanel(g); return; }
            const gp = toMap(csx, csy);
            if (gp.x >= 0 && gp.y >= 0 && gp.x < S.gridSize && gp.y < S.gridSize) {
                const cell = S.map[gp.x]?.[gp.y];
                if (cell && (RIDE_TYPES.has(cell) || SHOP_TYPES.has(cell))) {
                    openRidePanel(anchorKeyAt(gp.x, gp.y));
                    return;
                }
            }
        }
        isDragging = true;        // drag from here on paints
        handleInteraction(e);
        return;
    }

    // Look mode: decide on mouseup whether that was a click or a drag.
    pendingClick = { x: e.clientX, y: e.clientY };
    panStart = { x: e.clientX, y: e.clientY };
    e.preventDefault();
});

/** Run what a left CLICK means at this screen point: inspect, or build. */
function resolveClick(e: MouseEvent) {
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
    // Build explicitly rather than via handleInteraction(): that only places
    // on mousedown/touchstart/drag, and a click now RESOLVES ON MOUSEUP, so
    // routing through it silently placed nothing.
    handleInteraction(e);
    if (gp.x >= 0 && gp.y >= 0 && gp.x < S.gridSize && gp.y < S.gridSize) {
        buildInCell(gp.x, gp.y);
    }
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const o = camOffset();
    const wx = (mx - o.x) / zoom, wy = (my - o.y) / zoom;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    panX = mx - canvas.width / 2 - wx * zoom;
    panY = my - (canvas.height / 4 + 50) - wy * zoom;
}, { passive: false });
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 2) { pinch = touchMid(e); isDragging = false; return; }
    isDragging = true;
    handleInteraction(e);
});
window.addEventListener('mouseup', (e) => {
    if (pendingClick && e.button === 0) { const p = pendingClick; pendingClick = null; void p; resolveClick(e); }
    pendingClick = null;
    isDragging = false;
    isPanning = false;
    syncCursor();
});
window.addEventListener('touchend', () => { isDragging = false; pinch = null; });

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
    // Held-key panning: the handler only records state; the frame loop moves
    // the camera, so speed doesn't depend on the OS key-repeat rate.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && panKeyDown(k)) { e.preventDefault(); return; }
    if (k === 'q') { rotateView(-1); return; }
    if (k === 'e') { rotateView(1); return; }
    if (k === '[') { zoom = Math.max(MIN_ZOOM, zoom * 0.85); return; }
    if (k === ']') { zoom = Math.min(MAX_ZOOM, zoom * 1.18); return; }
    if (k === 'c' || k === 'home') { recenterView(); return; }
    if (e.key === 'Escape') {
        if (!document.getElementById('mgmt').classList.contains('hidden')) closeMgmt();
        else if (inspectedGuest) closeGuestPanel();
        else if (inspectedKey) closeRidePanel();
        else if (currentTool) clearTool();
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
window.addEventListener('keyup', (e) => { panKeyUp(e.key.toLowerCase()); });
// A keyup that lands on another window would otherwise leave the park
// drifting forever once focus comes back.
window.addEventListener('blur', clearHeldKeys);

// Keep open panels' live numbers ticking
setInterval(() => {
    if (document.hidden) return;
    if (inspectedKey) renderRideStats();
    if (inspectedGuest) renderGuestStats();
    if (mgmtTab === 'staff' && !document.getElementById('mgmt').classList.contains('hidden')) renderMgmt();
}, 700);

// Minimap click-to-jump
document.getElementById('minimap').addEventListener('click', (e: MouseEvent) => {
    const r = minimapJumpImpl(e, S, canvas, zoom);
    panX = r.panX;
    panY = r.panY;
});

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
    rotateLeft:         () => rotateView(-1),
    rotateRight:        () => rotateView(1),
    zoomIn:             () => { zoom = Math.min(MAX_ZOOM, zoom * 1.25); },
    zoomOut:            () => { zoom = Math.max(MIN_ZOOM, zoom * 0.8); },
    recenterView,
    toggleEdgeScroll,
    toggleObjectives,
    closeGuestPanel,
    closeRidePanel,
    renameRandom,
    demolishInspected,

    // `arg` comes from a data-arg attribute, so it is always a string. The
    // casts are the one honest place to narrow it -- the DOM cannot carry the
    // union, and every alternative pushes `any` further into the sim.
    hireStaff:          (arg) => hireStaff(arg as StaffKindId),
    fireStaff:          (arg) => fireStaff(arg as StaffKindId),
    startCampaign:      (arg) => startCampaign(arg as MarketingCampaignId),
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

    // Camera movement uses WALL time, not sim time: the view keeps moving
    // while the game is paused.
    const nav = panDelta(wall, zoom);
    if (nav.dx || nav.dy) { panX += nav.dx; panY += nav.dy; }
    const edge = edgeDelta(wall);
    if (edge) { panX += edge.dx; panY += edge.dy; }
    stepRotation(wall);

    const simMs = wall * gameSpeed;
    advanceSimClock(simMs);
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

// Paint the camera HUD's initial state (compass letter, edge-scroll toggle)
// and set the cursor for the armed tool before the first frame.
syncCamHud();
syncCursor();

lastFrameAt = performance.now();
requestAnimationFrame(frame);
