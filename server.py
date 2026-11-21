#!/usr/bin/env python3
"""
StrafeLab server: serves the game, runs WebSocket parties and keeps a persistent
leaderboard. Pure standard library (Python 3.8+), no installs needed.

    python server.py                 # http://localhost:8787
    python server.py --port 9000     # custom port
    python server.py --host 127.0.0.1  # local only (default listens on all interfaces for LAN play)
"""
import argparse
import asyncio
import base64
import hashlib
import json
import logging
import math
import os
import re
import secrets
import socket
import struct
import time
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA_DIR = os.path.join(ROOT, "data")
LB_FILE = os.path.join(DATA_DIR, "leaderboard.json")
META_FILE = os.path.join(PUBLIC, "data", "scenarios.json")

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MSG = 64 * 1024
MAX_BUFFERED = 1024 * 1024
MAX_PARTY = 8
LB_KEEP = 100
COUNTDOWN = 5
RUN_GRACE = 25
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
COLORS = ["#2de2c2", "#ffb347", "#7aa2ff", "#ff6fae", "#b9f26b", "#c792ff", "#ffd84d", "#5ad1ff"]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}

log = logging.getLogger("strafelab")

with open(META_FILE, encoding="utf-8") as _f:
    META = json.load(_f)
SCENARIOS = {s["id"]: s for s in META["scenarios"]}
DIFFS = set(META["difficulties"])

NAME_RE = re.compile(r"[^A-Za-z0-9 _\-.]")
CID_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


def clean_name(value):
    name = NAME_RE.sub("", str(value or ""))[:16].strip()
    return name or "Player"


def clean_text(value, limit):
    text = "".join(ch for ch in str(value or "") if ch >= " " and ch != "\x7f")
    return text[:limit].strip()


def clean_stats(stats):
    out = {}
    if isinstance(stats, dict):
        for k, v in list(stats.items())[:16]:
            out[clean_text(k, 32)] = clean_text(v, 40)
    return out


def now_ms():
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- leaderboard
class Leaderboard:
    def __init__(self, path):
        self.path = path
        self.data = {}
        self._save_handle = None
        try:
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)
        except FileNotFoundError:
            pass
        except Exception as exc:  # corrupted file: keep a copy, start fresh
            log.warning("leaderboard unreadable (%s), starting fresh", exc)
            try:
                os.replace(path, path + ".corrupt")
            except OSError:
                pass

    @staticmethod
    def key(sid, diff):
        return f"{sid}:{diff}"

    @staticmethod
    def sort_key(sid):
        asc = SCENARIOS[sid]["order"] == "asc"
        return lambda e: ((e["score"] if asc else -e["score"]), e["ts"])

    def better(self, sid, a, b):
        return a < b if SCENARIOS[sid]["order"] == "asc" else a > b

    def submit(self, cid, name, sid, diff, score, display, stats):
        entries = self.data.setdefault(self.key(sid, diff), [])
        existing = next((e for e in entries if e["cid"] == cid), None)
        improved = False
        entry = {"cid": cid, "name": name, "score": score, "display": display, "stats": stats, "ts": now_ms()}
        if existing is None:
            entries.append(entry)
            improved = True
        elif self.better(sid, score, existing["score"]):
            existing.update(entry)
            improved = True
        elif existing["name"] != name:
            existing["name"] = name
            improved = True  # persist the rename
        entries.sort(key=self.sort_key(sid))
        del entries[LB_KEEP:]
        rank = next((i + 1 for i, e in enumerate(entries) if e["cid"] == cid), None)
        if improved:
            self.schedule_save()
        return rank, improved

    def top(self, sid, diff, limit=50, cids=None, me=None):
        entries = self.data.get(self.key(sid, diff), [])
        out = []
        for i, e in enumerate(entries):
            if cids is not None and e["cid"] not in cids:
                continue
            out.append({
                "rank": i + 1,
                "name": e["name"],
                "score": e["score"],
                "display": e.get("display", ""),
                "stats": e.get("stats", {}),
                "ts": e["ts"],
                "me": e["cid"] == me,
            })
            if len(out) >= limit:
                break
        return out

    def schedule_save(self):
        if self._save_handle is None:
            self._save_handle = asyncio.get_running_loop().call_later(2.0, self.save)

    def save(self):
        self._save_handle = None
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, separators=(",", ":"))
        os.replace(tmp, self.path)


