# Contributing

Thanks for your interest in improving Customer Management Portal!

## Ways to contribute
- Report bugs via GitHub Issues with steps to reproduce and environment details
- Suggest enhancements with clear motivation and scope
- Submit pull requests with focused changes and tests when applicable

## Pull Requests
- Fork the repo and create a feature branch from `main` (or the active feature branch)
- Keep PRs small and scoped; add tests for behavior changes
- Ensure `backend` tests pass and frontend builds locally
- Update docs (README/CHANGELOG) if behavior or setup changes
- Reference related issues in the PR description

## Commit messages
- Use clear, descriptive messages (imperative mood)
- Prefix docs-only changes with `Docs:` and release bumps with `Release:` when possible

## Code style & tooling
- Node: follow existing patterns, async/await, minimal dependencies
- Frontend: Vite + React; follow existing ESLint config
- Run tests before submitting (backend Jest, frontend Vitest)

## Versioning & releases
- Human-friendly version lives in `VERSION` (e.g., `cmp ver 1.0.1`)
- Tag releases as `vX.Y.Z`; keep `CHANGELOG.md` current

## Security
- Please do not open public issues for security vulnerabilities
- See `SECURITY.md` for how to report responsibly

## License
By contributing, you agree that your contributions are licensed under the repository's MIT License.
