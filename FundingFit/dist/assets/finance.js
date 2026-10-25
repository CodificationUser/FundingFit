/**
 * FundingFit: fixed-rate, monthly, fully amortising loans.
 * Monetary arithmetic uses integer cents and exact rational rates. Fees are
 * paid separately at time zero; the full principal is advanced to the borrower.
 * This illustrative effective cost is not a regulated APR/TAEG quotation.
 */

export class LoanValidationError extends Error {
  constructor(issues) {
    super(issues.join(" "));
    this.name = "LoanValidationError";
    this.issues = issues;
  }
}

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'];

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function numeric(value, field) {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && value.trim() === "") ||
      !Number.isFinite(Number(value))) {
    throw new LoanValidationError([`${field} must be a finite number.`]);
  }
  return Number(value);
}

function rational(value) {
  const [mantissa, exponentText = "0"] = String(value).toLowerCase().split("e");
  const exponent = Number(exponentText);
  const sign = mantissa.startsWith("-") ? -1n : 1n;
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  let numerator = sign * BigInt((whole || "0") + fraction);
  const scale = fraction.length - exponent;
  if (scale < 0) numerator *= 10n ** BigInt(-scale);
  return [numerator, scale > 0 ? 10n ** BigInt(scale) : 1n];
}

function roundRatio(numerator, denominator) {
  // All amounts being rounded are nonnegative: round halves away from zero.
  return (2n * numerator + denominator) / (2n * denominator);
}

function cents(value, field) {
  const parsed = numeric(value, field);
  if (parsed < 0) throw new LoanValidationError([`${field} must be nonnegative.`]);
  const [numerator, denominator] = rational(parsed);
  const result = roundRatio(numerator * 100n, denominator);
  if (result > MAX_CENTS) {
    throw new LoanValidationError([`${field} is outside the supported monetary range.`]);
  }
  return result;
}

function money(value) {
  if (value > MAX_CENTS) {
    throw new LoanValidationError(["Calculated amount is outside the supported monetary range."]);
  }
  return Number(value) / 100;
}

function optionalLimit(value, field) {
  return value === null || value === undefined ? null : cents(value, field);
}

function effectiveAnnualCost(netAdvance, payments, nominalAnnualRate) {
  const total = payments.reduce((sum, payment) => sum + payment, 0);
  if (total === netAdvance) return 0;
  const presentValue = (rate) => payments.reduce(
    (sum, payment, index) => sum + payment * Math.exp(-(index + 1) * Math.log1p(rate)), 0,
  );
  let low = 0;
  let high = Math.max(0.01, nominalAnnualRate / 1200);
  while (presentValue(high) > netAdvance) high *= 2;
  for (let step = 0; step < 160; step += 1) {
    const middle = (low + high) / 2;
    if (presentValue(middle) > netAdvance) low = middle;
    else high = middle;
  }
  const percent = 100 * Math.expm1(12 * Math.log1p((low + high) / 2));
  return Number(percent.toFixed(8));
}

/**
 * calculateLoan({id?, name?, principal, annual_rate_pct, term_months, upfront_fee})
 * All money outputs are in the same currency as the input, to two decimals.
 * annual_effective_cost is an annual percentage (5.2 means 5.2%, not 0.052).
 * The final payment adjusts rounding; max_monthly_payment includes it.
 * Throws LoanValidationError on invalid or unsupported inputs.
 */
export function calculateLoan(offer) {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
    throw new LoanValidationError(["An offer object is required."]);
  }
  const principalCents = cents(offer.principal, "principal");
  const feeCents = cents(offer.upfront_fee, "upfront_fee");
  const annualRate = numeric(offer.annual_rate_pct, "annual_rate_pct");
  const term = numeric(offer.term_months, "term_months");
  const currency = offer.currency === undefined ? 'EUR' :
    typeof offer.currency === 'string' ? offer.currency.trim().toUpperCase() : '';
  const issues = [];
  if (principalCents <= 0n) issues.push("principal must be at least 0.01.");
  if (annualRate < 0 || annualRate > 50) issues.push("annual_rate_pct must be between 0 and 50.");
  if (!Number.isInteger(term) || term < 1 || term > 120) issues.push("term_months must be an integer between 1 and 120.");
  if (feeCents >= principalCents) issues.push("upfront_fee must be less than principal.");
  if (!SUPPORTED_CURRENCIES.includes(currency)) issues.push("currency must be EUR, USD or GBP.");
  if (offer.rate_type !== undefined && String(offer.rate_type).toLowerCase() !== "fixed") {
    issues.push("Only fixed-rate offers are supported.");
  }
  if (issues.length) throw new LoanValidationError(issues);

  const [rateNumerator, annualRateDenominator] = rational(annualRate);
  const rateDenominator = annualRateDenominator * 1200n;
  let regularPayment;
  if (rateNumerator === 0n) {
    regularPayment = roundRatio(principalCents, BigInt(term));
  } else {
    const accumulated = (rateDenominator + rateNumerator) ** BigInt(term);
    const original = rateDenominator ** BigInt(term);
    regularPayment = roundRatio(
      principalCents * rateNumerator * accumulated,
      rateDenominator * (accumulated - original),
    );
  }

  let opening = principalCents;
  let totalInterest = 0n;
  let maximumPayment = 0n;
  const paymentCents = [];
  const schedule = [];
  for (let month = 1; month <= term; month += 1) {
    const interest = roundRatio(opening * rateNumerator, rateDenominator);
    const amountDue = opening + interest;
    const payment = month === term || regularPayment > amountDue ? amountDue : regularPayment;
    const principalPaid = payment - interest;
    const closing = opening - principalPaid;
    if (closing < 0n || principalPaid < 0n) {
      throw new LoanValidationError(["The rounded loan schedule could not be amortised."]);
    }
    schedule.push({month, opening: money(opening), interest: money(interest),
      principal: money(principalPaid), payment: money(payment), closing: money(closing)});
    totalInterest += interest;
    if (payment > maximumPayment) maximumPayment = payment;
    paymentCents.push(Number(payment));
    opening = closing;
  }
  const totalCost = totalInterest + feeCents;
  return {
    ...offer,
    id: offer.id ?? null,
    name: offer.name ?? "Unnamed offer",
    currency,
    principal: money(principalCents), annual_rate_pct: annualRate,
    term_months: term, upfront_fee: money(feeCents),
    monthly_payment: money(regularPayment),
    max_monthly_payment: money(maximumPayment),
    interest_total: money(totalInterest),
    total_cost: money(totalCost),
    total_repayment: money(principalCents + totalCost),
    upfront_cash: money(feeCents),
    annual_effective_cost: effectiveAnnualCost(Number(principalCents - feeCents), paymentCents, annualRate),
    schedule,
  };
}

