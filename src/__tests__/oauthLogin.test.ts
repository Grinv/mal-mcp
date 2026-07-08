import { test } from "node:test";
import assert from "node:assert/strict";
import { generateVerifier, buildAuthorizeUrl, extractCode } from "../lib/oauthLogin.js";

test("generateVerifier returns a 43-128 char unreserved string (PKCE)", () => {
  const v = generateVerifier();
  assert.ok(v.length >= 43 && v.length <= 128, `length ${v.length} out of range`);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/); // base64url is a subset of unreserved
  assert.notEqual(v, generateVerifier()); // random each call
});

test("buildAuthorizeUrl uses PKCE plain with challenge == verifier", () => {
  const url = new URL(
    buildAuthorizeUrl({
      oauthBaseUrl: "https://myanimelist.net/v1/oauth2",
      clientId: "abc",
      redirectUri: "http://localhost:8080/callback",
      verifier: "VER123",
      state: "s",
    }),
  );
  assert.equal(url.pathname, "/v1/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("code_challenge_method"), "plain");
  assert.equal(url.searchParams.get("code_challenge"), "VER123"); // plain → equals verifier
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8080/callback");
  assert.equal(url.searchParams.get("state"), "s");
});

test("extractCode handles a full redirect URL, a bare query, and a bare code", () => {
  assert.equal(extractCode("http://localhost:8080/callback?code=XYZ&state=s"), "XYZ");
  assert.equal(extractCode("?code=XYZ&state=s"), "XYZ");
  assert.equal(extractCode("XYZ"), "XYZ");
});

test("extractCode throws on an error redirect or a missing code", () => {
  assert.throws(() => extractCode("http://localhost:8080/callback?error=access_denied"), /denied/i);
  assert.throws(() => extractCode("http://localhost:8080/callback?state=s"), /no `code`/i);
});