# --------------------------------------------------------------------------- websocket
class WSClosed(Exception):
    pass


class WebSocket:
    """Minimal RFC 6455 server-side connection (text frames, ping/pong, close)."""

    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False

    @staticmethod
    def accept_key(key):
        digest = hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
        return base64.b64encode(digest).decode("ascii")

    @staticmethod
    def _unmask(data, mask):
        n = len(data)
        if not n:
            return b""
        full = (mask * (n // 4 + 1))[:n]
        return (int.from_bytes(data, "big") ^ int.from_bytes(full, "big")).to_bytes(n, "big")

    async def recv(self):
        """Return the next text message, or raise WSClosed."""
        parts = []
        size = 0
        while True:
            try:
                h = await self.reader.readexactly(2)
                fin, opcode = h[0] & 0x80, h[0] & 0x0F
                masked, length = h[1] & 0x80, h[1] & 0x7F
                if length == 126:
                    length = struct.unpack("!H", await self.reader.readexactly(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", await self.reader.readexactly(8))[0]
                if not masked:
                    raise WSClosed("unmasked frame")
                if length > MAX_MSG or size + length > MAX_MSG:
                    raise WSClosed("message too large")
                mask = await self.reader.readexactly(4)
                payload = self._unmask(await self.reader.readexactly(length), mask)
            except (asyncio.IncompleteReadError, ConnectionError) as exc:
                raise WSClosed(str(exc))

            if opcode == 0x8:  # close
                self._frame(0x8, payload[:2])
                raise WSClosed("client closed")
            if opcode == 0x9:  # ping
                self._frame(0xA, payload)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode in (0x1, 0x2, 0x0):
                parts.append(payload)
                size += len(payload)
                if fin:
                    data = b"".join(parts)
                    if opcode == 0x2:
                        parts, size = [], 0
                        continue  # ignore binary
                    return data.decode("utf-8", errors="replace")
                continue
            raise WSClosed("bad opcode")

    def _frame(self, opcode, data):
        if self.closed:
            return
        n = len(data)
        if n < 126:
            head = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        try:
            transport = self.writer.transport
            if transport.is_closing() or transport.get_write_buffer_size() > MAX_BUFFERED:
                self.closed = True
                transport.close()
                return
            self.writer.write(head + data)
        except Exception:
            self.closed = True

    def send(self, obj):
        self._frame(0x1, json.dumps(obj, separators=(",", ":")).encode("utf-8"))

    def close(self):
        if not self.closed:
            self._frame(0x8, struct.pack("!H", 1000))
            self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- game state
class Client:
    _next = 1

    def __init__(self, ws):
        self.ws = ws
        self.id = f"u{Client._next}"
        Client._next += 1
        self.cid = None
        self.name = "Player"
        self.party = None
        self.ready = False
        self.color = COLORS[0]
        self.last_pos = 0.0
        self.last_submit = 0.0
        self.last_chat = 0.0

    def send(self, obj):
        self.ws.send(obj)


class Party:
    def __init__(self, code, leader):
        self.code = code
        self.leader = leader
        self.members = []
        self.scenario = "counter-strafe"
        self.difficulty = "medium"
        self.state = "lobby"
        self.run = None
        self.timeout = None

    def public(self):
        run = None
        if self.run:
            run = {"id": self.run["id"], "scenario": self.run["scenario"], "difficulty": self.run["difficulty"]}
        return {
            "code": self.code,
            "leader": self.leader.id,
            "state": self.state,
            "scenario": self.scenario,
            "difficulty": self.difficulty,
            "members": [
                {
                    "id": m.id,
                    "name": m.name,
                    "ready": m.ready,
                    "color": m.color,
                    "inRun": bool(self.run and m.id in self.run["expected"]),
                }
                for m in self.members
            ],
            "run": run,
        }

    def broadcast(self, obj, exclude=None):
        for m in self.members:
            if m is not exclude:
                m.send(obj)


class Server:
    def __init__(self):
        self.clients = set()
        self.parties = {}
        self.lb = Leaderboard(LB_FILE)

    # ---- helpers
    def new_code(self):
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
            if code not in self.parties:
                return code

    def party_state(self, party):
        party.broadcast({"t": "party", "party": party.public()})

    def system_chat(self, party, text):
        party.broadcast({"t": "chat", "system": True, "text": text, "ts": now_ms()})

    def leave_party(self, client, notify=True):
        party = client.party
        if not party:
            return
        client.party = None
        client.ready = False
        if client in party.members:
            party.members.remove(client)
        if notify:
            client.send({"t": "party", "party": None})
        if not party.members:
            if party.timeout:
                party.timeout.cancel()
            self.parties.pop(party.code, None)
            return
        if party.leader is client:
            party.leader = party.members[0]
            self.system_chat(party, f"{party.leader.name} is now the party leader")
        self.system_chat(party, f"{client.name} left the party")
        if party.run and client.id in party.run["expected"]:
            party.run["results"].setdefault(client.id, {"status": "dnf", "name": client.name})
            self.check_run_complete(party)
        self.party_state(party)

    def join_party(self, client, party):
        if client.party is party:
            return
        self.leave_party(client)
        if len(party.members) >= MAX_PARTY:
            client.send({"t": "error", "text": "That party is full (8 players max)."})
            return
        used = {m.color for m in party.members}
        client.color = next((c for c in COLORS if c not in used), COLORS[0])
        client.party = party
        client.ready = False
        party.members.append(client)
        self.system_chat(party, f"{client.name} joined the party")
        self.party_state(party)

    # ---- runs
    def start_run(self, party):
        meta = SCENARIOS[party.scenario]
        length = meta.get("duration") or meta.get("timeLimit") or 120
        run_id = secrets.token_hex(4)
        party.run = {
            "id": run_id,
            "scenario": party.scenario,
            "difficulty": party.difficulty,
            "seed": secrets.randbits(31),
            "expected": {m.id for m in party.members},
            "names": {m.id: m.name for m in party.members},
            "results": {},
        }
        party.state = "running"
        for m in party.members:
            m.ready = False
        party.broadcast({
            "t": "run_start",
            "runId": run_id,
            "scenario": party.scenario,
            "difficulty": party.difficulty,
            "seed": party.run["seed"],
            "countdown": COUNTDOWN,
        })
        self.party_state(party)
        loop = asyncio.get_running_loop()
        if party.timeout:
            party.timeout.cancel()
        party.timeout = loop.call_later(COUNTDOWN + length + RUN_GRACE, self.finish_run, party, run_id)

    def run_results_msg(self, party, final):
        run = party.run
        asc = SCENARIOS[run["scenario"]]["order"] == "asc"
        rows = []
        for mid in run["expected"]:
            res = run["results"].get(mid)
            name = run["names"].get(mid, "?")
            member = next((m for m in party.members if m.id == mid), None)
            if member:
                name = member.name
            if res is None:
                rows.append({"id": mid, "name": name, "status": "dnf" if final else "playing"})
            elif res.get("status") == "dnf":
                rows.append({"id": mid, "name": name, "status": "dnf"})
            else:
                rows.append({"id": mid, "name": name, "status": "done", "score": res["score"],
                             "display": res["display"], "stats": res.get("stats", {})})
        done = [r for r in rows if r["status"] == "done"]
        done.sort(key=lambda r: r["score"], reverse=not asc)
        rest = [r for r in rows if r["status"] != "done"]
        return {"t": "run_results", "runId": run["id"], "scenario": run["scenario"],
                "difficulty": run["difficulty"], "final": final, "results": done + rest}

    def check_run_complete(self, party):
        run = party.run
        if run and all(mid in run["results"] for mid in run["expected"]):
            self.finish_run(party, run["id"])
        elif run:
            party.broadcast(self.run_results_msg(party, False))

    def finish_run(self, party, run_id):
        if not party.run or party.run["id"] != run_id:
            return
        if party.timeout:
            party.timeout.cancel()
            party.timeout = None
        party.broadcast(self.run_results_msg(party, True))
        party.run = None
        party.state = "lobby"
        if party.code in self.parties:
            self.party_state(party)

    # ---- message dispatch
    def handle(self, c, msg):
        t = msg.get("t")
        if t == "hello":
            cid = str(msg.get("cid") or "")
            c.cid = cid if CID_RE.match(cid) else secrets.token_hex(12)
            c.name = clean_name(msg.get("name"))
            c.send({"t": "welcome", "id": c.id, "online": len(self.clients)})
        elif t == "ping":
            c.send({"t": "pong", "ts": msg.get("ts")})
        elif t == "set_name":
            c.name = clean_name(msg.get("name"))
            if c.party:
                self.party_state(c.party)
        elif t == "party_create":
            self.leave_party(c)
            party = Party(self.new_code(), c)
            self.parties[party.code] = party
            self.join_party(c, party)
        elif t == "party_join":
            code = str(msg.get("code") or "").strip().upper()
            party = self.parties.get(code)
            if not party:
                c.send({"t": "error", "text": f"No party with code {code or '?'}."})
            else:
                self.join_party(c, party)
        elif t == "party_leave":
            self.leave_party(c)
        elif t == "party_kick":
            p = c.party
            if p and p.leader is c:
                target = next((m for m in p.members if m.id == msg.get("id") and m is not c), None)
                if target:
                    self.leave_party(target)
                    target.send({"t": "error", "text": "You were removed from the party."})
        elif t == "party_config":
            p = c.party
            if p and p.leader is c and p.state == "lobby":
                sid, diff = msg.get("scenario"), msg.get("difficulty")
                if sid in SCENARIOS:
                    p.scenario = sid
                if diff in DIFFS:
                    p.difficulty = diff
                for m in p.members:
                    m.ready = False
                self.party_state(p)
        elif t == "party_ready":
            p = c.party
            if p and p.state == "lobby":
                c.ready = bool(msg.get("ready"))
                self.party_state(p)
        elif t == "party_start":
            p = c.party
            if p and p.leader is c and p.state == "lobby":
                self.start_run(p)
        elif t == "chat":
            p = c.party
            text = clean_text(msg.get("text"), 200)
            now = time.monotonic()
            if p and text and now - c.last_chat > 0.4:
                c.last_chat = now
                p.broadcast({"t": "chat", "id": c.id, "name": c.name, "color": c.color, "text": text, "ts": now_ms()})
        elif t == "pos":
            p = c.party
            now = time.monotonic()
            if p and p.run and now - c.last_pos > 0.03:
                c.last_pos = now
                pos = msg.get("p")
                if isinstance(pos, list) and len(pos) <= 6 and all(isinstance(v, (int, float)) for v in pos):
                    p.broadcast({"t": "pos", "id": c.id, "p": pos}, exclude=c)
        elif t == "live":
            p = c.party
            if p and p.run and msg.get("runId") == p.run["id"]:
                score = msg.get("score")
                if isinstance(score, (int, float)) and math.isfinite(score):
                    p.broadcast({"t": "live", "id": c.id, "score": score,
                                 "display": clean_text(msg.get("display"), 24),
                                 "progress": clean_text(msg.get("progress"), 24)})
        elif t == "run_result":
            p = c.party
            if p and p.run and msg.get("runId") == p.run["id"] and c.id in p.run["expected"]:
                if msg.get("dnf"):
                    p.run["results"][c.id] = {"status": "dnf"}
                else:
                    score = msg.get("score")
                    if isinstance(score, (int, float)) and math.isfinite(score):
                        p.run["results"][c.id] = {"status": "done", "score": score,
                                                  "display": clean_text(msg.get("display"), 24),
                                                  "stats": clean_stats(msg.get("stats"))}
                self.check_run_complete(p)
        elif t == "score_submit":
            self.submit_score(c, msg)
        elif t == "lb_get":
            sid, diff = msg.get("scenario"), msg.get("difficulty")
            if sid in SCENARIOS and diff in DIFFS:
                cids = None
                if msg.get("filter") == "party" and c.party:
                    cids = {m.cid for m in c.party.members}
                limit = max(1, min(100, int(msg.get("limit") or 50)))
                c.send({"t": "lb", "scenario": sid, "difficulty": diff, "filter": msg.get("filter", "global"),
                        "entries": self.lb.top(sid, diff, limit, cids, c.cid)})

    def submit_score(self, c, msg):
        sid, diff = msg.get("scenario"), msg.get("difficulty")
        score = msg.get("score")
        if sid not in SCENARIOS or diff not in DIFFS or not c.cid:
            return
        if not isinstance(score, (int, float)) or not math.isfinite(score):
            return
        meta = SCENARIOS[sid]
        if score < meta.get("minScore", 0) or score > meta.get("maxScore", 1e9):
            c.send({"t": "lb_submitted", "scenario": sid, "difficulty": diff, "rejected": True})
            return
        now = time.monotonic()
        if now - c.last_submit < 2.0:
            return
        c.last_submit = now
        score = round(float(score), 2)
        rank, improved = self.lb.submit(c.cid, c.name, sid, diff, score,
                                        clean_text(msg.get("display"), 24), clean_stats(msg.get("stats")))
        c.send({"t": "lb_submitted", "scenario": sid, "difficulty": diff, "rank": rank, "improved": improved,
                "entries": self.lb.top(sid, diff, 10, None, c.cid)})

    # ---- connections
    async def ws_session(self, ws):
        c = Client(ws)
        self.clients.add(c)
        try:
            while True:
                raw = await ws.recv()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    try:
                        self.handle(c, msg)
                    except Exception:
                        log.exception("error handling %s", msg.get("t"))
        except WSClosed:
            pass
        finally:
            self.clients.discard(c)
            self.leave_party(c, notify=False)
            ws.close()

    async def http(self, reader, writer):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=15)
        except Exception:
            writer.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        try:
            method, target, _ = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        url = urllib.parse.urlsplit(target)

        if url.path == "/ws" and headers.get("upgrade", "").lower() == "websocket" and "sec-websocket-key" in headers:
            accept = WebSocket.accept_key(headers["sec-websocket-key"])
            writer.write((
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode("ascii"))
            await self.ws_session(WebSocket(reader, writer))
            return

        try:
            if method not in ("GET", "HEAD"):
                self.respond(writer, 405, b"Method not allowed", "text/plain")
            elif url.path == "/api/leaderboard":
                self.api_leaderboard(writer, urllib.parse.parse_qs(url.query))
            elif url.path == "/api/health":
                body = json.dumps({"ok": True, "online": len(self.clients), "parties": len(self.parties)}).encode()
                self.respond(writer, 200, body, MIME[".json"])
            else:
                self.static(writer, url.path, method == "HEAD")
            await writer.drain()
        except Exception:
            log.exception("http error")
        finally:
            writer.close()

    def api_leaderboard(self, writer, qs):
        sid = (qs.get("scenario") or [""])[0]
        diff = (qs.get("difficulty") or ["medium"])[0]
        if sid not in SCENARIOS or diff not in DIFFS:
            self.respond(writer, 400, b'{"error":"unknown scenario or difficulty"}', MIME[".json"])
            return
        try:
            limit = max(1, min(100, int((qs.get("limit") or ["50"])[0])))
        except ValueError:
            limit = 50
        body = json.dumps({"scenario": sid, "difficulty": diff, "entries": self.lb.top(sid, diff, limit)}).encode()
        self.respond(writer, 200, body, MIME[".json"])

    def static(self, writer, path, head_only):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(PUBLIC, rel))
        if not (full == PUBLIC or full.startswith(PUBLIC + os.sep)):
            self.respond(writer, 403, b"Forbidden", "text/plain")
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            self.respond(writer, 404, b"Not found", "text/plain")
            return
        ctype = MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.respond(writer, 200, body, ctype, head_only)

    @staticmethod
    def respond(writer, status, body, ctype, head_only=False):
        reason = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"}.get(status, "OK")
        writer.write((
            f"HTTP/1.1 {status} {reason}\r\n"
            f"Content-Type: {ctype}\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Cache-Control: no-cache\r\n"
            "X-Content-Type-Options: nosniff\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii"))
        if not head_only:
            writer.write(body)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


async def main(host, port):
    server = Server()
    srv = await asyncio.start_server(server.http, host, port)
    print(f"StrafeLab running at http://localhost:{port}")
    ip = lan_ip()
    if host in ("0.0.0.0", "") and ip:
        print(f"Friends on your network can join at http://{ip}:{port}")
    async with srv:
        try:
            await srv.serve_forever()
        finally:
            if server.lb._save_handle:
                server.lb._save_handle.cancel()
                server.lb.save()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="StrafeLab server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(main(args.host, args.port))
    except KeyboardInterrupt:
        pass
