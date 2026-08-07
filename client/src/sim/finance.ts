/**
 * Every movement of money.
 *
 * The monolith had earn()/spend() that maintained the ledger, and then four
 * places that moved `funds` directly and bypassed it entirely:
 *
 *   buildInCell() bulldozer, anchored branch   funds += refund
 *   buildInCell() bulldozer, single-tile       funds += refund
 *   undoLast() build-undo                      funds += e.cost
 *   undoLast() demolish-restore                funds -= e.refund
 *
 * So the Finance tab's all-time totals drifted permanently the first time you
 * demolished or undid anything, and income - expense stopped reconciling against
 * funds. Making this module the only thing that writes `state.funds` is what
 * stops that recurring.
 *
 * The invariant it guarantees, checked by tests and by the server on save:
 *
 *     funds === STARTING_FUNDS + sum(income) - sum(expense)
 */

import { STARTING_FUNDS, type GameState, type Ledger } from '../core/state';

export type IncomeBucket = keyof Ledger['income'];
export type ExpenseBucket = keyof Ledger['expense'];

export function earn(state: GameState, amount: number, bucket: IncomeBucket): void {
  state.funds += amount;
  state.ledger.income[bucket] += amount;
  state.dayLedger.income[bucket] += amount;
}

export function spend(state: GameState, amount: number, bucket: ExpenseBucket): void {
  state.funds -= amount;
  state.ledger.expense[bucket] += amount;
  state.dayLedger.expense[bucket] += amount;
}

/** Undo an earn(). Reverses the ledger entry rather than booking an expense, so
 *  the totals read as if it never happened. */
export function unearn(state: GameState, amount: number, bucket: IncomeBucket): void {
  state.funds -= amount;
  state.ledger.income[bucket] -= amount;
  state.dayLedger.income[bucket] -= amount;
}

/** Undo a spend(). */
export function unspend(state: GameState, amount: number, bucket: ExpenseBucket): void {
  state.funds += amount;
  state.ledger.expense[bucket] -= amount;
  state.dayLedger.expense[bucket] -= amount;
}

export const sumOf = (o: Record<string, number>): number =>
  Object.values(o).reduce((a, b) => a + b, 0);

export const totalIncome = (state: GameState) => sumOf(state.ledger.income);
export const totalExpense = (state: GameState) => sumOf(state.ledger.expense);

/**
 * What `funds` should be, from the ledger alone.
 *
 * The server recomputes this on every save and rejects a mismatch -- see
 * docs/API-CONTRACT.md. It is also why every path has to go through this module.
 */
export function expectedFunds(state: GameState): number {
  return STARTING_FUNDS + totalIncome(state) - totalExpense(state);
}

export function ledgerReconciles(state: GameState, tolerance = 1): boolean {
  return Math.abs(state.funds - expectedFunds(state)) <= tolerance;
}
