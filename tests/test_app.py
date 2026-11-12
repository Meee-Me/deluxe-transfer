import io, os, sys, tempfile, time, zipfile, json, unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["MAX_MB"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as mod  # noqa: E402


class TransferTest(unittest.TestCase):
    def setUp(self):
        self.c = mod.app.test_client()

    def send(self, *files):
        data = {"files": [(io.BytesIO(b), n) for n, b in files]}
        return self.c.post("/api/upload", data=data, content_type="multipart/form-data")

    def test_round_trip(self):
        r = self.send(("hello.txt", b"hi there"), ("hello.txt", b"second"), ("../../evil.sh", b"x"))
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        code = body["code"]
        self.assertEqual(len(code), 6)
        self.assertTrue(body["link"].endswith("/d/" + code))
        names = [f["name"] for f in body["files"]]
        self.assertEqual(names, ["hello.txt", "hello (2).txt", "evil.sh"])
        info = self.c.get(f"/api/transfer/{code.lower()}").get_json()
        self.assertNotIn("owner", info)
        d = self.c.get(f"/d/{code}/0")
        self.assertEqual(d.data, b"hi there")
        self.assertIn("hello.txt", d.headers["Content-Disposition"])
        d.close()
        z = self.c.get(f"/d/{code}/all.zip")
        with zipfile.ZipFile(io.BytesIO(z.data)) as zf:
            self.assertEqual(zf.read("hello (2).txt"), b"second")
        z.close()
        self.assertEqual(self.c.get(f"/d/{code}").status_code, 200)
        self.assertEqual(self.c.get(f"/d/{code}/9").status_code, 404)
        self.assertEqual(self.c.delete(f"/api/transfer/{code}").status_code, 403)
        self.assertEqual(self.c.delete(f"/api/transfer/{code}", headers={"X-Owner": body["owner"]}).status_code, 200)
        self.assertEqual(self.c.get(f"/api/transfer/{code}").status_code, 404)

    def test_bad_inputs(self):
        self.assertEqual(self.c.post("/api/upload").status_code, 400)
        self.assertEqual(self.send(("big.bin", b"0" * (2 * 1024 * 1024))).status_code, 413)
        self.assertEqual(self.c.get("/api/transfer/../../x").status_code, 404)
        self.assertEqual(self.c.get("/d/NOPE00").status_code, 404)

    def test_expiry(self):
        code = self.send(("a.txt", b"a")).get_json()["code"]
        p = os.path.join(mod.DATA_DIR, code, "meta.json")
        meta = json.load(open(p)); meta["expires"] = time.time() - 1; json.dump(meta, open(p, "w"))
        self.assertEqual(self.c.get(f"/api/transfer/{code}").status_code, 404)
        self.assertFalse(os.path.exists(os.path.join(mod.DATA_DIR, code)))


if __name__ == "__main__":
    unittest.main()
