# Deluxe Transfer

Send files with a code. Upload one or more files, get a 6-character code and a link, and
whoever has either can download them until they expire.

- Several files at once, with an upload progress bar
- 6-character code (no look-alike characters such as 0/O or 1/I) plus a share link
- Receivers download each file or all of them as one zip
- Files are deleted after 24 hours, or right away with **Delete now** (only the sender can)

## Deploy on Render

| Setting | Value |
|---|---|
| Runtime | Python |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 600` |

Or use **New → Blueprint**. `render.yaml` sets this up for you.

Settings you can change (environment variables):

| Name | Default | Meaning |
|---|---|---|
| `MAX_MB` | `100` | Biggest upload, in MB |
| `EXPIRE_HOURS` | `24` | How long files stay |
| `DATA_DIR` | `./data` | Where files are kept |

**Free plan note:** Render's free plan has no lasting disk. Files can disappear before the
24 hours are up when the service redeploys, restarts, or wakes after sleeping (it sleeps after
15 idle minutes). To keep files the full time, use a paid plan with a persistent disk and set
`DATA_DIR` to the disk's mount path.

## Run locally

```
pip install -r requirements.txt
python app.py               # http://localhost:5000
python -m unittest tests/test_app.py
```
