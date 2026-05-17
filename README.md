# BriefChat

A Chrome extension that instantly summarizes any web page and lets you chat with its content using AI.

---

## Features

- **Instant summaries** — opens a side panel with a 2-3 sentence summary of the current page
- **Suggested questions** — chip buttons generated from the page content to get you started
- **Chat** — ask follow-up questions grounded in the page you're reading
- **Multi-provider support** — bring your own API key for OpenAI, Anthropic Claude, Google Gemini, or xAI Grok
- **Free tier** — works out of the box with 3 free questions per day (no API key required)
- **Guardrails** — message length limits, history caps, and strict system prompts prevent abuse and keep responses on-topic

---

## Architecture

```
Chrome Extension (MV3)
  ├─ Own API key → calls provider directly (OpenAI / Anthropic / Gemini / Grok)
  └─ No key (free tier) → proxy server → OpenAI gpt-4o
                              │
                    briefchat-prod.artfricastudio.com
                    Ubuntu VPS · Apache · PM2 · Node.js
```

---

## Project structure

```
BriefChat/
├── extension/
│   ├── manifest.json        # MV3 manifest
│   ├── background.js        # Service worker — routes messages, calls APIs
│   ├── sidepanel.html       # Side panel UI
│   ├── sidepanel.js         # Side panel logic
│   ├── sidepanel.css        # Styles
│   ├── options.html         # Settings page
│   ├── options.js           # API key input + provider detection
│   └── icons/
└── server/
    ├── index.js             # Express proxy server
    ├── package.json
    └── .env.example
```

---

## Extension setup

1. Clone this repo
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `extension/` folder
5. Click the BriefChat icon in the toolbar to open the side panel

To use your own API key, click the settings icon inside the panel and paste a key. Supported prefixes:

| Prefix | Provider |
|---|---|
| `sk-ant-...` | Anthropic Claude |
| `AIza...` | Google Gemini |
| `xai-...` | xAI Grok |
| `sk-...` | OpenAI |

---

## Server setup

The proxy server is a small Express app that handles the free tier. It stores an OpenAI API key server-side and rate-limits each device to 3 chat questions per day.

### Local development

```bash
cd server
cp .env.example .env
# fill in your OPENAI_API_KEY in .env
npm install
npm run dev
```

### Production (Ubuntu VPS + Apache + PM2)

**1. Install Node.js and PM2**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

**2. Clone and configure**

```bash
git clone https://github.com/YOUR_USERNAME/BriefChat.git ~/briefchat
cd ~/briefchat/server
npm install --production
cp .env.example .env
nano .env  # add your OPENAI_API_KEY
```

**3. Start with PM2**

```bash
pm2 start index.js --name briefchat-proxy
pm2 save
pm2 startup  # follow the printed command to enable auto-start on reboot
```

**4. Configure Apache reverse proxy**

```bash
sudo a2enmod proxy proxy_http
```

Create `/etc/apache2/sites-available/briefchat.conf`:

```apache
<VirtualHost *:80>
    ServerName briefchat-prod.artfricastudio.com

    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    ErrorLog ${APACHE_LOG_DIR}/briefchat-error.log
    CustomLog ${APACHE_LOG_DIR}/briefchat-access.log combined
</VirtualHost>
```

```bash
sudo a2ensite briefchat.conf
sudo systemctl reload apache2
```

**5. Enable SSL**

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d briefchat-prod.artfricastudio.com
```

---

## Auto-deploy (GitHub Actions)

Pushing to `main` with changes under `server/**` automatically deploys to the VPS via SSH.

Add these secrets to your GitHub repo (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `SSH_HOST` | VPS IP or hostname |
| `SSH_USERNAME` | Linux user (e.g. `ubuntu`) |
| `SSH_PRIVATE_KEY` | Contents of your SSH private key |
| `SSH_PORT` | SSH port (omit to use 22) |

To generate a deploy key on your VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
# paste contents of ~/.ssh/github_deploy into the SSH_PRIVATE_KEY secret
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key used by the proxy for the free tier |
| `PORT` | No | Port the server listens on (default: `3000`) |

---

## Free tier limits

- **Summarize:** unlimited
- **Chat:** 3 questions per device per day, reset at UTC midnight
- Device identity is a UUID stored in `chrome.storage.local`

> **Note:** The rate limit store is in-memory and resets when the server restarts. For persistence across restarts, replace the `Map` in `server/index.js` with Redis or SQLite.

---

## License

MIT
