# Open-source payroll options: Frappe HR, Horilla, Odoo

**Research note, not a decision.** Evidence read on **2026-11-17**. No candidate was
installed, run, migrated to, or benchmarked; feature statements below come from
first-party documentation and source code, and applicability to Accent is untested.

The question: can an existing open-source payroll implementation replace Accent's
payroll, or be reused as a React/TypeScript library inside
`src/app/admin/payroll/`? The short answer is **no drop-in library exists in the
options reviewed**. Among those reviewed, **Frappe HR + India Payroll** is the
strongest candidate for evaluation as a separate service. It is not a component;
exact compatibility with Accent's
[ADR-0010](../../adr/0010-hours-logged-pay-basis.md) rule remains unverified.

## What Accent needs (the comparison baseline)

Accent pays `Gross = hourly rate × logged project hours`, where
`hourly rate = monthly CTC ÷ (month working days × std_hours_per_day)`. Attendance
does not add an overtime premium or subtract absence pro rata; a month with no
logged hours pays no hours-based pay. Slips store the four inputs so later changes
cannot re-price history ([ADR-0010](../../adr/0010-hours-logged-pay-basis.md),
[operator guide](operator-guide.md)). Payroll also has effective-dated salary
profiles, draft/finalize/paid/reopen month states, immutable slip snapshots, and
figures consumed by project cost and utilization reports.

An alternative must therefore own the whole monthly cycle, not only a tax
calculator. After cutover it must be the single writer of payroll: no dual-write
with Accent calculators, no second source of gross.

## Summary

