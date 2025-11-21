# Frontend Lint Cleanup Plan

Goal: remove unused imports/vars and empty blocks across `src/` and restore stricter lint rules.

## Steps

1) Run autofixers
- Try eslint autofix to remove easy issues.

2) Remove unused imports/vars in key files
- Trim unused React 19 imports (no need to import React for JSX).
- Remove unused icons, components, and helpers from files where they’re not referenced.
- Replace placeholder catches with `// ignore` plus at least one statement or remove blocks.

3) Restore strict rules
- Switch to strict config and ensure zero errors:
  - `npm run lint:strict`

4) Keep tests clean
- Test files remain exempt from unused rules; keep them readable.

## Commands

```powershell
# From frontend/
npm run lint
npm run lint:fix
npm run lint:strict
```

## Notes
- React 19 no longer requires `import React` for JSX; remove it when unused.
- Prefer `_`-prefixed args for intentionally unused parameters.
- If a symbol will be used soon, consider adding a `// TODO` to track and avoid premature removal.
