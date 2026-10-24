# Contributing

## Start from the latest main

Fetch the latest `main` and create a new branch before making changes:

```bash
git fetch origin main
git switch -c docs/update-contribution-guide origin/main
```

Use the appropriate branch type for your change. Complete the work on that branch, commit and push it, then open a pull request targeting `main`.

## Branch and commit names

Use conventional branch names in the form `<type>/<short-kebab-case-description>`, for example `feat/article-search`, `fix/upload-retry`, or `docs/update-contribution-guide`. Common types include `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `build`, and `chore`.

Write English commit messages using Conventional Commits:

```text
<type>[optional scope][!]: <description>
```

Examples: `docs: add contribution guidelines` and `fix(upload): handle interrupted requests`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer. If using a squash merge, give the resulting commit a Conventional Commit message as well.

## Repository protections and cleanup

Check the live [repository rules](https://github.com/RitelDevs/haravatat/rules) before operations involving protected refs; GitHub settings are authoritative. The current configuration is:

- `main` requires a pull request. Deletion and force pushes are blocked, with no bypass actors configured.
- The required GitHub Actions status check is `checks`. The branch must be up to date with the base branch, and review conversations must be resolved before merging. The configured minimum approval count is zero.
- Version tags matching `v*` are protected against updates and deletion, with no bypass actors configured. Treat published version tags as immutable; use a new version tag for a subsequent release.
- GitHub automatically deletes head branches after pull requests are merged. Start subsequent work on a fresh branch from the latest `origin/main`, and prune stale remote-tracking refs with `git fetch --prune`.

Preserve these protections and cleanup settings. Submit changes through the pull request workflow rather than weakening settings to complete a contribution.

## Documentation and validation

Whenever you change code, update the relevant files in `docs/` in the same commit. Describe the resulting behavior, configuration, or development workflow so documentation stays aligned with the implementation. See [docs/development.md](docs/development.md) for development context and `package.json` for available scripts.

Run validation appropriate to the change and include the results in the pull request. For documentation changes, check formatting. For code changes, run the relevant build and tests, including browser tests when user-facing behavior changes. Consult [.github/workflows/ci.yml](.github/workflows/ci.yml) for the CI sequence.

CI installs Chromium and its system dependencies before browser tests. Installation can take ten to fifteen minutes, which is normal. Contributors and AI agents should monitor logs and allow the step to complete; elapsed time alone does not indicate a hung or failed run. Investigate actual errors or a failed job before retrying.

## Pull requests

Explain the problem, the resulting change, any documentation updates, and validation results. Wait for required checks to pass and resolve review conversations before merging. Keep the branch current with `main` as required by repository rules.
