# XopaShop v5 — SQLite + Telegram

This repository is upgraded from v4. The visual identity, colors, billboard asset, and overall page design are retained. Node **22.13+** recommended (native `node:sqlite`).

## Local startup

```bash
npm install
cp .env.example .env   # On Windows PowerShell: Copy-Item .env.example .env
npm run server           # terminal 1
npm run dev              # terminal 2
```

Frontend: http://localhost:5173, API: http://localhost:8787/api/health. Vite proxies `/api` to the server.

## SQLite

`data/xopashop.sqlite` is automatically created on the first backend launch. The existing `data/store.json` is imported **once** if the database is empty. Future changes are written to SQLite only. Do not commit or delete the live SQLite database. Back up the `.sqlite` file using SQLite's online backup API or `VACUUM INTO` while the server runs; alternatively stop the server and copy it along with WAL files.

## Telegram configuration, precisely

* `TELEGRAM_BOT_TOKEN`: the bot token supplied by Telegram **@BotFather** after `/newbot`. Never put it in React or GitHub.
* `TELEGRAM_ADMIN_CHAT_ID`: numeric chat ID of the admin or private admin group that should receive order/review notifications. To find a personal chat ID, message your bot and inspect `https://api.telegram.org/bot<TOKEN>/getUpdates` **before enabling a webhook**, or use a trusted `get ID` bot. For a private group the ID often starts with `-100`. Do not insert the public `@username` in place of a numeric ID.
* `TELEGRAM_CHANNEL_ID`: numeric ID of the *specific source channel*. Add your bot as an administrator with permission to read channel posts. It is distinct from the admin notification chat ID. The webhook ignores posts from other channels.
* `TELEGRAM_WEBHOOK_SECRET`: a random alphanumeric string (e.g. generated using `node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"`). The same secret is used when registering the webhook and validating each incoming Telegram request.
* `PORT=8787`: port your Node process binds to locally. Set it according to your host's provided PORT when deployed.
* `ADMIN_KEY`: random secret (generate using the command above), used to authorize the admin UI via `X-Admin-Key`. Never share publicly. For real production, replace this shared secret with role-based accounts, rate limiting, and logging.
* `PUBLIC_SITE_URL`: **public HTTPS address of the deployed Node backend**, such as `https://api.example.com`, NOT `localhost`, NOT a GitHub Pages site. Telegram sends callbacks to `<PUBLIC_SITE_URL>/api/telegram/webhook`.
* `VITE_TELEGRAM_SHOP_URL` / `VITE_TELEGRAM_BOT_URL`: public t.me links to your actual channel and bot. These may be visible in the browser.

After your backend is reachable over HTTPS, run `npm run webhook` **once** (or whenever the webhook URL changes). Telegram Bot API returns the registration result. Verify from BotFather token `getWebhookInfo` if needed.

### Channel product format

Post this as text or a caption with a product photo:

```text
#product | Плакучий обсидіян | products | 64 | 80 | | 32 | Minecraft | Опис товару
```

Fields: tag | title | department (`visuals`, `giveaways`, `products`, `resource-packs`, `pvp`, `other`) | price | old price (optional) | photo URL (optional) | stock | game | description.

A photo attached to the Telegram channel post is automatically downloaded to the server's `uploads/` when the photo URL field is blank. Edited posts update by Telegram message ID. Posts made before the bot was added are **not retroactively imported**; repost or import them separately.

Bot commands: `/start`, `/help`, `/catalog`, `/deals`, `/track ORDER_CODE`, `/order ORDER_CODE`. Telegram can access just the summary/status via an order code; do not treat the code as proof of account ownership. Do not send private address or customer contact details via bot commands.

## GitHub workflow

The repository includes `.gitignore` and the previous `.github/workflows/pages.yml` workflow. Use a private repository if sensitive configuration is present, but **never commit** `.env`, `data/*.sqlite`, or `uploads/`. GitHub Pages hosts frontend only and cannot execute Node/SQLite. Host Node on a persistent filesystem (VPS) and back up SQLite; ephemeral PaaS filesystem resets will lose your orders.

```bash
git init
git add .
git commit -m "XopaShop v5: SQLite, reviews, tracking and Telegram"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/xopashop.git
git push -u origin main
```

For production split frontend/backend deployments, set `VITE_API_URL=https://api.example.com` in your frontend build environment. Configure your host/domain and CORS securely before going public. GitHub Actions deployment should not expose server secrets in client bundles.

## Known limitations and release checklist

1. `node --check server/index.js` verifies syntax, not full behavior. Run `npm install`, `npm run build`, API tests, and mobile-browser checks on a machine with network access before publishing.
2. This is an incremental migration of v4. Some APIs still read/write complete entity collections; SQLite stores records in indexed tables, but high-concurrency writes should be changed to per-record SQL transactions before heavy production traffic.
3. Admin shared key and public tracking-code lookups are not suitable for high-risk private orders; implement proper admin roles and authorization before accepting real personal information.
4. Frontend media, including the home billboard `src/assets/xopashop-billboard.png`, is preserved from v4.
