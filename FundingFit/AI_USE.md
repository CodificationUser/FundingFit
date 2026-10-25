# AI use, method and sources

## Development assistance

FundingFit was developed through AI-assisted coding, often called vibe coding.
OpenAI Codex generated application code, fictional examples, labelled clauses,
tests and documentation from natural-language instructions. It also assisted
with model preparation, source research and checking the implementation.

The development assistant is separate from the AI inside the application.
Opening FundingFit does not call Codex or a generative AI API. The application
runs a saved supervised text classifier locally, followed by explicit value
parsers and financial formulas.

## Selected prompts used

The following are relevant excerpts of actual development instructions. French
instructions are translated into English and labelled below. They are excerpts,
not a reconstructed single prompt.

**Project and course materials — translated from French**

> “Go ahead and build this. Follow the assignment instructions, and remember the
> attached course documents if they are useful for the assignment.”

This guided the application, examples, user guide and connection to the supplied
course notebook.

**Classifier — English excerpts from the development prompt record**

> “Use scikit-learn 1.7.2 with character TF-IDF features, n-grams 3 to 5 and about
> 5000 features, followed by multiclass logistic regression.”
>
> “Use varied fictional clauses and genuinely separate wording families for the
> held-out set; do not randomly split numeric variations of the same template.”

These instructions were used for the labelled corpus, classifier and exported
parameters.

**Value extraction — English excerpt from the development prompt record**

> “Parse typed numbers with explicit rules after the AI assigns a field label.
> Do not guess a missing fee. Variable rates are unsupported.”

This separates learned clause classification from literal value parsing and
supported-product validation.

**Reproducibility and verification — translated from French**

> “The application must remain easy to rerun (no API key, no paid account),
> reproducible, and the AI must always propose values that the user checks
> before calculation. An offer with a variable rate or unsupported fees must
> still be blocked.”

These requirements guided local processing, source evidence, human confirmation
and the product boundaries.

**Currency handling — English development instruction**

> “Support EUR, USD and GBP, format amounts in the selected currency, and never rank offers across currencies without conversion.”

This guided currency selection, amount and cash-limit formatting, and the rule
that a comparison uses one currency. The application performs no conversion.

## Runtime AI and course connection

The classifier uses character TF-IDF features of length three to five and
multinomial logistic regression across eight clause categories: amount, annual
rate, term, upfront fee, rate type, currency, other costs and other text. The
saved vocabulary, IDF values, coefficients, intercepts and thresholds are in
`dist/assets/clause_model.json`. JavaScript reproduces inference from these
parameters. Rules read explicit values after classification and retain source
text and page evidence. Manual entries are identified separately; they do not
retrain the classifier.

The model was fitted offline with scikit-learn 1.7.2: C=10, L-BFGS, at most
1,200 iterations and seed 24025. The labelled corpus is supplied in
`data/training/`. Normal use and application rebuilding use the saved model,
without Python or retraining.

The supplied ESG notebook covered text cleaning, dictionary matching, document
frequencies and weighting. FundingFit extends those ideas with supervised clause
classification, positioned PDF extraction, source verification and an interactive
financing decision. The ESG reports and dictionary are not used as loan data.

Financial calculations use the nominal annual rate divided by twelve, monthly
amortisation, cent rounding and a final-payment adjustment. Borrowing cost is
interest plus separately paid upfront fees. The displayed effective annual cost
is a modelled cash-flow yield under those assumptions, not a statutory APR quote.
Amounts and cash limits remain in EUR, USD or GBP as selected. Changing a
currency does not convert amounts, and mixed-currency offers are not ranked.

## Data and evaluation

All loan examples and lenders are fictional. The four supplied original PDFs
are retained unchanged. Generated demonstration and layout fixtures are clearly
separate; complete supplied PDF clauses were not copied into classifier training.

Training contains 1,032 clauses from 311 wording families. The retained evaluation
set has 78 clauses from 40 separate families. Accuracy is 91.03%, macro F1 is
0.894 and threshold coverage is 87.18%; the keyword baseline has 65.38% accuracy.
This small set was already inspected during development and is not a fresh blind
evaluation or a measure of reliability on real bank contracts. Model scores are
not calibrated probabilities. Detailed results are in `models/evaluation.json`.
Automated tests cover known extraction, PDF, review and financial cases; these
checks are not independent real-world observations.

## Sources

- **Supplied assignment:** *Group Assignment: Advanced AI Algorithms*, pages 1–3.
- **Supplied course notebook:** *Rombouts_Finance_ESG.ipynb*, zero-based cells
  6, 14–21 and 40–41, for the text-processing connection.
- **Business context:** [Bpifrance Création — using a bank loan to finance a
  business project](https://bpifrance-creation.fr/encyclopedie/financements/lemprunt/recourir-a-pret-bancaire-financer-son-projet-creation)
  (source title translated from French), for interest and fee considerations.
- **AI method:** scikit-learn documentation for
  [TF-IDF](https://scikit-learn.org/1.7/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html),
  [logistic regression](https://scikit-learn.org/1.7/modules/generated/sklearn.linear_model.LogisticRegression.html)
  and [classification metrics](https://scikit-learn.org/1.7/modules/generated/sklearn.metrics.classification_report.html).
- **PDF reader:** [Mozilla PDF.js 5.6.205](https://github.com/mozilla/pdf.js/releases/tag/v5.6.205).
  Its bundled license is retained in `dist/vendor/PDFJS-LICENSE`.
