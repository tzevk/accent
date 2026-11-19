# Peer systems: L&T-related companies, TechnipFMC, Technip Energies and TCS

**Research note, not a decision.** Evidence read on **2026-11-17**. No vendor was
contacted and no system was tested. Everything below is what a first-party
document (or, where marked, trade press) actually says, plus explicitly labelled
inference. Absence of a statement is recorded as unknown, not as a negative fact.

The question: what do large manhour-selling peers (L&T, Technip, TCS) run for
HR, payroll and project time, and does any of it show project hours determining
salary? Short answer: **peer evidence shows separate layers — HCM suite, payroll
engine, project cost/time capture — and none of the sources reviewed state a
salary formula.** Accent's `gross = monthly CTC × logged project hours / basis
hours` stays an Accent policy choice, not an industry norm borrowed from peers.

## Read the layers separately

| Layer | Owns | Does not own |
| --- | --- | --- |
| HR master-data module | Employee master data, org, talent, learning, self-service | Payroll calculations unless a payroll module is also included |
| Payroll engine | Gross-to-net, statutory deductions, payslips, filings | Whether hours are billable |
| Project time & cost | Approved time against WBS/activity/order, cost posting, utilisation, billing inputs | Take-home pay arithmetic |

A vendor page proving layer 1 or 3 says nothing about layer 2's formula. Nothing
found here shows a peer paying base salary as a function of *billed* hours.
Billing and pay can share one approved time ledger while applying different rules.

## Evidence by entity

Entity identity matters: "L&T" is also Lassila & Tikanoja (Finland), and
TechnipFMC and Technip Energies have been separate listed companies since the
2021 spin-off. Rows below are pinned to legal entities and document dates.

| Entity (document date) | Verified system statement | Layer | Proves hours → salary? |
| --- | --- | --- | --- |
| **Larsen & Toubro Ltd** — Indian parent, FY2025-26 Integrated Annual Report | `SuccessFactors LMS` named as one content source inside ATL Varsity, the group learning platform, alongside Coursera, Skillsoft, Harvard ManageMentor. "HR Digitalisation Initiatives" describes role-based structuring and "digital system enablement" but names **no HRIS and no payroll engine**. | Learning content only | No |
| **L&T Technology Services Ltd** — listed subsidiary, FY2025-26 Annual Report | `SuccessFactorsLMS (iLearn)` named in the digital-learning / capability section. No payroll or time-capture system named. | Learning content only | No |
| **LTI (Larsen & Toubro Infotech Ltd)** — pre-merger entity, SAP case study dated 2020 | Ran **SAP S/4HANA on AWS** for financial and procurement functions; results cite integrating contract and project structures, resource allocation and invoice processing, plus "integration with SAP SuccessFactors and SAP Concur solutions as well as third-party and custom systems". 26,000 employees at the time. No payroll engine or salary rule stated. | ERP / finance + HR integration | No |
| **LTIMindtree Ltd** — separate listed company (LTI + Mindtree merged 2022), FY2024-25 Integrated Report | `Compass 2.0` project management platform migrated to a unified **ServiceNow SPM/GRC** solution, with "Detailed Task Planning for all Managed projects integrating with **timesheet system** (covering 1,350 projects & 31K associates)". Timesheets are a distinct system the PM platform integrates with. No HRIS or payroll engine named. | Project management + time capture | No |
| **TechnipFMC plc** — pre-spin entity, Oracle customer story published **2020-05-22** | Standardised talent/HR processes on **Oracle Cloud HCM**, replacing "several legacy, incompatible HR systems, including an on-premise SAP system"; ~37,000 employees, 48 countries; live in six months. Describes self-service, job codes, goals, manager analytics. **No payroll engine and no timesheets mentioned.** | HCM only | No |
| **TechnipFMC plc** — implementation-partner case published/modified **2026-11-10** | Epicenter (named Oracle partner) documents Oracle Cloud HCM as the global **HR system of record**, with FIT4Cloud-managed integrations to **separate payroll, ERP and identity systems worldwide — 25 interfaces**. Quote from Gilvan Lima, Senior Enterprise Application Manager, TechnipFMC. **Payroll vendors not named**; the case explicitly treats HR and payroll as distinct systems. | HCM + integration to payroll (payroll external) | No |
| **Technip Energies N.V.** — post-spin listed entity | Trade press (ERP Today, Issue 12, Sept 2022) reports a single global **Oracle Cloud HCM** go-live in **February 2022** with Inoapps, migrating **19,000+ users** from local/legacy HR systems across **30+ countries**. The company's own 2025 Annual Report names no HR or payroll platform. | HCM (secondary source) | No |
| **Tata Consultancy Services** — SAP announcement, **2026-05-18** | Modernised global payroll onto **SAP Cloud ERP Private** (S/4HANA Cloud on AWS per the release body), with **20+ interfaces** across HR, finance and third parties, and mock cycles plus parallel payroll during migration. | Payroll / ERP platform | No — platform only |

Sources and exact provenance are listed under [Sources](#sources).

### What the L&T rows do and do not mean

- The parent's own integrated report cites SuccessFactors **only as an LMS
  content ecosystem**, not as the employee master or payroll system. Reading that
  as "L&T runs SAP HCM for payroll" would be an unsupported leap.
- LTTS repeats the same pattern independently (`iLearn`), which is consistent
  with shared group learning tooling and says nothing about pay.
- LTI's 2020 SAP case is the closest thing to a named stack inside the group:
  S/4HANA on AWS for finance/procurement, integrated with SuccessFactors and
  Concur. It is **LTI in 2020**, not L&T the parent today, and the SuccessFactors
  reference is an integration point — the document does not say SuccessFactors
  Core HR or payroll was live there.
- LTIMindtree's FY25 report is useful for a different reason: the project
  management platform integrates with a **separate timesheet system** across
  1,350 projects and 31,000 associates. At a direct peer, time capture is its own
  layer feeding project management, not arithmetic inside payroll.
- Finnish "L&T" (Lassila & Tikanoja) pollutes searches; none of the evidence
  above comes from it. The L&T documents used carry the Indian CIN and Ballard
  Estate address.

### What the Technip rows do and do not mean

- The strongest single piece of peer evidence is the 2026 Epicenter case:
  TechnipFMC runs Oracle Cloud HCM as its **HR system of record** and integrates
  it through 25 interfaces to **separate payroll, ERP and identity systems**. That
  is a named implementation partner describing, at a direct EPC peer, exactly the
  split this note recommends — and it still does not disclose a salary formula.
- Oracle's 2020 story is about **talent management and HR self-service**, not
  payroll, and predates the 2021 spin-off — it describes the combined
  TechnipFMC. Attributing it to Technip Energies today is an entity error.
- The Technip Energies Oracle Cloud HCM go-live is documented by **trade press
  only**; the company's 2025 Annual Report names no HCM, payroll or time system.
  Treat the February 2022 go-live as credible but secondary, and the **payroll
  engine as unknown**.
- Neither Technip source connects timesheets to pay. Both are silent on the
  salary formula.

### TCS

The SAP release proves TCS runs its **payroll on SAP Cloud ERP Private** with a
deliberate parallel-run migration. (Provenance: read in full by the coordinating
agent and relayed here; the findings above are limited to what the release body
states.) It does not describe the salary formula, and it does not say
project/billable hours feed pay. TCS's own employee-facing
timesheet tool (Ultimatix) is referenced in a designer's personal portfolio
write-up about month-end hour capture for pay — **weak, non-company-confirmed
evidence**; it is not used here to assert any calculation rule.

## The architecture pattern (first-party, not peer-specific)

SAP's own learning material for S/4HANA project financials describes **CATS**
(Cross-Application Time Sheet) as the place where actual time is recorded,
released/approved, and then transferred to HR, project and cost applications;
time is assigned to WBS elements/activities/orders and activity confirmations
post costs, work, dates and project status.

This supports a recommendation for Accent: **one approved time ledger, with
payroll and project costing consuming it under separate rules.** It is not
evidence that L&T, Technip or TCS use CATS, nor that Accent currently has this
approval boundary. It does not establish anyone's salary formula.

## Limits of this note

- No public source located states how any of these employers converts project
  hours into gross salary. **No evidence was found that any named company uses
  Accent's `CTC × project hours ÷ basis hours` formula**, and claims that peers
  "pay per billed hour" are unsupported by the evidence reviewed.
- L&T and Technip Energies payroll vendors remain **unverified**; TCS's payroll
  platform is verified but its pay rules are not public. TechnipFMC's partner
  case confirms payroll is external to Oracle HCM but **does not name the
  payroll vendors**.
- Absence of a platform name in an annual report is weak negative evidence: such
  reports routinely omit back-office vendors.
- Two first-party PDFs were unreachable from this environment (HTTP 403:
  `investors.larsentoubro.com`, `investors.technipenergies.com`); equivalent
  copies were read from NSE and `ten.com` respectively. The Oracle TechnipFMC
  page now returns 404; an archived capture (2023-03-06) of the 2020-05-22 story
  was read instead.

## Sources

| # | Source | Type | Date / access |
| --- | --- | --- | --- |
| 1 | [L&T Integrated Annual Report 2025-26](https://nsearchives.nseindia.com/corporate/PAM_14052026185748_LTIntegratedReportFY26.pdf) — SuccessFactors LMS in ATL Varsity (p. 262); HR Digitalisation Initiatives (p. 163) | First-party, filed with NSE | FY2025-26; read 2026-11-17 |
| 2 | [LTTS Integrated Annual Report 2025-26](https://www.ltts.com/system/files/2026-05/LTTS-AR-2025-26.pdf) — `SuccessFactorsLMS (iLearn)` | First-party | FY2025-26; read 2026-11-17 |
| 3 | [Oracle customer story: TechnipFMC](https://web.archive.org/web/20230306105115/https://www.oracle.com/customers/technipfmc/) (live URL now 404) | First-party vendor, archived | Published 2020-05-22; capture 2023-03-06 |
| 4 | [ERP Today, Issue 12](https://erp.today/wp-content/uploads/2022/09/ERP-Today-Issue_12X.pdf) — Technip Energies / Inoapps / Oracle Cloud HCM, 19,000+ users, go-live Feb 2022 | Trade press (secondary) | Sep 2022; read 2026-11-17 |
| 5 | [Technip Energies 2025 Annual Report](https://www.ten.com/sites/energies/files/2026-03/ten_2025-annual-report.pdf) — no HR/payroll platform named | First-party | FY2025; read 2026-11-17 |
| 6 | [SAP: TCS large-scale payroll transformation](https://news.sap.com/india/2026/05/sap-powers-tcss-large-scale-payroll-transformation-supporting-its-cloud-first-strategy/) — SAP Cloud ERP Private, 20+ interfaces, parallel payroll | First-party vendor | 2026-05-18 |
| 7 | [SAP Learning: executing projects using activity confirmation and CATS](https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/executing-projects-using-activity-confirmation-and-the-cross-application-time-sheet-cats) | First-party vendor training | undated course page; read 2026-11-17 |
| 8 | [SAP case study: LTI, "Fostering Innovation and Agility with SAP S/4HANA"](https://cdn.featuredcustomers.com/CustomerCaseStudy.document/sap-successfactors_lti5_739475.pdf) — S/4HANA on AWS; SuccessFactors/Concur integration (Studio SAP 71834enUS) | SAP-authored PDF, mirrored host | © 2020 (20/11); read 2026-11-17 |
| 9 | [LTIMindtree Integrated Annual Report FY2024-25](https://www.ltm.com/content/dam/ltimcorporatewebsite/uploads/2026/01/Integrated-Annual-Report-FY25.pdf) — ServiceNow SPM/GRC, timesheet-system integration, 1,350 projects / 31K associates | First-party | FY2024-25; read 2026-11-17 |
| 10 | [Epicenter: TechnipFMC success story](https://epicenter.io/insights/success-stories/technipfmc/) — Oracle Cloud HCM as HR system of record; FIT4Cloud integrations to separate payroll/ERP/identity; 25 interfaces | Named Oracle implementation partner; verified in full by coordinating agent | Page modified 2026-11-10 |

## Consequences for Accent (brief)

1. **Keep the layers separate.** Project hours may feed cost, utilisation,
   billing and gross pay, but these need distinct rules. Accent's
   [ADR-0010](../../adr/0010-hours-logged-pay-basis.md) defines its pay rule.
   The recommendation is to separate approved time capture, pay-rule execution,
   project costing and customer billing. The sources do not establish Accent's
   current approval workflow.
2. **Keep three rates, not one.** An employee pay rate (what the person earns),
   a loaded internal costing rate (pay plus employer on-costs, used for project
   cost and utilisation) and a client billing rate (contractual) are different
   numbers. Collapsing them into one hourly rate is how timesheet debates turn
   into salary disputes. **[INFERENCE]** this is the enterprise pattern the
   sources imply; none of them states a rate-building formula.
3. **Do not cite peers as justification** for the hours-based gross. The peer
   evidence proves platforms, not formulas.
4. **If Accent ever adopts an HCM/payroll suite**, expect the integration seam to
   be the approved time ledger plus employee master — the same seam the sources
   above describe — and decide explicitly whether payroll or Accent owns gross.
