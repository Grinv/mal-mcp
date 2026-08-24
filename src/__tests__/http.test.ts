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

test("surfaces an upstream's structured error message and report_url", async (t) => {
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

test("waits the exact Retry-After delay, not blind exponential backoff", async (t) => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    // 50ms — well under the ~500ms first-attempt blind backoff, so a passing
    // test proves the hint drove the wait instead of being silently ignored.
    return n === 1
      ? jsonResponse({}, { status: 429, headers: { "retry-after": "0.05" } })
      : jsonResponse({ ok: true });
  });
  installFetch(t, mock);
  const start = Date.now();
  const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("limited");
  const elapsed = Date.now() - start;
  assert.equal(res.ok, true);
  assert.ok(elapsed < 400, `expected the 50ms Retry-After hint to be honored, took ${elapsed}ms`);
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
      // HTTP dates only have whole-second precision, so Date.parse() can truncate up to ~999ms
      // off the intended offset (whenever Date.now() falls near a second boundary) — the offset
      // must survive that worst case and still land clearly above the assertion threshold below
      // (and clearly distinguishable from the ~500ms blind-backoff fallback).
      const retryAt = new Date(Date.now() + 3000).toUTCString();
      return jsonResponse({}, { status: 429, headers: { "retry-after": retryAt } });
    }
    return jsonResponse({ ok: true });
  });
  installFetch(t, mock);
  const start = Date.now();
  const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("limited");
  const elapsed = Date.now() - start;
  assert.equal(res.ok, true);
  assert.equal(mock.calls.length, 2);
  // Comfortably above the ~500ms blind-backoff fallback: proves the parsed date, not a fallback,
  // drove the wait.
  assert.ok(elapsed >= 1200, `expected the HTTP-date Retry-After to be honored, took ${elapsed}ms`);
});

test("detectEmbeddedError converts a 200 response carrying an upstream's own error body into a retryable ApiError", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({ status: 500, type: "UpstreamException", message: "timed out" }, { status: 200 }),
  );
  installFetch(t, mock);
  const c = new HttpClient({
    baseUrl: "https://example.test/api",
    logger: silentLogger(),
    retries: 0,
    detectEmbeddedError: (body) => {
      const rec = body as Record<string, unknown>;
      return typeof rec.status === "number" && rec.status >= 400
        ? { status: rec.status, message: String(rec.message) }
        : undefined;
    },
  });
  await assert.rejects(
    () => c.getJson("thing"),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "server_error" &&
      err.retryable === true &&
      /timed out/.test(err.message),
  );
});

test("without detectEmbeddedError configured, a 200 body is returned as-is even if it looks like an error", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({ status: 500, type: "UpstreamException", message: "timed out" }, { status: 200 }),
  );
  installFetch(t, mock);
  const res = await client().getJson<{ status: number }>("thing");
  assert.equal(res.status, 500);
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

test("times out while the response body is still streaming", { timeout: 5000 }, async (t) => {
  // fetch() settles as soon as the headers land, so a body that never finishes used to escape the
  // timeout entirely: the timer had already been cleared and the call hung forever with no error.
  const mock = mockFetch((_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  installFetch(t, mock);
  await assert.rejects(
    () => client({ retries: 0, timeoutMs: 30 }).getJson("stalled-body"),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "timeout");
      assert.equal(err.retryable, true);
      assert.equal(err.message, "Request timed out after 30ms");
      return true;
    },
  );
});

test("a caller abort during the body read stays non-retryable", { timeout: 5000 }, async (t) => {
  const controller = new AbortController();
  const mock = mockFetch((_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        init?.signal?.addEventListener("abort", () =>
          c.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    setTimeout(() => controller.abort(), 10);
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  installFetch(t, mock);
  await assert.rejects(
    () =>
      client({ retries: 0, timeoutMs: 5000 }).getJson("stalled-body", {
        signal: controller.signal,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "network");
      assert.equal(err.retryable, false);
      assert.equal(err.message, "Request aborted by caller");
      return true;
    },
  );
  assert.equal(mock.calls.length, 1);
});
