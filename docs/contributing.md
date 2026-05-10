# Contributing

## Branching

- `main` is always shippable
- Feature branches: `feature/<short-name>`
- Fix branches: `fix/<short-name>`
- Refactor branches: `refactor/<short-name>`
- Avoid long-running branches; rebase onto `main` regularly

## Commit messages

- Imperative mood: "Add", "Fix", "Refactor" — not "Added", "Fixes"
- One logical change per commit
- Subject line under 70 characters
- Body wraps at 72 characters
- Do not add co-author trailers
- Do not add non-standard comments

## Pull requests

1. Open the PR against `main`
2. Title summarises the change in one line
3. Body includes: what changed, why, how to test
4. Required reviewer: the owner of any component touched
5. Cross-component PRs need every affected owner

## Code style

Per-stack conventions:

- **Python**: PEP 8, formatted with `ruff`. Type hints on public APIs.
- **TypeScript / React Native**: ESLint + project config. Strict TS where possible.
- **Next.js**: App Router conventions, TypeScript, Tailwind classes only — no inline styles.

Component folders are autonomous; they may pin their own dependency versions in their own `package.json` / `pyproject.toml`.

## API contracts

If your change adds, modifies, or removes a REST endpoint or shared schema, you must update the corresponding `contracts/<component>.openapi.yaml` in the same PR.

## Secrets

Never commit secrets. Use `.env.local` files (gitignored) and document required environment variables in the component's README.

## Issue tracking

Use GitHub Issues. Label by component (`component:dispatch`, `component:geo-intelligence`, etc.) and by type (`type:bug`, `type:feature`, `type:research`). Assign to the component owner.
