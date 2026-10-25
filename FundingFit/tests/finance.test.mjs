import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLoan, compareOffers, LoanValidationError} from '../dist/assets/finance.js';

const offer = (changes = {}) => ({id: 'X', name: 'Test offer', principal: 100000,
  annual_rate_pct: 4.2, term_months: 60, upfront_fee: 500, ...changes});
const exampleOffers = () => [offer({id: 'A', annual_rate_pct: 3.5, upfront_fee: 5000}),
  offer({id: 'B'}), offer({id: 'C', annual_rate_pct: 3.9, upfront_fee: 1500})];
const inCents = (value) => Math.round(value * 100);

test('zero interest produces equal payments, no interest, and counts the upfront fee once', () => {
  const result = calculateLoan(offer({principal: 1200, annual_rate_pct: 0, term_months: 12, upfront_fee: 12}));
  assert.equal(result.monthly_payment, 100);
  assert.equal(result.interest_total, 0);
  assert.equal(result.total_cost, 12);
  assert.equal(result.total_repayment, 1212);
  assert.equal(result.upfront_cash, 12);
  assert.ok(result.schedule.every((row) => row.payment === 100));
  assert.ok(result.annual_effective_cost > 0);
  assert.equal(calculateLoan(offer({annual_rate_pct: 0, upfront_fee: 0})).annual_effective_cost, 0);
});

test('demo figures match independent PMT reference values and cent-rounded payment ledger', () => {
  const reference = [
    ['A', 1819.17, 1819.50, 9150.53, 14150.53],
    ['B', 1850.69, 1850.77, 11041.48, 11541.48],
    ['C', 1837.14, 1837.32, 10228.58, 11728.58],
  ];
  exampleOffers().forEach((input, index) => {
    const result = calculateLoan(input);
    assert.deepEqual([result.id, result.monthly_payment, result.schedule.at(-1).payment,
      result.interest_total, result.total_cost], reference[index]);
  });
});

test('each rounded schedule balances and is completely paid off, including short/tiny loans', () => {
  const inputs = [...exampleOffers(),
    offer({principal: 0.60, annual_rate_pct: 0, term_months: 120, upfront_fee: 0}),
    offer({principal: 0.01, annual_rate_pct: 0, term_months: 120, upfront_fee: 0}),
    offer({principal: 12345.67, annual_rate_pct: 50, term_months: 120, upfront_fee: 345.67}),
    offer({principal: 1000, annual_rate_pct: 12, term_months: 1, upfront_fee: 0})];
  for (const input of inputs) {
    const result = calculateLoan(input);
    const rows = result.schedule;
    assert.equal(rows.length, input.term_months);
    assert.equal(rows.at(-1).closing, 0);
    let principalPaid = 0;
    let interestPaid = 0;
    let payments = 0;
    rows.forEach((row, index) => {
      assert.equal(row.month, index + 1);
      assert.equal(inCents(row.payment), inCents(row.interest) + inCents(row.principal));
      assert.equal(inCents(row.opening) - inCents(row.principal), inCents(row.closing));
      if (index > 0) assert.equal(row.opening, rows[index - 1].closing);
      assert.ok(row.closing >= 0 && row.principal >= 0);
      principalPaid += inCents(row.principal);
      interestPaid += inCents(row.interest);
      payments += inCents(row.payment);
    });
    assert.equal(principalPaid, inCents(result.principal));
    assert.equal(interestPaid, inCents(result.interest_total));
    assert.equal(payments + inCents(result.upfront_fee), inCents(result.total_repayment));
    assert.equal(result.max_monthly_payment, Math.max(...rows.map((row) => row.payment)));
  }
});

test('effective annual cost equals the analytic yield of a one-payment loan', () => {
  const result = calculateLoan(offer({principal: 1000, annual_rate_pct: 12, term_months: 1, upfront_fee: 20}));
  assert.equal(result.schedule[0].payment, 1010);
  const expected = 100 * ((1010 / 980) ** 12 - 1);
  assert.ok(Math.abs(result.annual_effective_cost - expected) < 1e-7);
  const noFee = calculateLoan(offer({principal: 1000, annual_rate_pct: 12, term_months: 1, upfront_fee: 0}));
  assert.ok(result.annual_effective_cost > noFee.annual_effective_cost);
});

test('lowest nominal rate is not cheapest; cash constraints select C', () => {
  const inputs = exampleOffers();
  const original = structuredClone(inputs);
  const result = compareOffers(inputs, {monthlyLimit: 1840, upfrontBudget: 2000});
  assert.equal(result.cheapest_overall.id, 'B');
  assert.equal(result.cheapest_feasible.id, 'C');
  assert.deepEqual(result.offers.map((row) => [row.id, row.cost_rank, row.feasible]),
    [['B', 1, false], ['C', 2, true], ['A', 3, false]]);
  assert.equal(result.offers.find((row) => row.id === 'B').monthly_feasible, false);
  assert.equal(result.offers.find((row) => row.id === 'A').upfront_feasible, false);
  assert.deepEqual(inputs, original);
});

test('feasibility includes the slightly higher final payment and allows equality', () => {
  const result = compareOffers([offer()], {monthlyLimit: 1850.69, upfrontBudget: 500});
  assert.equal(result.cheapest_feasible, null);
  assert.equal(result.offers[0].upfront_feasible, true);
  assert.equal(compareOffers([offer()], {monthlyLimit: 1850.77, upfrontBudget: 500}).cheapest_feasible.id, 'X');
});

test('missing and invalid values fail, without treating missing fees as zero', () => {
  const changes = [{principal: 0}, {principal: -1}, {annual_rate_pct: -0.01},
    {annual_rate_pct: 50.01}, {term_months: 0}, {term_months: 121},
    {term_months: 12.5}, {upfront_fee: -1}, {upfront_fee: 100000},
    {upfront_fee: undefined}, {annual_rate_pct: null}, {principal: NaN},
    {principal: Infinity}, {principal: true}, {rate_type: 'variable'}];
  changes.forEach((change) => assert.throws(() => calculateLoan(offer(change)), LoanValidationError));
  assert.throws(() => compareOffers(exampleOffers(), {monthlyLimit: -1}), LoanValidationError);
});

test('comparison retains invalid offers for explanation and returns no winner if nothing is feasible', () => {
  const result = compareOffers([offer(), offer({id: 'D', upfront_fee: null})], {monthlyLimit: 1});
  assert.equal(result.cheapest_overall.id, 'X');
  assert.equal(result.cheapest_feasible, null);
  assert.equal(result.offers[1].valid, false);
  assert.ok(result.offers[1].issues.join(' ').includes('upfront_fee'));
  assert.equal(compareOffers([]).cheapest_overall, null);
});

test('different amounts, durations or currencies suppress a misleading winner', () => {
  for (const change of [{principal: 90000}, {term_months: 48}, {currency: 'USD'}]) {
    const result = compareOffers([offer(), offer({id: 'Y', ...change})]);
    assert.equal(result.comparable, false);
    assert.equal(result.cheapest_overall, null);
    assert.equal(result.cheapest_feasible, null);
    assert.ok(result.issues.length > 0);
  }
});

test('money normalisation uses decimal half-up rounding, not binary float ties', () => {
  const result = calculateLoan(offer({principal: '1000.005', annual_rate_pct: '0', term_months: '1', upfront_fee: '0.005'}));
  assert.equal(result.principal, 1000.01);
  assert.equal(result.upfront_fee, 0.01);
  assert.equal(result.monthly_payment, 1000.01);
});
