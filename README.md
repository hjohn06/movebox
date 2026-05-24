# MoveBox — Setup & Deploy Guide

A mobile-first QR inventory tracker for moving boxes. Scan boxes, bind photos,
sync to Google Drive, and use Claude AI to identify contents from photos.

---

## Quick Deploy (~20 min total)

### Step 1 — Deploy to Netlify (free, 5 min)

1. Go to [netlify.com](https://netlify.com) and sign up (free)
2. Drag the `movebox/` folder onto the Netlify dashboard
3. Your app is live at `https://something.netlify.app`
4. (Optional) Add a custom domain under Site settings → Domain management

---

### Step 2 — Google Drive OAuth (10 min)

**A. Create a Google Cloud project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click "New Project" → name it "MoveBox"
3. Select your new project

**B. Enable Drive API**

1. APIs & Services → Library
2. Search "Google Drive API" → Enable

**C. Create OAuth credentials**

1. APIs & Services → Credentials → Create Credentials → OAuth client ID
2. Application type: **Web application**
3. Name: MoveBox
4. Authorized JavaScript origins: `https://your-site.netlify.app`
5. Authorized redirect URIs: `https://your-site.netlify.app/oauth-callback.html`
6. Click Create — copy the **Client ID**

**D. Configure OAuth consent screen**

1. APIs & Services → OAuth consent screen
2. User type: External → Create
3. App name: MoveBox, add your email
4. Scopes: add `https://www.googleapis.com/auth/drive.file`
5. Test users: add your Google account email

**E. Add Client ID to the app**

Open `js/drive.js` and replace:
```js
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
```
with your actual Client ID, then redeploy.

---

### Step 3 — Anthropic AI key (5 min)

**The API key lives server-side in Netlify — it's never exposed to the browser.**

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In Netlify: Site settings → Environment variables → Add variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...`
3. Trigger a redeploy: Deploys → Trigger deploy

---

## How it works

| Feature | How |
|---|---|
| Create box | Tap "+ New Box", fill name/room/priority |
| Get QR label | Auto-shown after creation; tap "Print Label" |
| Scan box | Scan tab → camera QR scan or manual ID |
| Add photos | Open box → tap photo grid → camera or library |
| AI identify | Open box → "Identify contents with AI" (uses Claude claude-opus-4-5) |
| Drive sync | Settings → Connect Google Drive → photos auto-upload |
| PWA install | iPhone: Share → Add to Home Screen |

## File structure

```
movebox/
├── index.html              # App shell + HTML
├── manifest.json           # PWA manifest
├── netlify.toml            # Netlify config
├── oauth-callback.html     # Google OAuth popup receiver
├── css/
│   └── app.css             # All styles
├── js/
│   ├── drive.js            # Google Drive OAuth + upload
│   ├── ai.js               # Anthropic API wrapper
│   └── app.js              # Main app logic
├── icons/
│   ├── icon-192.png        # PWA icon (add yours)
│   └── icon-512.png        # PWA icon (add yours)
└── netlify/
    └── functions/
        └── ai-proxy.js     # Serverless API proxy (keeps key server-side)
```

## Data storage

- Box metadata and photos are stored in **browser localStorage** on your device
- Photos are optionally synced to **Google Drive** in a `MoveBox/` folder
- AI summaries are stored alongside box data in localStorage
- No database or backend required

## Cost

| Service | Cost |
|---|---|
| Netlify (hosting) | Free tier (100GB bandwidth/mo) |
| Google Drive API | Free (Drive file scope) |
| Anthropic API | ~$0.001 per photo identification |
| Total | ~$0 for personal use |
