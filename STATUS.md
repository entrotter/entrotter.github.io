# Website status

## 2026-09-27 — Evergreen experiment console (review branch)

The existing website now presents the four-action Uniswap comparison at `/`,
with purple UFO artwork, orbital motion, a local command builder and a collapsible
v0.1 report explorer. Visible copy does not name a hackathon. The event subdirectory
has been removed from this source tree and the deployment allowlist.

The measured example and comparison validator were moved without changing their
bytes. Original wire-format names and pinned engine provenance remain intact.
No new execution, profitability result or live swap is claimed. Only this website
repository's code was changed; historical and unrelated PRs are preserved.

Validation performed on this change:

- Python site checks: 11 passed. The new root-integration regression initially
  failed before implementation, then passed.
- Node report checks: 29 passed across the original and comparison formats.
- Playwright Chromium at 1440×1000 and 390×844: four actions, recorded-result
  label, constraint decision, JSON download, command generation/input rejection,
  valid import, invalid import clearing results/download, legacy EVM and synthetic
  reports, no horizontal overflow, reduced motion and keyboard skip link passed.
- Local `/tokyo2026/` returns 404. Browser error/warning console is empty.
- Desktop, console and mobile screenshots were visually inspected; local images
  are in ignored `output/playwright/`. `git diff --check` passed.

The obsolete separate repository's Pages site was disabled through the GitHub API
under the owner's explicit removal authorization. Its Pages API and public
`https://entrotter.github.io/tokyo2026/` both returned 404 afterwards. The root
`https://entrotter.github.io/` still returned 200. This disables the temporary
publication; it does not delete the separate repository or its history.

The redesigned root is not yet live. PR #13 requires independent approval before
protected-main merge and Pages deployment. The local preview is not deployment
proof. No protection settings were changed and no unrelated PR was merged.
