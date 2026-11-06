#!/usr/bin/env node
// Does a front door address carry what phase 1 needs? Reads and writes only what you point it at, with made-up values. Node 22 or later.
// Never run it at a live service: docs/build/ADDRESSES-MIGRATION.md.
//
//   node infra/addresses/proof.mjs echo  https://<cloudfront address>   an echo origin: Authorization, query strings, POST, no cache
//   node infra/addresses/proof.mjs files https://<cloudfront address> <path>   files: cached, ?v= in the key, ranges, CORS
//   node infra/addresses/proof.mjs ws    wss://<cloudfront address>/<path> [seconds]   the socket opens, stays open and carries traffic
const [mode, base, arg] = process.argv.slice(2);
const TOKEN = "Bearer not-a-real-token";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed += 1;
}

const header = (body, name) => {
  const found = Object.entries(body.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return found?.[1];
};

async function echo(url) {
  const first = await fetch(`${url}/anything/p?a=1&token=abc`, { headers: { Authorization: TOKEN, "X-Edible-Family": "test" } });
  const body = await first.json();
  check("GET reaches the origin", first.ok, `status ${first.status}`);
  check("Authorization reaches the origin on a GET", header(body, "Authorization") === TOKEN);
  check("other headers reach the origin", header(body, "X-Edible-Family") === "test");
  check("the query string reaches the origin", body.args?.token === "abc");

  const posted = await fetch(`${url}/anything/p`, {
    method: "POST",
    headers: { Authorization: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "there" }),
  });
  const postBody = await posted.json();
  check("POST reaches the origin", posted.ok && postBody.method === "POST", `status ${posted.status}`);
  check("its body arrives", postBody.json?.hello === "there");
  check("Authorization reaches the origin on a POST", header(postBody, "Authorization") === TOKEN);

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const res = await fetch(`${url}/anything/p`, { method, headers: { Authorization: TOKEN } });
    check(`${method} reaches the origin`, res.ok, `status ${res.status}`);
  }

  await fetch(`${url}/anything/nocache`);
  const again = await fetch(`${url}/anything/nocache`);
  const cache = again.headers.get("x-cache") ?? "";
  check("a repeated GET isn't served from the cache", /miss|disabled/i.test(cache) && !/hit/i.test(cache), cache);
}

async function files(url, path) {
  const u = `${url}${path}`;
  await fetch(u);
  const second = await fetch(u, { headers: { Origin: "https://example.com" } });
  check("a file is served", second.ok, `status ${second.status}`);
  check("a second read comes from the cache", /hit/i.test(second.headers.get("x-cache") ?? ""), second.headers.get("x-cache") ?? "");
  check("browsers may read it", second.headers.get("access-control-allow-origin") === "*");
  const stamp = Date.now();
  const busted = await fetch(`${u}?v=${stamp}`);
  check("?v= is a new cache entry", /miss/i.test(busted.headers.get("x-cache") ?? ""), busted.headers.get("x-cache") ?? "");
  const other = await fetch(`${u}?other=${stamp}`);
  check("any other query string isn't", /hit/i.test(other.headers.get("x-cache") ?? ""), other.headers.get("x-cache") ?? "");
  const part = await fetch(u, { headers: { Range: "bytes=0-99" } });
  check("a range read returns part of it", part.status === 206, `status ${part.status}`);
}

function ws(url, seconds) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new WebSocket(url);
    let opened = false;
    let received = 0;
    const done = setTimeout(() => {
      check("it stayed open", socket.readyState === WebSocket.OPEN, `${seconds} s`);
      check("frames arrive", received > 0, `${received}`);
      socket.close();
      resolve();
    }, seconds * 1000);
    socket.addEventListener("open", () => {
      opened = true;
      check("the socket opens", true, `${Date.now() - started} ms`);
      socket.send("proof");
    });
    socket.addEventListener("message", () => {
      received += 1;
    });
    socket.addEventListener("close", (event) => {
      if (!opened || Date.now() - started < seconds * 1000) {
        clearTimeout(done);
        check("it stayed open", false, `closed after ${Math.round((Date.now() - started) / 1000)} s, code ${event.code}`);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      if (!opened) check("the socket opens", false);
    });
  });
}

const url = (base ?? "").replace(/\/+$/, "");
if (mode === "echo" && url) await echo(url);
else if (mode === "files" && url && arg) await files(url, arg);
else if (mode === "ws" && url) await ws(url, Number(arg ?? 300));
else {
  console.error("usage: proof.mjs echo <url> | files <url> <path> | ws <url> [seconds]");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