| Candidate | License (actual license file) | Stack / runtime | Maintenance observed | India statutory support | Drop-in React/TS? | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| [Frappe HR](https://github.com/frappe/hrms) + [India Payroll](https://github.com/frappe/india-payroll) | GPL-3.0 ([HRMS license.txt](https://github.com/frappe/hrms/blob/develop/license.txt), [India license.txt](https://github.com/frappe/india-payroll/blob/develop/license.txt)) | Python/Frappe, Vue UI, MariaDB, Redis, Node, Chromium PDFs | HRMS ~9.1k stars, 11,539 commits, release v16.53.2 on 2026-11-11; India app 29 stars, 256 commits, v16.1.0 on 2026-10-07 | Strongest: EPF/EPS/EDLI + ECR, ESI, PT, LWF, TDS/24Q, Form 16 (vendor claims) | No | **Conditional shortlist** — separately hosted, API integration, licence review |
| [Horilla](https://github.com/horilla/horilla-hr) | LGPL-2.1 ([LICENSE](https://github.com/horilla/horilla-hr/blob/2.0/LICENSE)) | Python/Django, PostgreSQL or SQLite, Docker | ~1.5k stars, 6,847 commits, v2.4.0 on 2026-11-10; payroll engine rebuilt in v2.2.0 on 2026-10-21 | Templates and FY 2025-26 income-tax packs, but no statutory filing outputs found; PT is a flat amount by default | No | **Not a replacement** — too little India statutory depth; no MariaDB driver declared |
| [Odoo Community](https://github.com/odoo/odoo) + [OCA payroll](https://github.com/OCA/payroll) | Community LGPL-3.0 ([LICENSE](https://github.com/odoo/odoo/blob/20.0/LICENSE)); OCA repo AGPL-3.0, `payroll` module LGPL-3 ([manifest](https://github.com/OCA/payroll/blob/18.0/payroll/__manifest__.py)) | Python/Odoo, PostgreSQL | Odoo ~55.9k stars, branch 20.0; OCA payroll 125 stars, 208 forks, 19.0 branch | Community has no payroll app; documented India localization is not in the community repo | No | **Rejected as an open-source India option** |

GitHub star/fork counts are snapshots from the project pages on the evidence date
and change continuously. The GitHub API was rate-limited from this environment, so
counts were read from the rendered repository pages, not from `/repos` metadata.

Within this scope, no better-maintained India-capable open-source *package* surfaced.
The best-maintained code is the Frappe HRMS core, but its India extension is the
youngest component in the comparison; the stack-native alternatives (JantaHR,
payroll-js) are pre-traction. That is why the shortlist is a separately hosted
platform rather than a library.

## 1. Frappe HR + India Payroll

### Licence and maintenance

- HRMS is **GPL-3.0**, read from the repository's `license.txt`, not from the
  sidebar badge. The India Payroll app is separately **GPL-3.0**.
- HRMS is active: `develop` had 11,539 commits and the newest release was
  **v16.53.2 on 2026-11-11** ([releases](https://github.com/frappe/hrms/releases)).
  It is an actively maintained platform.
- India Payroll is much younger: **256 commits, 29 stars**, first release
  **v16.0.0 on 2026-07-03**, latest **v16.1.0 on 2026-10-07**
  ([releases](https://github.com/frappe/india-payroll/releases)). The
  `version-16` branch targets `frappe`, `erpnext`, and `hrms` `>=16.0.0,<17.0.0`
  ([pyproject](https://github.com/frappe/india-payroll/blob/version-16/pyproject.toml));
  `develop` targets the next major. A mature HRMS core does **not** imply an
  equally mature India extension.

### Features relevant to Accent

Frappe HR provides salary structures, payroll entries that bulk-create salary
slips, attendance/timesheet-based slip options, payroll accrual and bank journal
entries ([payroll entry docs](https://docs.frappe.io/hr/payroll-entry)). Salary
structures support **Salary Slip Based on Timesheet** with an hourly rate
([salary structure docs](https://docs.frappe.io/hr/salary-structure)), but the docs
do not establish automatic monthly `CTC ÷ (working days × std hours)` recomputation.
That is an Accent policy, not a standard Frappe rule; reproducing it needs a custom
salary structure/formula or an explicit policy change.

India Payroll's README advertises EPF (employee/employer split, EPS/EDLI, ECR
export), ESI, state-wise professional tax, LWF, old/new income-tax regimes,
surcharge and marginal relief, quarterly Form 24Q through the Sandbox API, and
Form 16 ([README](https://github.com/frappe/india-payroll)). Those are vendor
claims; this research did not validate calculations or filings. The PF
documentation also encodes assumptions (for example around post-1 September 2014
entrants) that must be checked against Accent's actual employee population
([EPF docs](https://docs.frappe.io/hr/india-payroll/employee-provident-fund)).
**Automation of PF/ESI/TDS is not proof of a correct or accepted filing.**

### Integration and hosting

- Frappe exposes a DocType REST API with token API keys/secrets; the service
  user's roles apply ([REST docs](https://docs.frappe.io/framework/user/en/api/rest)).
- Hosting is a full Frappe bench: Linux/macOS, MariaDB 11.8, Python 3.14, Node 24,
  Redis/Valkey, and Chromium for PDFs on current Frappe ([installation docs](https://docs.frappe.io/framework/user/en/installation)),
  or Frappe Cloud. This is a second production system with its own database,
  upgrades, backups, and payroll PII.
- There is no React/TypeScript payroll package. The UI is Frappe UI/Vue; Accent
  would call the REST API or render Frappe's own screens, not import components.

**Fit:** the strongest functional match for Indian statutory payroll and the only
candidate with credible ECR/24Q/Form 16 surface. **Not a drop-in:** schema, payroll
model, UI, and workflow are Frappe's. Accent would have to decide whether the
platform's gross/CTC model replaces ADR-0010 or is customized to reproduce it.

## 2. Horilla

### Licence and maintenance

Horilla HR is **LGPL-2.1**, verified from the repository `LICENSE`. The project is
active: 6,847 commits and **v2.4.0 released 2026-11-10**
([releases](https://github.com/horilla/horilla-hr/releases)). Its payroll engine is
new, however: v2.2.0 on **2026-10-21** introduced "a new engine (configurable
components, batch runs, tax packs)" and rebuilt the batch page. A payroll engine
weeks old is not comparable in maturity to the HR modules around it.

### India payroll depth

Horilla has India-labelled salary components and FY 2025-26 income-tax packs:

- PF defaults to 12% of basic, but the component's own note says the statutory
  ceiling must be configured manually ("set a maximum on the component if that
  applies to you") ([component library](https://github.com/horilla/horilla-hr/blob/2.0/payroll/component_library.py)).
- ESI is a 0.75% employee / 3.25% employer rule gated at gross ≤ ₹21,000.
- Professional tax defaults to a **flat ₹200**, with a note that state slabs vary;
  no state-wise PT slab engine was found.
- Tax packs cover India new/old regime FY 2025-26 with slabs, standard deduction,
  rebate, and cess; they explicitly say "verify against the current finance act"
  and do not model 80C/80D ([tax packs](https://github.com/horilla/horilla-hr/blob/2.0/payroll/tax_packs.py)).

A source search of [`payroll/`](https://github.com/horilla/horilla-hr/tree/2.0/payroll) found **no ECR, challan, Form 24Q, Form 16, or
statutory-return generation**. The India pieces are configurable templates, not a
statutory compliance product.

### Integration and hosting

Horilla is Django 5.2/Python 3.12+ with PostgreSQL (SQLite for development), Redis,
and Docker images; its requirements use `psycopg2`, not a MariaDB driver
([requirements](https://github.com/horilla/horilla-hr/blob/2.0/requirements.txt),
[environment template](https://github.com/horilla/horilla-hr/blob/2.0/.env.dist)).
It exposes a token-based REST API used by its mobile app (README). Running it means
a second PostgreSQL-backed service. It has no React component package; its UI is
Django templates/HTMX.

**Fit:** a credible HR suite with an LGPL licence, but the India payroll layer is
thinner than Frappe's and the engine is new. It is not a replacement for Accent's
statutory or hours-based payroll without building the missing rules.

## 3. Odoo Community + OCA payroll

- **Odoo Community is LGPL-3.0** ([LICENSE](https://github.com/odoo/odoo/blob/20.0/LICENSE)); OCA's payroll repository is **AGPL-3.0**, while the `payroll` module manifest declares **LGPL-3**. Check the manifest of any module actually used.
- **Odoo Community 20.0 does not contain `addons/hr_payroll`** — the path returns
  404 in the [public addons tree](https://github.com/odoo/odoo/tree/20.0/addons). OCA supplies community payroll modules
  (`payroll`, `payroll_account`, and related addons) under the 18.0/19.0 branches
  ([OCA README](https://github.com/OCA/payroll/blob/18.0/README.md)), but the OCA
  addon list contains **no India localization**.
- Odoo documents an Indian payroll localization (`l10n_in_hr_payroll`) with PF
  ceiling choice, PT slabs, ESIC, LWF, gratuity, and Indian salary structures
  ([India docs](https://www.odoo.com/documentation/20.0/applications/hr/payroll/payroll_localizations/india.html)).
  That module is **not in the LGPL community repository**; it belongs to the
  commercial Odoo Enterprise addons. So "Odoo Community + OCA" is not an
  open-source India-statutory option, and "Odoo with India payroll" is an Odoo
  Enterprise purchase.
- Odoo's current external API is JSON-2 (`/json/2`), new in 19.0; the docs state
  that API access is only on **Custom** Odoo pricing plans for the SaaS offering —
  not One App Free or Standard
  ([external API docs](https://www.odoo.com/documentation/20.0/developer/reference/external_api.html)).
  Odoo runs on Python/PostgreSQL and is a separate ERP, not a React library.

**Fit:** rejected for this scope. It is a large ERP with a commercial India
payroll layer, and the community edition lacks both the payroll app and the India
localization.

## Footnotes: stack-native but not established

- **[JantaHR](https://github.com/devag7/jantahr)** — Next.js/NestJS/TypeScript,
  AGPL-3.0, Indian PF/ESI/PT/LWF/TDS claims, PostgreSQL/Supabase. The repository
  page observed **1 star and 90 commits**. It is a full application, not a
  library, and is far too young to treat as an established replacement. Worth
  watching, not shortlisting.
- **[payroll-js](https://github.com/CrmLeaf/payroll-js)** — MIT-licensed
  TypeScript/JavaScript Indian calculators (PF, ESI, PT, TDS, gratuity, CTC,
  payslip) with a useful `Result` shape and integer-paise arithmetic. Its README
  says **"Not on npm yet"** and that installing straight from git "will not work".
  The repository page observed **0 stars and 1 commit**. It is a calculator
  toolkit, not a payroll system, and is not an established dependency today. This
  is not a claim that no JavaScript payroll libraries exist.

## No drop-in React/TypeScript option

None of the reviewed projects ships a React component library or an npm payroll
engine that Accent could import into `src/app/admin/payroll/`:

- Frappe and Odoo are server-rendered/full-stack platforms with their own UI
  frameworks (Vue/Frappe UI; OWL/QWeb), APIs, databases, and deployment models.
- Horilla is a Django application with server-rendered templates.
- JantaHR is the closest stack match (Next.js/NestJS/TypeScript), but it is an
  entire AGPL application with minimal adoption, not a package.
- payroll-js is the closest library shape, but it is a set of calculators, not a
  payroll workflow, and it is not published/established.

Integration would mean running a second payroll system and calling its API, or
copying/porting source. The latter raises licence and maintenance questions that a
research note cannot settle.

## Integration and cutover cautions

1. **Licence review before copying or porting.** Accent's repository root has no
   `LICENSE`/`COPYING` file, so do not assume a permissive outbound licence or
   copyleft compatibility. GPL-3.0 (Frappe/India Payroll) and AGPL-3.0 (OCA
   repository; JantaHR) are copyleft. Separately hosting the service and
   integrating over an API is materially different from copying code into the
   Next.js app; obtain a legal review before either. This note does not conclude
   that API use triggers any particular licence obligation.
2. **One payroll owner after cutover.** Do not dual-write slips or run Accent and
   the platform as competing calculators. Choose the system of record for the
   month, preserve Accent's historical slips read-only, and make the boundary
   explicit in the run/finalize workflow.
3. **Reconcile before the first new month.** Compare an anonymized representative
   month, including a joiner/leaver, zero logged hours, an effective-dated salary
   revision, Maharashtra PT's February rule, and PF/ESI boundary cases. Fixtures
   must cover employee master, CTC revisions, opening balances, loans/advances,
   and contractor treatment.
4. **Decide the CTC-as-gross policy explicitly.** Accent's ADR-0010 makes CTC the
   hours base. Gross pay means earnings before employee deductions; CTC also
   includes employer costs. These are different amounts. Reproducing Accent's
   rule may require customization; changing it requires an explicit policy
   decision. Do not promise parity by configuration.
5. **Snapshots and downstream reports.** If payroll moves out, Accent must store
   the returned slip identifiers/PDFs and the four ADR-0010 inputs (or their
   equivalent) so project cost and utilization reports do not re-price history.
6. **Compliance is not a feature flag.** Statutory rates, wage ceilings, state PT
   slabs, and filing schemas change. Treat vendor automation as calculation
   support, not as proof of filing; assign an owner for rate updates and filing
   reconciliation.
7. **Operational surface.** A separate Frappe bench or Odoo/Horilla deployment
   adds a database, runtime, upgrade cadence, backups, access control, and payroll
   PII exposure. Frappe fits MariaDB operationally, but it still duplicates the
   application runtime.

## Recommendation

**Do not adopt any of these as a drop-in React/TypeScript payroll library.** If
Accent wants an external payroll engine, evaluate **Frappe HR + India Payroll**
first as a separately hosted service with REST integration, a parallel run, and a
licence/policy review. Keep **Horilla** as a distant second: it is active and
LGPL, but its India statutory layer is templates plus income-tax packs, and its
payroll engine is new. Treat **Odoo Community + OCA** as rejected for India
payroll; Odoo's documented India localization is an Enterprise add-on. Keep
in-house payroll as the lower-risk option if the drop-in constraint is hard or
ADR-0010 must remain unchanged.

## Evidence limits

- GitHub's API was rate-limited from this environment; star/fork/commit counts come
  from rendered repository pages on 2026-11-17, not API metadata.
- `horilla.com/docs/payroll/` returned a bot-verification page, so Horilla payroll
  statements were checked against the repository source instead.
- Odoo Enterprise's source repository is not public. The India localization's
  edition location is supported by Odoo's documentation plus its absence from the
  LGPL community tree, not by installing or inspecting the Enterprise module.
- No candidate was installed, no payroll was run, and no filing or calculation was
  validated. Claims marked as vendor claims remain unverified.

## Sources

All URLs read on 2026-11-17 unless stated.

- Frappe HR repository, licence, releases: <https://github.com/frappe/hrms>, <https://github.com/frappe/hrms/blob/develop/license.txt>, <https://github.com/frappe/hrms/releases>
- Frappe HR payroll entry, salary structure, REST API, installation: <https://docs.frappe.io/hr/payroll-entry>, <https://docs.frappe.io/hr/salary-structure>, <https://docs.frappe.io/framework/user/en/api/rest>, <https://docs.frappe.io/framework/user/en/installation>
- Frappe India Payroll repository, README, releases, version-16 pyproject: <https://github.com/frappe/india-payroll>, <https://github.com/frappe/india-payroll/releases>, <https://github.com/frappe/india-payroll/blob/version-16/pyproject.toml>
- Frappe India Payroll EPF documentation: <https://docs.frappe.io/hr/india-payroll/employee-provident-fund>
- Horilla repository, licence, releases, component library, tax packs, requirements, environment template: <https://github.com/horilla/horilla-hr>, <https://github.com/horilla/horilla-hr/blob/2.0/LICENSE>, <https://github.com/horilla/horilla-hr/releases>, <https://github.com/horilla/horilla-hr/blob/2.0/payroll/component_library.py>, <https://github.com/horilla/horilla-hr/blob/2.0/payroll/tax_packs.py>, <https://github.com/horilla/horilla-hr/blob/2.0/requirements.txt>, <https://github.com/horilla/horilla-hr/blob/2.0/.env.dist>
- Odoo repository and licence, payroll docs, India localization docs, external API docs: <https://github.com/odoo/odoo>, <https://github.com/odoo/odoo/blob/20.0/LICENSE>, <https://www.odoo.com/documentation/20.0/applications/hr/payroll.html>, <https://www.odoo.com/documentation/20.0/applications/hr/payroll/payroll_localizations/india.html>, <https://www.odoo.com/documentation/20.0/developer/reference/external_api.html>
- OCA payroll repository, README, module manifest: <https://github.com/OCA/payroll>, <https://github.com/OCA/payroll/blob/18.0/README.md>, <https://github.com/OCA/payroll/blob/18.0/payroll/__manifest__.py>
- JantaHR: <https://github.com/devag7/jantahr>
- payroll-js: <https://github.com/CrmLeaf/payroll-js>, <https://github.com/CrmLeaf/payroll-js/blob/main/README.md>
- Accent baseline: [ADR-0010](../../adr/0010-hours-logged-pay-basis.md), [payroll operator guide](operator-guide.md)
