# Deluxe Transfer

Send files with a code. Upload one or more files, get a 6-character code and a link, and
whoever has either can download them for 24 hours.

- Several files at once (up to 100 MB in total), with an upload progress bar
- 6-character code (no look-alike characters such as 0/O or 1/I) plus a share link
- Only the sender can **Delete now**; everything else is removed after it expires

Runs on **Vercel**. Files go from the browser straight into **Vercel Blob**, so Vercel's
4.5 MB function limit does not apply.

## Put it on Vercel

1. **Add New → Project**, import this repository. Leave the build settings as they are
   (`vercel.json` handles them).
2. In the project, open **Storage → Create → Blob**, pick **Public** access, and connect it to
   the project. That adds `BLOB_READ_WRITE_TOKEN` for you.
3. **Deployments → Redeploy** so the new token is picked up.

Optional environment variables:

| Name | Default | Meaning |
|---|---|---|
| `MAX_MB` | `100` | Biggest transfer, in MB (also change it in `public/index.html`) |
| `EXPIRE_HOURS` | `24` | How long files stay |
| `CRON_SECRET` | — | Set any random text so only Vercel Cron can run the cleanup |

A daily Vercel Cron job (`/api/cleanup`) deletes expired transfers and unfinished uploads.
Expired codes stop working right away; the files themselves are removed at the next daily run.

## How it works

```
browser ── POST /api/create ─────────► code + sender key
        ── upload each file ─────────► Vercel Blob   (allowed by /api/upload)
        ── POST /api/finish ─────────► saves t/CODE/meta.json, returns the link
receiver ─ GET /api/transfer?code= ──► file list with download links
```

Files are stored at `t/CODE/<random 24 characters>/<file name>`, so their addresses can't be guessed.

## Develop

```
npm install
npm test                 # API tests with an in-memory Blob store
node tests/dev-server.mjs  # local server on http://localhost:3000 (in-memory storage)
npm run bundle           # rebuild public/blob-upload.js after updating @vercel/blob
```
