// Throwaway spike server: logs every hook request, answers PermissionRequest after a delay.
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 37419);
const DELAY_MS = Number(process.env.DELAY_MS ?? 10000);
const DECISION = process.env.DECISION ?? "allow"; // allow | deny | none | setMode
const LOG = process.env.LOG ?? "spike/requests.log";

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const entry = { t: new Date().toISOString(), method: req.method, url: req.url, headers: req.headers, body: safeJson(body) };
    fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
    console.log(entry.t, req.method, req.url);
    if (!req.url.endsWith("/PermissionRequest")) return send(res, {});
    let closed = false;
    res.on("close", () => { if (!res.writableEnded) { closed = true; log("client closed before answer", req.url); } });
    setTimeout(() => {
      if (closed) return;
      if (DECISION === "none") return send(res, {});
      const decision = { behavior: DECISION === "deny" ? "deny" : "allow" };
      if (DECISION === "deny") decision.message = "Denied via spike";
      if (DECISION === "setMode") decision.updatedPermissions = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
      send(res, { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
      log("answered", DECISION);
    }, DELAY_MS);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`spike server on ${PORT}, decision=${DECISION}, delay=${DELAY_MS}`));

function send(res, obj) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }
function log(...a) { const l = { t: new Date().toISOString(), note: a.join(" ") }; fs.appendFileSync(LOG, JSON.stringify(l) + "\n"); console.log(...a); }
