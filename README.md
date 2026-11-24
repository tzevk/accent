# Accent CRM

Accent CRM connects sales, project delivery, and back-office work for an engineering services team. It tracks a client enquiry from Lead to Proposal and Project, then brings project work, billing, and staff costs into the same system.

| Area                | What you can do                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sales               | Assign Lead owners, record follow-ups, convert qualified Leads to Proposals, and open Projects from Proposals.      |
| Project delivery    | Assign team members, track activities and work logs, and review budgets and hours.                                  |
| Finance             | Create quotations, invoices, and cash vouchers. Record payments and review client balances and monthly expenditure. |
| Employee operations | Manage attendance, leave, Salary Profiles, and payroll. Employees can view their own Timesheets and Payslips.       |

## Run locally

Use Node.js 24 and MariaDB 10.11. Create a local development database and give your local database user access to it. Copy [`.env.example`](.env.example) to `.env` and set `DB_HOST`, `DB_PORT`, and `DEV_DB_*` for that database. Never point local commands at staging or production.

```sh
npm ci
npm run migrate
npm run dev
```

Open <http://localhost:3000>. For a fresh database, [create a local sign-in account](docs/explanations/SUPER_ADMIN_SETUP.md#method-2-create-new-super-admin-user-via-database). See [local database operations](docs/agents/local-database.md) for the Windows MariaDB helper and disposable test databases.

## Database changes

New application queries use Drizzle over the shared `mysql2` connection; existing queries are not rewritten. All 68 historical Knex migrations now run as Drizzle callbacks from `drizzle/history/`, ordered by a manifest that keeps their original filenames as stable IDs. The runner adopts an exact existing Knex-ledger prefix without replay; a fresh database runs the full translated history. New native migrations use Drizzle v1 Kit v3 folders in `drizzle/<YYYYMMDDHHMMSS>_<name>/`, with `migration.sql` and the generated `snapshot.json`. The partial Drizzle schema is not a schema-generation source.

```sh
npm run migrate:make -- --name descriptive_name
npm run migrate
npm run migrate:status
```

The generator creates a migration folder with an empty SQL file and a snapshot. Write and review the forward MariaDB SQL, then commit the whole folder. The runner validates v3 folder metadata and rejects a missing `migration.sql`. Use no schema push or batch down; correct errors with a forward migration and recover from verified MariaDB backups.

`npm run migrate` is the only apply route. Do not use `drizzle-kit migrate` or the ORM migrator: Drizzle v1 tries to add `name` and `applied_at` to Accent's unchanged ledger and cannot match the synthetic historical IDs. Native ledger hashes combine the full folder name with the SQL SHA-256, so same-second folders stay ordered but an applied folder cannot be renamed. Only explicitly approved production work may use the configured `npm run migrate:prod` and `npm run migrate:prod:status` commands.

## Verify changes

| Check                                                     | Command or guide                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Lint, unit tests, and production build                    | `npm run verify`                                                  |
| Authenticated HTTP integration against disposable MariaDB | [`npm run test:integration` setup](docs/app/leads/integration.md) |
| Browser journeys against disposable MariaDB               | [Playwright suite and CI workflow](e2e/README.md)                 |

GitHub Actions runs the full browser suite. Each test group creates, migrates, seeds, and drops its own database. The suite does not use operational data.

## Find the right guide

- **Operate Accent:** [Leads](docs/app/leads/operator-guide.md), [Payroll](docs/app/payroll/operator-guide.md), or the [full documentation index](docs/README.md).
- **Change Accent:** [Coding standards](CODING_STANDARDS.md), [agent guide](AGENTS.md), and [domain glossary](GLOSSARY.md).
