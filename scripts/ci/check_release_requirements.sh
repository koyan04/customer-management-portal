#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

failures=()

add_failure() {
  failures+=("$1")
}

EXPECTED_REPO_URL="https://github.com/koyan04/customer-management-portal.git"
if ! grep -Fq "$EXPECTED_REPO_URL" README.md; then
  add_failure "README.md is missing repository URL $EXPECTED_REPO_URL"
fi

if git grep -n "koyan-testpilot" -- . >/dev/null 2>&1; then
  add_failure "Found legacy 'koyan-testpilot' references. Remove them."
fi

version_line=$(tr -d '\r' < VERSION | head -n1)
semver=$(echo "$version_line" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') || semver=""
if [ -z "$semver" ]; then
  add_failure "VERSION file must contain semantic version (e.g., 'cmp ver 1.0.14')."
else
  tag="v$semver"
  install_pattern="raw.githubusercontent.com/koyan04/customer-management-portal/${tag}/scripts/install.sh"
  if ! grep -Fq "$install_pattern" README.md; then
    add_failure "README install snippet must point to ${tag}. Missing pattern: $install_pattern"
  fi
  fallback=$(grep -Eo 'FALLBACK_TAG="[^"]+"' scripts/bootstrap.sh | head -n1 | sed -E 's/FALLBACK_TAG="([^"]+)"/\1/')
  if [ -z "$fallback" ]; then
    add_failure "scripts/bootstrap.sh must define FALLBACK_TAG."
  elif [ "$fallback" != "$tag" ]; then
    add_failure "scripts/bootstrap.sh FALLBACK_TAG ($fallback) must match VERSION tag $tag"
  fi
fi

windows_repo="https://github.com/koyan04/customer-management-portal.git"
windows_cmd=".\\scripts\\install-windows.ps1 -InstallDir C:\\srv\\cmp -RepoUrl ${windows_repo}"
if ! grep -Fq "$windows_cmd" README.md; then
  add_failure "README Windows install snippet missing expected command: $windows_cmd"
fi

if ! grep -Fq "$windows_repo" scripts/install-windows.ps1; then
  add_failure "scripts/install-windows.ps1 must default to $windows_repo"
fi

if ! grep -Fq "koyan04/customer-management-portal.git" scripts/install.sh; then
  add_failure "scripts/install.sh must default to the koyan04 repository URL."
fi

if git ls-files | grep -E '\\.env$' >/dev/null 2>&1; then
  tracked_env=$(git ls-files | grep -E '\\.env$')
  add_failure "Sensitive .env files tracked in git: $tracked_env"
fi

for file in RELEASE_NOTES_v*.md; do
  [ -e "$file" ] || continue
  ver=$(echo "$file" | sed -E 's/RELEASE_NOTES_v([0-9]+\.[0-9]+\.[0-9]+)\.md/\1/')
  if [ -z "$ver" ]; then
    add_failure "Unable to parse version from $file"
    continue
  fi
  tag="v$ver"
  pattern="raw.githubusercontent.com/koyan04/customer-management-portal/${tag}/scripts/install.sh"
  if ! grep -Fq "$pattern" "$file"; then
    add_failure "$file must reference installer for ${tag} (missing $pattern)"
  fi
done

for file in PR_DESC_RELEASE_*.md; do
  [ -e "$file" ] || continue
  ver=$(echo "$file" | sed -E 's/PR_DESC_RELEASE_([0-9]+\.[0-9]+\.[0-9]+)\.md/\1/')
  if [ -z "$ver" ]; then
    add_failure "Unable to parse version from $file"
    continue
  fi
  tag="v$ver"
  pattern="raw.githubusercontent.com/koyan04/customer-management-portal/${tag}/scripts/install.sh"
  if ! grep -Fq "$pattern" "$file"; then
    add_failure "$file must mention installer snippet for ${tag} (missing $pattern)"
  fi
done

if [ ${#failures[@]} -gt 0 ]; then
  printf 'Release requirement checks failed:%s' "\n" >&2
  for msg in "${failures[@]}"; do
    printf '  - %s%s' "$msg" "\n" >&2
  done
  exit 1
fi

echo "Release requirement checks passed."