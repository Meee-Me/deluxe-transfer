"""Deluxe Transfer: send files with a short code or a link.

Upload one or more files, get a 6-character code and a link. Whoever has
the code can download the files until they expire (24 hours by default).
"""
import json
import os
import secrets
import shutil
import time
import unicodedata
import re
import zipfile

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

DATA_DIR = os.path.abspath(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data")))
MAX_MB = int(os.environ.get("MAX_MB", "100"))
EXPIRE_HOURS = float(os.environ.get("EXPIRE_HOURS", "24"))
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
CODE_LEN = 6

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_MB * 1024 * 1024
os.makedirs(DATA_DIR, exist_ok=True)


def safe_name(name):
    name = unicodedata.normalize("NFC", os.path.basename(name or "")).replace("\x00", "")
    name = re.sub(r'[\\/:*?"<>|\r\n\t]', "_", name).strip(" .")
    return name[:200] or "file"


def clean_code(code):
    code = (code or "").strip().upper()
    if len(code) != CODE_LEN or any(c not in CODE_CHARS for c in code):
        return None
    return code


def load(code):
    code = clean_code(code)
    if not code:
        return None
    try:
        with open(os.path.join(DATA_DIR, code, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return None
    if meta["expires"] < time.time():
        shutil.rmtree(os.path.join(DATA_DIR, code), ignore_errors=True)
        return None
    return meta


def sweep():
    now = time.time()
    for code in os.listdir(DATA_DIR):
        meta_path = os.path.join(DATA_DIR, code, "meta.json")
        try:
            with open(meta_path, encoding="utf-8") as f:
                if json.load(f)["expires"] >= now:
                    continue
        except (OSError, ValueError, KeyError):
            # half-written uploads: give them an hour before removing
            try:
                if now - os.path.getmtime(os.path.join(DATA_DIR, code)) < 3600:
                    continue
            except OSError:
                continue
        shutil.rmtree(os.path.join(DATA_DIR, code), ignore_errors=True)


def public(meta):
    return {
        "code": meta["code"],
        "files": [{"name": f["name"], "size": f["size"]} for f in meta["files"]],
        "expires": meta["expires"],
        "downloads": meta.get("downloads", 0),
    }


@app.get("/")
def index():
    return render_template("index.html", max_mb=MAX_MB, hours=EXPIRE_HOURS)


@app.get("/healthz")
def healthz():
    return "ok"


@app.post("/api/upload")
def upload():
    sweep()
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        return jsonify(error="Choose at least one file."), 400
    for _ in range(20):
        code = "".join(secrets.choice(CODE_CHARS) for _ in range(CODE_LEN))
        folder = os.path.join(DATA_DIR, code)
        try:
            os.makedirs(folder)
            break
        except FileExistsError:
            continue
    else:
        return jsonify(error="Try again."), 503
    saved, used = [], set()
    for i, f in enumerate(files):
        name = safe_name(f.filename)
        base, ext = os.path.splitext(name)
        n = 2
        while name.lower() in used:
            name = f"{base} ({n}){ext}"
            n += 1
        used.add(name.lower())
        stored = f"{i}.bin"
        path = os.path.join(folder, stored)
        f.save(path)
        saved.append({"name": name, "stored": stored, "size": os.path.getsize(path)})
    meta = {
        "code": code,
        "files": saved,
        "created": time.time(),
        "expires": time.time() + EXPIRE_HOURS * 3600,
        "downloads": 0,
        "owner": secrets.token_urlsafe(18),
    }
    tmp = os.path.join(folder, "meta.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    os.replace(tmp, os.path.join(folder, "meta.json"))
    body = public(meta)
    body["link"] = request.host_url.rstrip("/") + "/d/" + code
    body["owner"] = meta["owner"]  # only the sender gets this; it lets them delete
    return jsonify(body)


@app.get("/api/transfer/<code>")
def info(code):
    meta = load(code)
    if not meta:
        return jsonify(error="No transfer with that code, or it has expired."), 404
    return jsonify(public(meta))


@app.get("/d/<code>")
def receive_page(code):
    meta = load(code)
    return render_template("index.html", max_mb=MAX_MB, hours=EXPIRE_HOURS,
                           code=(meta["code"] if meta else (code or "").upper()[:CODE_LEN]),
                           missing=meta is None), (200 if meta else 404)


@app.get("/d/<code>/<int:index>")
def download(code, index):
    meta = load(code)
    if not meta or not 0 <= index < len(meta["files"]):
        abort(404)
    f = meta["files"][index]
    meta["downloads"] = meta.get("downloads", 0) + 1
    try:
        tmp = os.path.join(DATA_DIR, meta["code"], f"meta.{secrets.token_hex(4)}.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(meta, fh)
        os.replace(tmp, os.path.join(DATA_DIR, meta["code"], "meta.json"))
    except OSError:
        pass
    return send_from_directory(os.path.join(DATA_DIR, meta["code"]), f["stored"],
                               as_attachment=True, download_name=f["name"])


@app.get("/d/<code>/all.zip")
def download_all(code):
    meta = load(code)
    if not meta:
        abort(404)
    folder = os.path.join(DATA_DIR, meta["code"])
    target = os.path.join(folder, "all.zip")
    if not os.path.exists(target):
        tmp = os.path.join(folder, f"all.{secrets.token_hex(4)}.part")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
            for f in meta["files"]:
                z.write(os.path.join(folder, f["stored"]), f["name"])
        os.replace(tmp, target)
    return send_from_directory(folder, "all.zip", as_attachment=True,
                               download_name=f"deluxe-transfer-{meta['code']}.zip")


@app.delete("/api/transfer/<code>")
def delete(code):
    meta = load(code)
    if not meta:
        return jsonify(error="Not found."), 404
    if not secrets.compare_digest(request.headers.get("X-Owner", ""), meta.get("owner", "")):
        return jsonify(error="Only the sender can delete this transfer."), 403
    shutil.rmtree(os.path.join(DATA_DIR, meta["code"]), ignore_errors=True)
    return jsonify(ok=True)


@app.errorhandler(413)
def too_big(_):
    return jsonify(error=f"Too big. The limit is {MAX_MB} MB per transfer."), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
