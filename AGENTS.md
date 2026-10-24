# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing this repository. It defines the contribution workflow, naming conventions, protection rules, and validation requirements.

- Fetch `origin/main` and create a new conventional branch from that latest revision before making changes. Submit completed changes through a pull request targeting `main`.
- Respect the active branch and tag protections and merged-branch cleanup settings described in CONTRIBUTING.md.
- Use English Conventional Commit messages and `<type>/<short-kebab-case-description>` branch names.
- Update the relevant documentation in `docs/` in the same commit whenever code changes.
- CI installs Chromium and its system dependencies. This step can take ten to fifteen minutes; that duration is normal. Monitor the job logs and let it finish instead of treating elapsed time alone as a failure or repeatedly cancelling and restarting it.
