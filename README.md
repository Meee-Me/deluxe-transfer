# Deluxe Transfer

Send files with a code. Upload one or more files, get a 6-character code and a link, and
whoever has either can download them for 24 hours.

- Several files at once (up to 100 MB in total), with an upload progress bar
- 6-character code (no look-alike characters such as 0/O or 1/I) plus a share link
- The sender picks how long files stay: 1 hour, 1 day, 3 days, 7 days, or **Forever** (kept until
  they delete it; needs a Deluxe sign-in so guests can't fill the storage; `FOREVER=off` turns it off)
- A QR code of the link, to open it on a phone nearby
- Receivers see photo thumbnails, can open photos, videos and PDFs, open documents in Deluxe
  Docs, and download everything as one zip
- Uploads can be cancelled; only the sender can **Delete now**; everything else is removed after it expires
- **Send to people** (signed in with Deluxe Main): type as many people as you like in **Send to**,
  as `name`, `@name`, `name@deluxemail.com`, `Name <name@deluxemail.com>` or their full name. Each
  shows as a chip, checked with Deluxe Main. The files arrive in their **Deluxe Transfer Inbox**
  (with a count of new ones on the Inbox tab), from you, with your message. Nothing is sent by
  mail. Sending files with just a code needs no account.
- **Inbox** (sent to you, plus codes you opened) and **Sent**, kept in your Deluxe account (Deluxe Main).
- **Save to Deluxe Drive**: received files can be saved into your own Deluxe Drive, in a
  "Deluxe Transfer" folder.
- `/api/health` shows whether storage and sending to people are set up (yes/no only).

Runs on **Vercel**. Files go from the browser straight into storage, so Vercel's 4.5 MB function
limit does not apply. Storage is **Vercel Blob** when it is connected, otherwise **Supabase
Storage** when Supabase is connected (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY`; the public `deluxe-transfer` bucket is made on first use, or set
`SUPABASE_BUCKET`). `/api/health` says which one is in use.

A Blob store can be **public or private**; Transfer works out which (or set `BLOB_ACCESS`). With a
private store, files are served through `/api/file?code=…&n=…` to anyone with the code. Only
photos, videos, audio and PDFs open in the browser there; anything else (web pages, SVGs…) is always
downloaded, in a sandbox, so a file can never run on Transfer's own address.

## Put it on Vercel

1. **Add New → Project**, import this repository. Leave the build settings as they are
   (`vercel.json` handles them).
2. In the project, open **Storage → Create → Blob**, pick **Public** access, and connect it to
   the project. That adds `BLOB_READ_WRITE_TOKEN` for you.
3. **Deployments → Redeploy** so the new token is picked up.

4. For **sending to people**, add the environment variable `MAIN_APP_KEY` (mark it
   **Sensitive**, Production) with Deluxe Transfer's key, then redeploy. Deluxe Main only has the
   key's SHA-256 fingerprint (`keyHash` of `transfer` in Deluxe Main's `worker/apps.js`); a new key
   means putting its new fingerprint there.

Optional environment variables:

| Name | Default | Meaning |
|---|---|---|
| `MAX_MB` | `100` | Biggest transfer, in MB (also change it in `public/index.html`) |
| `EXPIRE_HOURS` | `24` | How long files stay unless the sender picks otherwise |
| `MAX_EXPIRE_HOURS` | `168` | Longest the sender may pick (1, 24, 72 or 168 hours) |
| `MAIN_URL` | `https://deluxe-drive.deluxelordd.workers.dev/main` | The Deluxe data server |
| `MAIL_DOMAIN` | `deluxemail.com` | The domain in Deluxe addresses people may type (`name@deluxemail.com`) |
| `CRON_SECRET` | — | Set any random text so only Vercel Cron can run the cleanup |

A daily Vercel Cron job (`/api/cleanup`) deletes expired transfers and unfinished uploads.
Expired codes stop working right away; the files themselves are removed at the next daily run.

## How it works

```
browser ── POST /api/create ─────────► code + sender key
        ── upload each file ─────────► Vercel Blob   (allowed by /api/upload)
        ── POST /api/finish ─────────► saves t/CODE/meta.json, returns the link
receiver ─ GET /api/transfer?code= ──► file list with download links
sender ─── POST /api/share ──────────► Deluxe Main: an unread entry in the person's Transfer inbox
```

Each person's inbox is Deluxe Transfer's own data for them in Deluxe Main (`received/CODE`). For
"Save to Deluxe Drive" it may only **add** new Drive files; Deluxe Main and Deluxe Drive refuse it
reading, changing or deleting anyone's files.

Files are stored at `t/CODE/<random 24 characters>/<file name>`, so their addresses can't be guessed.

## Develop

```
npm install
npm test                 # API tests with an in-memory Blob store
FAKE_MAIN=1 node tests/dev-server.mjs  # local server on :3000 (in-memory storage, pretend Deluxe Main)
STORAGE=supabase node tests/dev-server.mjs  # the same with a pretend Supabase Storage
npm run bundle           # rebuild public/lib.js (upload, zip and QR code libraries)
```
