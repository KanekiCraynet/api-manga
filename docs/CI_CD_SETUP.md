# CI/CD Setup Guide

## GitHub Actions Workflow

File: `.github/workflows/ci-cd.yml`

### What it does:
1. **On Push/PR**: Runs syntax check and tests
2. **On Main Branch Push**: Deploys to Vercel Production

---

## Required GitHub Secrets

Go to your repo → Settings → Secrets and variables → Actions → New repository secret

| Secret Name | How to Get |
|-------------|------------|
| `VERCEL_TOKEN` | [Vercel Dashboard](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_ORG_ID` | In `.vercel/project.json` after `vercel link` (or Vercel Settings) |
| `VERCEL_PROJECT_ID` | In `.vercel/project.json` after `vercel link` (or Project Settings → General) |

---

## Getting Vercel IDs

```bash
# Install Vercel CLI
npm i -g vercel

# Link your project (creates .vercel folder)
vercel link

# Check the generated file
cat .vercel/project.json
```

Output example:
```json
{
  "orgId": "team_xxxxxx",
  "projectId": "prj_yyyyyy"
}
```

---

## Workflow Options

### Trigger on specific branches only:
```yaml
on:
  push:
    branches: [main]  # Only main branch
```

### Add environment variables:
```yaml
env:
  NODE_ENV: production
```

---

## Manual Deployment

If you prefer manual deployment:
```bash
# Preview deployment
vercel

# Production deployment
vercel --prod
```
