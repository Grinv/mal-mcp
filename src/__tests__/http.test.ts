import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../lib/http.js";
import { ApiError } from "../lib/errors.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function client(extra: { retries?: number; timeoutMs?: number } = {}): HttpClient {
  return new HttpClient({ baseUrl: "https://example.test/api", logger: silentLogger(), ...extra });
}

test("getJson parses the body and sends a User-Agent + query params", async (t) => {
  const mock = mockFetch((_url) => jsonResponse({ ok: true }));
  installFetch(t, mock);
  const res = await client().getJson<{ ok: boolean }>("thing", {
    query: { q: "frieren", limit: 5, skip: undefined },
  });
  assert.equal(res.ok, true);
  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0]!;
  assert.match(call.url, /q=frieren/);
  assert.match(call.url, /limit=5/);
  assert.ok(!call.url.includes("skip")); // undefined dropped
  const headers = call.init?.headers as Record<string, string>;
  assert.match(headers["User-Agent"] ?? "", /^mal-mcp\//);
});

test("does not retry a 404 and maps it to not_found", async (t) => {
  const mock = mockFetch(() => jsonResponse({ error: "nope" }, { status: 404 }));
  installFetch(t, mock);
  await assert.rejects(
    () => client({ retries: 2 }).getJson("missing"),
    (err: unknown) => err instanceof ApiError && err.code === "not_found",
  );
  assert.equal(mock.calls.length, 1);
});

test("surfaces Jikan's structured error message and report_url", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse(
      { status: 500, type: "InternalException", message: "boom", report_url: "https://gh/issue" },
      { status: 500 },
    ),
  );
  installFetch(t, mock);
  await assert.rejects(
    () => client({ retries: 0 }).getJson("oops"),
    (err: unknown) =>
      err instanceof ApiError &&
      /boom/.test(err.message) &&
      /report: https:\/\/gh/.test(err.message),
  );
});

test("retries a 5xx then succeeds", async (t) => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    return n === 1 ? jsonResponse({ e: 1 }, { status: 500 }) : jsonResponse({ ok: true });
  });
  installFetch(t, mock);
  const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("flaky");
  assert.equal(res.ok, true);
  assert.equal(mock.calls.length, 2);
});

test("honors Retry-After on 429", async (t) => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    return n === 1
      ? jsonResponse({}, { status: 429, headers: { "retry-after": "0" } })
      : jsonResponse({ ok: true });
  });
  installFetch(t, mock);
  const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("limited");
  assert.equal(res.ok, true);
  assert.equal(mock.calls.length, 2);
});

test("throws ApiError when a 200 response body isn't valid JSON", async (t) => {
  const mock = mockFetch(
    () => new Response("not-json{", { status: 200, headers: { "content-type": "text/plain" } }),
  );
  installFetch(t, mock);
  await assert.rejects(
    () => client().getJson("thing"),
    (err: unknown) =>
      err instanceof ApiError && err.code === "unknown" && /invalid JSON/i.test(err.message),
  );
});

test("returns undefined for a 204 No Content response", async (t) => {
  const mock = mockFetch(() => new Response(null, { status: 204 }));
  installFetch(t, mock);
  const res = await client().getJson("thing");
  assert.equal(res, undefined);
});

test("falls back to the raw body when an error response isn't JSON", async (t) => {
  const mock = mockFetch(() => new Response("<html>Service Unavailable</html>", { status: 503 }));
  installFetch(t, mock);
  await assert.rejects(
    () => client({ retries: 0 }).getJson("oops"),
    (err: unknown) => err instanceof ApiError && /Service Unavailable/.test(err.message),
  );
});

test("honors Retry-After given as an HTTP date rather than seconds", async (t) => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    if (n === 1) {
      const retryAt = new Date(Date.now() + 10).toUTCString();
      return jsonResponse({}, { status: 429, headers: { "retry-after": retryAt } });
    }
    return jsonResponse({ ok: true });
  });
  installFetch(t, mock);
  const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("limited");
  assert.equal(res.ok, true);
  assert.equal(mock.calls.length, 2);
});

test("aborts on timeout and maps to a timeout error", async (t) => {
  const mock = mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  installFetch(t, mock);
  await assert.rejects(
    () => client({ retries: 0, timeoutMs: 30 }).getJson("slow"),
    (err: unknown) => err instanceof ApiError && err.code === "timeout",
  );
});

test("a caller abort is propagated as a non-retryable error (no retries)", async (t) => {
  const mock = mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  installFetch(t, mock);
  const controller = new AbortController();
  const p = client({ retries: 3 }).getJson("x", { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(
    () => p,
    (err: unknown) => err instanceof ApiError && err.code === "network" && err.retryable === false,
  );
  assert.equal(mock.calls.length, 1); // not retried
});
