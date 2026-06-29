import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpClient } from "../lib/http.js";
import { ApiError } from "../lib/errors.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function client(extra: { retries?: number; timeoutMs?: number } = {}): HttpClient {
  return new HttpClient({ baseUrl: "https://example.test/api", logger: silentLogger(), ...extra });
}

test("getJson parses the body and sends a User-Agent + query params", async () => {
  const mock = mockFetch((_url) => jsonResponse({ ok: true }));
  const restore = installFetch(mock);
  try {
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
  } finally {
    restore();
  }
});

test("does not retry a 404 and maps it to not_found", async () => {
  const mock = mockFetch(() => jsonResponse({ error: "nope" }, { status: 404 }));
  const restore = installFetch(mock);
  try {
    await assert.rejects(
      () => client({ retries: 2 }).getJson("missing"),
      (err: unknown) => err instanceof ApiError && err.code === "not_found",
    );
    assert.equal(mock.calls.length, 1);
  } finally {
    restore();
  }
});

test("surfaces Jikan's structured error message and report_url", async () => {
  const mock = mockFetch(() =>
    jsonResponse(
      { status: 500, type: "InternalException", message: "boom", report_url: "https://gh/issue" },
      { status: 500 },
    ),
  );
  const restore = installFetch(mock);
  try {
    await assert.rejects(
      () => client({ retries: 0 }).getJson("oops"),
      (err: unknown) =>
        err instanceof ApiError &&
        /boom/.test(err.message) &&
        /report: https:\/\/gh/.test(err.message),
    );
  } finally {
    restore();
  }
});

test("retries a 5xx then succeeds", async () => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    return n === 1 ? jsonResponse({ e: 1 }, { status: 500 }) : jsonResponse({ ok: true });
  });
  const restore = installFetch(mock);
  try {
    const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("flaky");
    assert.equal(res.ok, true);
    assert.equal(mock.calls.length, 2);
  } finally {
    restore();
  }
});

test("honors Retry-After on 429", async () => {
  let n = 0;
  const mock = mockFetch(() => {
    n += 1;
    return n === 1
      ? jsonResponse({}, { status: 429, headers: { "retry-after": "0" } })
      : jsonResponse({ ok: true });
  });
  const restore = installFetch(mock);
  try {
    const res = await client({ retries: 1 }).getJson<{ ok: boolean }>("limited");
    assert.equal(res.ok, true);
    assert.equal(mock.calls.length, 2);
  } finally {
    restore();
  }
});

test("aborts on timeout and maps to a timeout error", async () => {
  const mock = mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const restore = installFetch(mock);
  try {
    await assert.rejects(
      () => client({ retries: 0, timeoutMs: 30 }).getJson("slow"),
      (err: unknown) => err instanceof ApiError && err.code === "timeout",
    );
  } finally {
    restore();
  }
});

test("a caller abort is propagated as a non-retryable error (no retries)", async () => {
  const mock = mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const restore = installFetch(mock);
  const controller = new AbortController();
  try {
    const p = client({ retries: 3 }).getJson("x", { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(
      () => p,
      (err: unknown) =>
        err instanceof ApiError && err.code === "network" && err.retryable === false,
    );
    assert.equal(mock.calls.length, 1); // not retried
  } finally {
    restore();
  }
});
