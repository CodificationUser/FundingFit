# PDF examples

All lenders and offers in these files are fictional.

- `original/` contains the four unchanged supplied PDFs: Northbridge, AlderVale,
  Kestrel and Harbourline. Their hashes and explicit field values are recorded
  in `expected_cases.json`.
- `generated/` contains separate, labelled layout fixtures: wrapped text, tables,
  stacked labels and summary cards, plus unsupported-rate, extra-cost and
  conflicting-rate examples. They do not replace the originals.
- `text/` contains semantic counterparts used by extraction tests, rather than
  claims about raw PDF.js output.
- `../offers_pdf/` contains the separate built-in A/B/C demonstration PDFs and
  deliberate incomplete-fee and variable-rate examples.

Northbridge A needs confirmation that its signing fee is paid separately from
the loan. Kestrel C also needs clarification of all additional or conditional
costs. The interface presents these unknown conditions as choices; it does not
supply the answers. Confirm only what is established by the document or a real
clarification.

AlderVale B has an unmanaged valuation fee and indicative conditions.
Harbourline D specifies variable interest and recurring insurance. Both remain
unavailable for comparison. Unsupported offers are greyed out and automatically
left out; removing one affects only the current workspace.

These supplied PDFs use EUR. Other supported offers may use USD or GBP;
comparisons require matching currency, principal and duration. Selecting a
currency does not convert the source amounts.

Expected support decisions describe extraction before human review. Passing
these known tests does not establish accuracy on real lender contracts. The PDF
examples are not classifier-training data.
