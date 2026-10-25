# FundingFit — user guide

FundingFit helps a small business compare loan offers by total borrowing cost
and available cash. Its AI proposes terms from English documents; a person
checks them before the financial calculation runs. It makes the difference
between the lowest advertised rate and the most suitable offer visible.

## Open the application

Extract the folder and double-click **FundingFit.html**. If it opens in an
editor, choose **Open With → Safari, Chrome or Edge**.

No Python, installation, terminal, server, account, API key, paid service or
internet connection is needed. Documents are processed locally in the browser.

## Read, check and compare

1. Choose **Try the case study**, or import one to five TXT or text-based PDF
   offers with **Browse files**. You can also paste complete offer text. One
   offer can be analysed; a comparison needs at least two supported offers.
2. Select **Analyse with AI**. Each proposal includes its supporting text and,
   for PDFs, its page. Check the original document against these proposals.
3. The loan amount, nominal annual rate, term and upfront fee are editable.
   Correct a misread number or enter a missing value. An empty field stays
   unknown; it is never treated as zero.
4. Review the currency and product conditions. The AI's readings are prefilled;
   missing answers stay unknown. Choose only
   what the document or a genuine clarification establishes.
5. Offers with unsupported source conditions are greyed out and left out of
   comparison. An unsupported manual choice also keeps an offer out, but you can
   correct that choice. Unsupported source terms cannot be overridden.
   **Remove offer** removes an offer from the workspace, not from your computer.
6. Check the final verification box for each usable offer. At least two
   supported, checked offers are needed. Any edit clears that offer's check.
7. Compare costs, adjust the monthly and upfront cash limits, and inspect the
   repayment schedule. Amounts and cash limits use the selected currency.
   You can export the comparison as JSON or a schedule as CSV. Manual entries
   remain distinguishable from the original AI proposals.

Currency choices are **EUR, USD and GBP**. Selecting a currency sets the unit;
it does not convert amounts. A comparison needs the same currency, principal
and duration across offers. FundingFit performs no exchange-rate conversion.

Reloading or resetting clears the workspace. Downloaded exports remain on your
device; they can contain the imported offer text.

## Supplied examples

The built-in case finances EUR 100,000 over 60 months:

| Offer | Fixed annual rate | Upfront fee | Interest plus fees |
|---|---:|---:|---:|
| A | 3.50% | EUR 5,000 | EUR 14,150.53 |
| B | 4.20% | EUR 500 | EUR 11,541.48 |
| C | 3.90% | EUR 1,500 | EUR 11,728.58 |

B is cheapest overall. With EUR 1,840 per month and EUR 2,000 upfront, C alone
fits both limits and costs EUR 187.10 more than B.

All examples are fictional. The four supplied original PDFs are unchanged in
`data/layout_examples/original/`. Northbridge A needs confirmation of separate
fee payment. Kestrel C also needs clarification of all other costs. AlderVale B
has an unmanaged valuation charge; Harbourline D has a variable rate and
recurring insurance. These last two cannot be compared by this calculator.
Separate demonstration PDFs are in `data/offers_pdf/`; labelled layout-test
examples are in `data/layout_examples/generated/`.

## Supported loans and developer checks

Use matching currencies, amounts and terms: English, EUR/USD/GBP, fixed nominal
annual interest, equal monthly repayments, separately paid upfront fees and no
other charges.
Variable rates, unmanaged charges, financed fees and unsupported repayment
structures cannot be overridden. Scanned PDFs need text extraction first.
The tool does not assess creditworthiness or approve loans.

Editable source, saved model, data and tests are supplied. Node.js 24 is needed
only for these optional development commands:

```sh
node scripts/build_standalone.mjs
node --test tests/*.test.mjs
```

The first rebuilds the ready-to-open HTML without retraining or starting a
server. See **AI_USE.md** for the AI method, development prompts and sources.
