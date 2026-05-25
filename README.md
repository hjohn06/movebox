# MoveBox — Deploy Guide (GitHub Pages + Cloudflare Worker)

Total time: ~25 minutes. Everything is free.

---

## Part 1 — Deploy the AI Proxy (Cloudflare Worker)

The Worker keeps your Anthropic API key server-side so it's never exposed in the browser.

### 1a. Install Wrangler (Cloudflare CLI)

You need Node.js installed (https://nodejs.org — LTS version).

```bash
npm install -g wrangler
```

### 1b. Log in to Cloudflare

```bash
wrangler login
```

This opens a browser window. Sign up for a free Cloudflare account if you don't have one.

### 1c. Deploy the Worker

From inside the `movebox-worker/` folder:

```bash
cd movebox-worker
wrangler deploy
```

You'll see output like:
```
Published movebox-ai-proxy (1.23 sec)
  https://movebox-ai-proxy.YOUR-SUBDOMAIN.workers.dev
```

**Copy that URL — you'll need it in Part 3.**

### 1d. Set your Anthropic API key as a secret

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Paste your key when prompted (get one at https://console.anthropic.com).
The key is stored encrypted on Cloudflare — never in code.

### 1e. Add your GitHub Pages URL to the worker's allowed origins

Open `movebox-worker/worker.js` and add your GitHub Pages URL to `ALLOWED_ORIGINS`:

```js
const ALLOWED_ORIGINS = [
  'https://yourusername.github.io',   // ← add this
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];
```

Then redeploy:

```bash
wrangler deploy
```

---

## Part 2 — Deploy the App (GitHub Pages)

### 2a. Create a GitHub repository

1. Go to https://github.com/new
2. Repository name: `movebox`
3. Set to **Public**
4. Click **Create repository**

### 2b. Upload the app files

1. In your new repo, click **Add file → Upload files**
2. Unzip `movebox.zip`
3. Open the `movebox/` folder — drag **all files inside it** into GitHub
   (index.html, manifest.json, css/, js/, icons/, oauth-callback.html)
   Do NOT upload the netlify/ folder or netlify.toml — those are Netlify-only.
4. Click **Commit changes**

### 2c. Enable GitHub Pages

1. Go to your repo **Settings → Pages** (left sidebar)
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Click **Save**

Your app is live at:
```
https://yourusername.github.io/movebox
```

(Takes about 60 seconds to go live. Refresh if you see a 404.)

---

## Part 3 — Connect the Worker to the App

Open `movebox/js/ai.js` and replace the WORKER_URL:

```js
const WORKER_URL = 'https://movebox-ai-proxy.YOUR-SUBDOMAIN.workers.dev';
```

with your actual Worker URL from Part 1c, e.g.:

```js
const WORKER_URL = 'https://movebox-ai-proxy.howing.workers.dev';
```

Then upload the updated `js/ai.js` to GitHub (drag it onto the file in the GitHub UI,
or use the pencil edit icon). GitHub Pages redeploys automatically.

---

## Part 4 — Google Drive OAuth

### 4a. Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **New Project** → name it "MoveBox" → Create
3. Make sure your new project is selected

### 4b. Enable the Drive API

1. **APIs & Services → Library**
2. Search "Google Drive API" → **Enable**

### 4c. Create OAuth credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `MoveBox`
4. Authorized JavaScript origins:
   ```
   https://yourusername.github.io
   ```
5. Authorized redirect URIs:
   ```
   https://yourusername.github.io/movebox/oauth-callback.html
   ```
6. Click **Create** — copy the **Client ID**

### 4d. Configure OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** → Create
3. App name: `MoveBox`, add your email as support email
4. Scopes: add `https://www.googleapis.com/auth/drive.file`
5. Test users: add your Google account email (and your partner's)
6. Save

### 4e. Add Client ID to the app

Open `movebox/js/drive.js` and replace:
```js
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
```
with your actual Client ID:
```js
const CLIENT_ID = '123456789-abc.apps.googleusercontent.com';
```

Upload the updated file to GitHub.

---

## Testing checklist

- [ ] App loads at `https://yourusername.github.io/movebox`
- [ ] Can create a box and see QR code
- [ ] Settings → Connect Google Drive → OAuth popup appears → connects
- [ ] Add a photo to a box → syncs to Drive
- [ ] "Identify contents with AI" button works (returns item list)
- [ ] Open app on a second device → Connect Drive → Sync → all boxes appear

---

## Cost summary

| Service              | Free tier                        |
|----------------------|----------------------------------|
| GitHub Pages         | Unlimited (public repos)         |
| Cloudflare Workers   | 100,000 requests/day             |
| Google Drive API     | Free (drive.file scope)          |
| Anthropic API        | ~$0.001 per photo identification |

For a personal move, total cost is effectively **$0**.

---

## Updating the app later

Any file you change in the GitHub repo auto-redeploys to Pages within ~30 seconds.
For Worker changes, run `wrangler deploy` again from the `movebox-worker/` folder.