/**
 * compareOffers(offers, {monthlyLimit?, upfrontBudget?} = {})
 * Null/omitted limits are unrestricted. Feasibility uses the highest actual
 * payment, including the adjusted final payment. Invalid offers are retained
 * with valid:false and issues. Different amounts/terms/currencies suppress a
 * winner because absolute borrowing costs would not be directly comparable.
 */
export function compareOffers(offers, options = {}) {
  if (!Array.isArray(offers)) throw new LoanValidationError(["offers must be an array."]);
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new LoanValidationError(["Comparison options must be an object."]);
  }
  const monthlyLimit = optionalLimit(options.monthlyLimit, "monthlyLimit");
  const upfrontBudget = optionalLimit(options.upfrontBudget, "upfrontBudget");
  const issues = [];
  const valid = [];
  const invalid = [];
  offers.forEach((offer, index) => {
    try {
      const loan = calculateLoan(offer);
      valid.push({...loan, valid: true, monthly_feasible: null,
        upfront_feasible: null, feasible: null, issues: [], cost_rank: null});
    } catch (error) {
      if (!(error instanceof LoanValidationError)) throw error;
      const label = offer?.id ?? offer?.name ?? `Offer ${index + 1}`;
      issues.push(`${label}: ${error.message}`);
      invalid.push({...(offer && typeof offer === "object" ? offer : {}),
        id: offer?.id ?? null, name: offer?.name ?? `Offer ${index + 1}`,
        valid: false, feasible: false, monthly_feasible: false,
        upfront_feasible: false, cost_rank: null, issues: error.issues});
    }
  });
  const reference = valid[0];
  const currencies = [...new Set(valid.map(offer=>offer.currency))];
  const mixedCurrency = currencies.length > 1;
  const currency = currencies.length === 1 ? currencies[0] : null;
  const comparable = valid.length > 0 && valid.every((offer) =>
    offer.principal === reference.principal && offer.term_months === reference.term_months &&
    offer.currency === reference.currency);
  if (mixedCurrency) {
    issues.push("Different currencies cannot share a cost ranking or cash limits. Use offers in one currency; no currency conversion is performed.");
    for (const offer of valid) offer.issues.push("Cash-limit feasibility is not calculated across different currencies.");
  } else {
    for (const offer of valid) {
      offer.monthly_feasible = monthlyLimit === null || cents(offer.max_monthly_payment, "payment") <= monthlyLimit;
      offer.upfront_feasible = upfrontBudget === null || cents(offer.upfront_cash, "fee") <= upfrontBudget;
      offer.feasible = offer.monthly_feasible && offer.upfront_feasible;
      if (!offer.monthly_feasible) offer.issues.push("The highest monthly payment exceeds the monthly limit.");
      if (!offer.upfront_feasible) offer.issues.push("The upfront fee exceeds the upfront cash budget.");
    }
  }
  if (valid.length && !comparable) {
    issues.push("Compare offers with the same principal, duration and currency before choosing a winner.");
  }
  if (!offers.length) issues.push("No offers were provided.");
  if (comparable) valid.sort((left, right) => left.total_cost - right.total_cost ||
    left.upfront_cash - right.upfront_cash ||
    (String(left.id ?? "") < String(right.id ?? "") ? -1 : String(left.id ?? "") > String(right.id ?? "") ? 1 : 0));
  valid.forEach((offer, index) => { offer.cost_rank = comparable ? index + 1 : null; });
  return {
    offers: [...valid, ...invalid], comparable, currency, currencies, mixedCurrency,
    cheapest_overall: comparable ? valid[0] ?? null : null,
    cheapest_feasible: comparable ? valid.find((offer) => offer.feasible) ?? null : null,
    limits: {currency, monthly_limit: monthlyLimit === null ? null : money(monthlyLimit),
      upfront_budget: upfrontBudget === null ? null : money(upfrontBudget)},
    issues,
  };
}
