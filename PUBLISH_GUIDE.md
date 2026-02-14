# pg-migrate-runner — npm Publish & Update Guide

> **Package:** `pg-migrate-runner`
> **Repo:** [github.com/mohammadalnajar/pg-migrate-runner](https://github.com/mohammadalnajar/pg-migrate-runner)
> **Local path:** `~/packages/npm/pg-migrate-runner`
> **npm user:** `mohammadalnajar`

---

## Table of Contents

1. [First-Time Publish](#1-first-time-publish)
2. [Publishing Updates](#2-publishing-updates)
3. [Quick Reference Commands](#3-quick-reference-commands)
4. [What Goes Where](#4-what-goes-where)
5. [Common Issues & Fixes](#5-common-issues--fixes)
6. [Cleanup Checklist](#6-cleanup-checklist)

---

## 1. First-Time Publish

> Skip this section if you've already published v1.0.0.

### Step 1: Navigate to the package

```bash
cd ~/packages/npm/pg-migrate-runner
```

### Step 2: Delete `dist/` and `node_modules/`

They should NOT be in git. The `.gitignore` already excludes them, but if they exist locally, remove them to start clean:

```bash
rm -rf dist node_modules
```

**Why?**
| Folder          | In Git? | In npm? | Reason                                              |
| --------------- | ------- | ------- | --------------------------------------------------- |
| `node_modules/` | No      | No      | Always installed fresh via `npm install`            |
| `dist/`         | No      | Yes     | Auto-built by `prepublishOnly` during `npm publish` |

### Step 3: Install dependencies

```bash
npm install
```

### Step 4: Verify the build works

```bash
npm run build
```

Should complete with zero errors. Check `dist/` was created:

```bash
ls dist/
# Should show: cli.js, index.js, runner.js, errors.js, etc. + .d.ts files
```

### Step 5: Preview what npm will publish

```bash
npm pack --dry-run
```

**Should include:**
- `dist/*.js`, `dist/*.d.ts`, `dist/*.js.map`, `dist/*.d.ts.map`
- `README.md`
- `LICENSE`
- `package.json`

**Should NOT include:**
- `src/` (blocked by `.npmignore`)
- `tsconfig.json` (blocked by `.npmignore`)
- `node_modules/` (always excluded)
- `.gitignore` (blocked by `.npmignore`)

### Step 6: Login to npm (if not already)

```bash
npm whoami
# If this shows your username, you're logged in. Skip to Step 7.

# Otherwise:
npm login
# Enter username, password, email, and OTP if 2FA is enabled
```

### Step 7: Publish

```bash
npm publish
```

This automatically runs `prepublishOnly` → `npm run clean && npm run build` → then publishes.

### Step 8: Verify on npm

Open: **https://www.npmjs.com/package/pg-migrate-runner**

Check:
- [ ] Description shows correctly
- [ ] README renders properly
- [ ] Version is `1.0.0`
- [ ] Files tab shows only `dist/`, `README.md`, `LICENSE`

### Step 9: Test installation in a fresh project

```bash
mkdir /tmp/test-pg-migrate && cd /tmp/test-pg-migrate
npm init -y
npm install pg-migrate-runner pg

# Test CLI
npx pg-migrate-runner --help

# Test API
node -e "const { MigrationRunner } = require('pg-migrate-runner'); console.log('OK');"

# Cleanup
rm -rf /tmp/test-pg-migrate
```

---

## 2. Publishing Updates

### Step 1: Make your code changes

Edit files in `src/`. Always test locally first:

```bash
cd ~/packages/npm/pg-migrate-runner

# Build to verify
npm run build

# Test manually if needed
node -e "const m = require('./dist/index'); console.log(Object.keys(m).join(', '));"
```

### Step 2: Choose the version bump

| Change Type | Command             | Example       | When to use                                     |
| ----------- | ------------------- | ------------- | ----------------------------------------------- |
| **Patch**   | `npm version patch` | 1.0.0 → 1.0.1 | Bug fixes, typos, minor improvements            |
| **Minor**   | `npm version minor` | 1.0.0 → 1.1.0 | New features (backward compatible)              |
| **Major**   | `npm version major` | 1.0.0 → 2.0.0 | Breaking changes (API changes, removed exports) |

### Step 3: Commit your changes first

`npm version` requires a clean working tree:

```bash
git add .
git commit -m "fix: description of what changed"
```

### Step 4: Bump the version

```bash
# Pick one:
npm version patch -m "release: v%s"
npm version minor -m "release: v%s"
npm version major -m "release: v%s"
```

This does three things automatically:
1. Updates `version` in `package.json`
2. Creates a git commit with the message
3. Creates a git tag (e.g., `v1.0.1`)

### Step 5: Publish to npm

```bash
npm publish
```

### Step 6: Push to GitHub (including the tag)

```bash
git push && git push --tags
```

### Step 7: Verify

```bash
# Check npm
npm view pg-migrate-runner version

# Check in a fresh project
npm install pg-migrate-runner@latest
```

---

## 3. Quick Reference Commands

### Everyday commands

```bash
# Navigate to package
cd ~/packages/npm/pg-migrate-runner

# Build
npm run build

# Clean build
npm run clean && npm run build

# Preview what gets published
npm pack --dry-run

# Check current version
node -p "require('./package.json').version"

# Check published version
npm view pg-migrate-runner version

# Check all published versions
npm view pg-migrate-runner versions --json
```

### Full publish flow (copy-paste)

```bash
cd ~/packages/npm/pg-migrate-runner
git add .
git commit -m "fix: your change description"
npm version patch -m "release: v%s"
npm publish
git push && git push --tags
```

### Unpublish a bad release (within 72 hours)

```bash
npm unpublish pg-migrate-runner@1.0.1
```

> **Warning:** npm only allows unpublish within 72 hours. After that, you must publish a new version instead.

### Deprecate a version (instead of unpublish)

```bash
npm deprecate pg-migrate-runner@1.0.1 "Use 1.0.2 instead — contains critical bug fix"
```

---

## 4. What Goes Where

### File routing overview

```
pg-migrate-runner/
├── .git/              → Git only (not npm)
├── .gitignore         → Git only (not npm)
├── .npmignore         → Git only (controls npm exclusions)
├── src/               → Git only (not npm — blocked by .npmignore)
│   ├── cli.ts
│   ├── errors.ts
│   ├── factory.ts
│   ├── helpers.ts
│   ├── index.ts
│   ├── lock.ts
│   ├── logger.ts
│   ├── runner.ts
│   ├── types.ts
│   └── validator.ts
├── dist/              → npm only (not git — blocked by .gitignore)
│   ├── *.js           → Compiled JavaScript
│   ├── *.d.ts         → TypeScript declarations
│   └── *.js.map       → Source maps
├── node_modules/      → Neither (always excluded)
├── tsconfig.json      → Git only (not npm)
├── package.json       → Both Git and npm
├── package-lock.json  → Git only
├── README.md          → Both Git and npm
└── LICENSE            → Both Git and npm
```

### How `.npmignore` works

```
src/           ← Excludes source TypeScript (consumers use dist/)
*.ts           ← Excludes any loose .ts files
tsconfig.json  ← Excludes TS config
.gitignore     ← Excludes git config
```

### How `.gitignore` works

```
node_modules/    ← Never commit dependencies
dist/            ← Never commit build output (rebuilt on publish)
*.tsbuildinfo    ← TypeScript incremental build cache
.DS_Store        ← macOS folder metadata
```

### How `"files"` in package.json works

The `files` array is a **whitelist** of what npm includes:

```json
"files": ["dist", "README.md", "LICENSE"]
```

Combined with `.npmignore`, this ensures only compiled output + docs ship to npm.

---

## 5. Common Issues & Fixes

### "npm ERR! 403 Forbidden - PUT ... - You do not have permission"

**Cause:** Package name is taken, or you're not logged in.

```bash
# Check if name is available
npm view pg-migrate-runner

# Re-login
npm login
```

### "npm ERR! Git working directory not clean"

**Cause:** `npm version` requires all changes to be committed.

```bash
git add .
git commit -m "chore: prepare for release"
npm version patch -m "release: v%s"
```

### "prepublishOnly script failed"

**Cause:** TypeScript compilation error.

```bash
# Find the error
npm run build

# Fix the TypeScript error, then retry
npm publish
```

### CLI not working after install (`pg-migrate: command not found`)

**Cause:** `dist/cli.js` missing or no shebang.

```bash
# Check the file exists in the published package
npm pack --dry-run | grep cli

# Check shebang
head -1 dist/cli.js
# Should show: #!/usr/bin/env node

# Users should use npx if not globally installed:
npx pg-migrate --help
```

### "Cannot find module 'pg'" when using the package

**Cause:** `pg` is a peer dependency — the consumer must install it.

```bash
npm install pg-migrate-runner pg
```

### dist/ accidentally committed to git

```bash
git rm -r --cached dist/
git commit -m "chore: remove dist from git tracking"
git push
```

### node_modules/ accidentally committed to git

```bash
git rm -r --cached node_modules/
git commit -m "chore: remove node_modules from git tracking"
git push
```

---

## 6. Cleanup Checklist

### Before every publish

- [ ] All code changes are in `src/`
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm pack --dry-run` shows only expected files
- [ ] All changes committed (`git status` clean)
- [ ] Version bumped (`npm version patch/minor/major`)
- [ ] No `console.log` debug statements in source

### After publish

- [ ] `npm view pg-migrate-runner version` shows new version
- [ ] `git push && git push --tags` done
- [ ] Tested `npm install pg-migrate-runner` in a fresh project
- [ ] npm page renders correctly

### Things to NEVER do

- ❌ Commit `dist/` to git — it's auto-built
- ❌ Commit `node_modules/` to git — always installed fresh
- ❌ Edit files in `dist/` directly — edit `src/` and rebuild
- ❌ Publish without building — `prepublishOnly` handles this, but verify
- ❌ Forget to push tags — `git push --tags` after every version bump
