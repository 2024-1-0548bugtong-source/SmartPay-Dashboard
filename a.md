Deploying HonestPay / SmartPay Dashboard to Vercel — Quick Guide

This file explains how to push fixes and deploy updates to your HonestPay dashboard on Vercel. It covers both the recommended Git integration (auto-deploy) and manual CLI deploys, plus local restart steps.

Prerequisites
- Node.js and npm installed
- Git configured and remote (e.g., GitHub) set for this repository
- A Vercel account and project (or ability to run `vercel login` locally)

Option A — Recommended: Vercel Git integration (auto-deploy)
1. Ensure your repo is pushed to GitHub/GitLab/Bitbucket and the Vercel project is linked to that repo.
2. Make your changes locally and commit them:

```bash
git checkout main
git pull origin main
git add -A
git commit -m "fix: <brief description of fix>"
git push origin main
```

3. Vercel will automatically start a deployment for the pushed commit. Watch the deployment status in the Vercel dashboard (https://vercel.com).
4. For feature branches or PRs, Vercel creates preview deployments automatically.

Option B — Manual deploy with Vercel CLI
1. Install the Vercel CLI (if you prefer manual control):

```bash
npm i -g vercel
# or follow the platform instructions: https://vercel.com/download
```

2. Login and (optionally) link the local folder to the Vercel project:

```bash
vercel login
cd /path/to/SmartPay-Dashboard
vercel link   # follow prompts to select your project
```

3. Deploy to production manually:

```bash
vercel --prod --confirm
```

4. Check logs if something fails:

```bash
vercel logs <your-deployment-url> --prod
```

Local server & bridge (development / local testing)
- If you run the dashboard locally using `server.js` (Node), restart it after code changes so the new code takes effect.

Simple restart commands (POSIX):

```bash
# stop previous node process (if started manually)
pkill -f "node server.js" || true
# start server
node server.js
```

Using pm2 (recommended for background runs):

```bash
pm2 start server.js --name honestpay
# after changes
pm2 restart honestpay
```

Restart the serial bridge (so it sends events to the updated API endpoint):

```bash
ALLOW_EVENT_POSTS=true node bridge-json-vercel.js /dev/ttyACM0 https://<your-deployment-url>
# or for testing against local server
ALLOW_EVENT_POSTS=true node bridge-json-vercel.js /dev/ttyACM0 http://localhost:3000
```

Quick verification steps
- After deploy, open the dashboard URL and refresh the page.
- Check server/bridge console logs for `[SENT]`, `[RAW]`, `[COUNT]` messages.
- Hit the API endpoints manually to verify data:

```bash
curl https://<your-deployment-url>/api/transactions
curl https://<your-deployment-url>/api/counter
# or local
curl http://localhost:3000/api/transactions
curl http://localhost:3000/api/counter
```

Automating with a small deploy script
Create `scripts/deploy.sh` (optional) to standardize the push + deploy flow:

```bash
#!/usr/bin/env bash
set -e
msg=${1:-"chore: deploy changes"}
# commit & push
git add -A
git commit -m "$msg" || echo "No changes to commit"
git push origin main
# optional: trigger a Vercel deploy from local
# vercel --prod --confirm
```

Notes & troubleshooting
- If you change files under `/api` or server-side code, a Vercel redeploy is required for the new serverless functions to take effect.
- If your project uses a build step (look for `package.json` in `artifacts/smartpay-dashboard`), ensure the correct build settings in Vercel are configured (Framework, Build Command, Output Directory).
- Use the Vercel dashboard to add environment variables (Project → Settings → Environment Variables) rather than committing secrets to the repo.
- If Vercel CLI is unavailable or you prefer not to use it, pushing to the branch linked to Vercel repo is safest — Vercel will build and deploy automatically.

Want me to deploy for you?
- I can attempt to run a deploy from here, but I will need one of the following:
  - Git remote push access from this environment (credentials) and Vercel CLI authenticated here, or
  - A Vercel token and confirmation to run `vercel --prod` from this workspace.

If you prefer, I can just prepare a script and guide (this file). Tell me if you want me to try deploying now and which method you prefer (Git push + Vercel CLI, or just push to GitHub and let Vercel auto-deploy).