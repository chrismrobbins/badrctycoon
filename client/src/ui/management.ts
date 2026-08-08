import type { GameState } from '../core/state';
import * as Fin from '../sim/finance';
import { parkValue, parkRating } from '../sim/park';
import { perceivedValue, DAILY_INTEREST } from '../sim/economy';
import { staffCount, dailyWages } from '../sim/staff';
import { AWARD_DEFS } from '../sim/awards';
import { STAFF_KINDS, MARKETING_CAMPAIGNS, RESEARCH_ORDER, TYPE_LABEL, BUILD_DATA, type StaffKindId, type MarketingCampaignId } from '../content';

export const LOAN_LIMIT = 60000;

/** `color` is an explicit CSS color -- never rely on inherited text color,
 *  which is white in dark mode and would vanish on a light panel. */
export function row(label: string | number, value: string | number, color?: string | null): string {
  return `<div class="m-row"><span class="l">${label}</span><span class="r"${color ? ` style="color:${color}"` : ''}>${value}</span></div>`;
}

export const C = { green: '#16a34a', red: '#ef4444', blue: '#2563eb', amber: '#f59e0b', purple: '#a855f7', slate: '#94a3b8' };

export function money(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
}

export let mgmtTab = 'finance';

export function openMgmt(state: GameState, tab?: string): void {
  mgmtTab = tab || mgmtTab;
  document.getElementById('mgmt').classList.remove('hidden');
  document.querySelectorAll<HTMLElement>('.mgmt-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === mgmtTab));
  renderMgmt(state);
}

export function closeMgmt(): void {
  document.getElementById('mgmt').classList.add('hidden');
}

export function renderMgmt(state: GameState): void {
  const el = document.getElementById('mgmt-body');
  if (!el || document.getElementById('mgmt').classList.contains('hidden')) return;
  let h = '';

  if (mgmtTab === 'finance') {
    const inc = Fin.sumOf(state.ledger.income),
      exp = Fin.sumOf(state.ledger.expense);
    const dInc = Fin.sumOf(state.dayLedger.income),
      dExp = Fin.sumOf(state.dayLedger.expense);
    const profit = dInc - dExp;
    h += `<div class="m-grid3">
            <div class="m-tile" style="background:rgba(34,197,94,0.1)"><div class="k" style="color:${C.green}">Cash</div><div class="v">${money(state.funds)}</div></div>
            <div class="m-tile" style="background:rgba(59,130,246,0.1)"><div class="k" style="color:${C.blue}">Park Value</div><div class="v">${money(parkValue(state))}</div></div>
            <div class="m-tile" style="background:${profit >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}"><div class="k" style="color:${profit >= 0 ? C.green : C.red}">Today's Profit</div><div class="v">${money(profit)}</div></div>
        </div>`;
    h += `<div class="m-grid2">
            <div><div class="m-sec" style="color:${C.green}">Income (all time)</div>
                ${row('Admissions', money(state.ledger.income.admission))}
                ${row('Ride tickets', money(state.ledger.income.rides))}
                ${row('Shop sales', money(state.ledger.income.shops))}
                ${row('Objective bonuses', money(state.ledger.income.objectives))}
                ${row('Loans drawn', money(state.ledger.income.loans))}
                        ${row('Demolition refunds', money(state.ledger.income.refunds))}
                ${row('Total', money(inc), C.green)}</div>
            <div><div class="m-sec" style="color:${C.red}">Expenses (all time)</div>
                ${row('Construction', money(state.ledger.expense.construction))}
                ${row('Staff wages', money(state.ledger.expense.wages))}
                ${row('Repairs', money(state.ledger.expense.repairs))}
                ${row('Loan interest', money(state.ledger.expense.interest))}
                ${row('Marketing', money(state.ledger.expense.marketing))}
                ${row('Research', money(state.ledger.expense.research))}
                ${row('Land', money(state.ledger.expense.land))}
                ${row('Loan repayments', money(state.ledger.expense.loanRepaid))}
                ${row('Total', money(exp), C.red)}</div>
        </div>`;
    h += `<div class="m-block">
            <div class="m-sec">Admission Price</div>
            <div class="m-flex">
                <input id="price-slider" class="m-slider" type="range" min="0" max="40" value="${state.admissionPrice}" data-act="setAdmission">
                <span id="price-label" style="font-weight:700;font-size:1.05rem;width:5rem;text-align:right;">${money(state.admissionPrice)}</span>
            </div>
            <div class="m-note">Guests will pay up to about <b>${money(perceivedValue(state))}</b> for a park like this. Charge more and attendance drops.</div>
        </div>`;
    h += `<div class="m-block">
            <div class="m-sec">Loans</div>
            ${row('Outstanding balance', money(state.loanBalance), state.loanBalance ? C.red : null)}
            ${row('Daily interest', `${(DAILY_INTEREST * 100).toFixed(1)}% (${money(state.loanBalance * DAILY_INTEREST)}/day)`)}
            ${row('Credit limit', money(LOAN_LIMIT))}
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                <button class="m-btn blue" style="flex:1;padding:0.5rem;" data-act="borrow" data-arg="5000">Borrow $5,000</button>
                <button class="m-btn green" style="flex:1;padding:0.5rem;" data-act="repay" data-arg="5000">Repay $5,000</button>
            </div>
        </div>`;
  } else if (mgmtTab === 'staff') {
    h += `<div class="m-note" style="margin-bottom:1rem;">Wages are paid out of your cash every in-game day. Staff walk your paths — build paths so they can reach things.</div>`;
    for (const k in STAFF_KINDS) {
      const kind = k as StaffKindId;
      const s = STAFF_KINDS[kind],
        n = staffCount(state, kind);
      h += `<div class="m-card">
                <div class="m-icon" style="background:${s.color}22;color:${s.color}"><i class="fas ${s.icon}"></i></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.875rem;">${s.label} <span style="color:${C.slate};font-weight:400;">× ${n}</span></div>
                    <div class="m-note" style="margin-top:0;">${s.blurb} · ${money(s.wage)}/day each</div>
                </div>
                <button class="m-btn red m-iconbtn" data-act="fireStaff" data-arg="${kind}" ${n ? '' : 'disabled'}><i class="fas fa-minus"></i></button>
                <button class="m-btn green m-iconbtn" data-act="hireStaff" data-arg="${kind}"><i class="fas fa-plus"></i></button>
            </div>`;
    }
    h += `<div class="m-block">
            ${row('Total staff', state.staff.length)}
            ${row('Total daily wages', money(dailyWages(state)), C.red)}
            ${row('Park cleanliness', `${Math.round(state.cleanliness)}%`, state.cleanliness > 80 ? C.green : state.cleanliness > 50 ? C.amber : C.red)}
        </div>`;
    if (state.staff.length) {
      h +=
        `<div style="margin-top:1rem;"><div class="m-sec">On Shift</div>` +
        state.staff
          .map(
            (w) =>
              `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span><i class="fas ${STAFF_KINDS[w.kind].icon}" style="color:${STAFF_KINDS[w.kind].color};margin-right:0.375rem;"></i>${w.name}</span><span style="color:${C.slate};font-style:italic;">${w.task || 'starting shift'}</span></div>`,
          )
          .join('') +
        `</div>`;
    }
  } else if (mgmtTab === 'marketing') {
    h += `<div class="m-note" style="margin-bottom:1rem;">Campaigns temporarily raise how many guests show up. They stack with your rating and happiness.</div>`;
    if (state.marketing.key) {
      const c = MARKETING_CAMPAIGNS[state.marketing.key as MarketingCampaignId];
      h += `<div class="m-tile" style="background:rgba(59,130,246,0.1);margin-bottom:1rem;">
                <div style="font-weight:700;font-size:0.875rem;color:${C.blue}"><i class="fas fa-bullhorn" style="margin-right:0.25rem;"></i>${c.label} running</div>
                <div class="m-note">+${Math.round(c.boost * 100)}% attendance · ${state.marketing.daysLeft} day(s) left</div>
            </div>`;
    }
    for (const k in MARKETING_CAMPAIGNS) {
      const c = MARKETING_CAMPAIGNS[k as MarketingCampaignId];
      h += `<div class="m-card">
                <div style="flex:1;"><div style="font-weight:700;font-size:0.875rem;">${c.label}</div>
                <div class="m-note" style="margin-top:0;">+${Math.round(c.boost * 100)}% attendance for ${c.days} days</div></div>
                <button class="m-btn blue" data-act="startCampaign" data-arg="${k}">${money(c.cost)}</button>
            </div>`;
    }
    h += `<div class="m-block">
            ${row('Current attendance', `${state.guests} guests`)}
            ${row('Park rating', parkRating(state))}
            ${row('Average happiness', `${Math.round(state.parkHappiness)}%`)}
        </div>`;
  } else if (mgmtTab === 'research') {
    const next = RESEARCH_ORDER.find((t) => !state.research.unlocked.includes(t));
    h += `<div class="m-note" style="margin-bottom:1rem;">Your R&amp;D team designs new attractions. Higher funding unlocks them faster — the cost is billed daily.</div>`;
    if (next) {
      h += `<div class="m-tile" style="background:rgba(168,85,247,0.1);margin-bottom:1rem;">
                <div class="k" style="color:${C.purple}">Now designing</div>
                <div style="font-weight:700;font-size:1rem;margin:2px 0 0.5rem;">${TYPE_LABEL[next]}</div>
                <div class="meter"><span style="width:${Math.min(100, state.research.progress)}%;background:${C.purple}"></span></div>
                <div class="m-note">${Math.floor(state.research.progress)}% complete</div>
            </div>`;
    } else {
      h += `<div class="m-tile" style="background:rgba(34,197,94,0.1);margin-bottom:1rem;color:${C.green};font-weight:700;"><i class="fas fa-check-circle" style="margin-right:0.25rem;"></i>All attractions researched. Your engineers are napping.</div>`;
    }
    h += `<div class="m-sec">Daily Research Budget</div>
        <div class="m-flex" style="margin-bottom:1.25rem;">
            <input type="range" class="m-slider purple" min="0" max="500" step="25" value="${state.research.budget}" data-act="setResearchBudget">
            <span style="font-weight:700;width:6rem;text-align:right;">${money(state.research.budget)}/day</span>
        </div>`;
    h += `<div class="m-sec">Attraction List</div><div class="m-list">`;
    for (const t of RESEARCH_ORDER) {
      const got = state.research.unlocked.includes(t);
      h += `<div class="m-chip${got ? ' got' : ''}"><i class="fas ${got ? 'fa-check' : 'fa-lock'}"></i>${TYPE_LABEL[t]}<span class="sp">${money(BUILD_DATA[t].cost)}</span></div>`;
    }
    h += `</div>`;
  } else if (mgmtTab === 'awards') {
    h += `<div class="m-note" style="margin-bottom:1rem;">Inspectors visit every few days. Meet the criteria and your park earns a permanent rating boost.</div>`;
    for (const a of AWARD_DEFS) {
      const won = state.awardsWon.find((w) => w.id === a.id);
      h += `<div class="m-card"${won ? ' style="background:rgba(234,179,8,0.1)"' : ''}>
                <div class="m-icon" style="${won ? 'background:rgba(234,179,8,0.2);color:#eab308' : 'background:rgba(100,116,139,0.12);color:#94a3b8'}"><i class="fas ${a.icon}"></i></div>
                <div style="flex:1;"><div style="font-weight:700;font-size:0.875rem;${won ? '' : `color:${C.slate}`}">${a.label}</div>
                <div class="m-note" style="margin-top:0;">${won ? `Won on day ${won.day}` : 'Not yet earned'} · +${a.rating} rating</div></div>
                ${won ? '<i class="fas fa-trophy" style="color:#eab308"></i>' : ''}
            </div>`;
    }
    h += `<div class="m-block" style="font-weight:700;font-size:0.8rem;">${state.awardsWon.length} / ${AWARD_DEFS.length} awards won</div>`;
  }

  el.innerHTML = h;
}
