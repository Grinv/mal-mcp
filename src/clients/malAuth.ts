// OAuth token lifecycle for the official MyAnimeList API: silent refresh (single-flight, so
// concurrent 401s don't each spend the same rotating refresh token) and the interactive
// login_mal/submit_mal_redirect PKCE flow. Split out of mal.ts, which composes an instance of
// this alongside its own personal-list CRUD operations — this class owns nothing about anime
// or manga, just "how do we get/keep a valid access token."
import { HttpClient } from "../lib/http.js";
import { formBody } from "./httpClients.js";
import { ApiError } from "../lib/errors.js";
import { TokenStore, type TokenState } from "../lib/tokenStore.js";
import {
  buildAuthorizeUrl,
  extractCode,
  extractState,
  generateState,
  generateVerifier,
  listenForCode,
  openBrowser,
} from "../lib/oauthLogin.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";

const REFRESH_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class MalAuthManager {
  readonly #oauth: HttpClient;
  readonly #oauthBaseUrl: string;
  readonly #oauthPort: number;
  readonly #auth: Config["auth"];
  readonly #logger: Logger;
  readonly #store: TokenStore | undefined;
  #state: TokenState;
  // Single-flight: dedupe concurrent refreshes so parallel 401s don't each spend
  // the (rotating) refresh token and clobber each other.
  #refreshing: Promise<string> | undefined;
  // In-progress interactive login (login_mal): the PKCE verifier + redirect URI
  // awaiting a code, and the localhost listener (if one could be bound).
  #pendingLogin: { verifier: string; redirectUri: string; state: string } | undefined;
  #loginServer: { close: () => void } | undefined;

  constructor(config: Config, logger: Logger, store?: TokenStore) {
    this.#auth = config.auth;
    this.#logger = logger;
    this.#store = store;
    this.#oauth = new HttpClient({
      baseUrl: config.malOauthBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
    });
    this.#oauthBaseUrl = config.malOauthBaseUrl;
    this.#oauthPort = config.oauthPort;

    const stored = store?.load();
    this.#state = stored ?? {
      accessToken: this.#auth.accessToken ?? "",
      refreshToken: this.#auth.refreshToken ?? "",
      // Unknown expiry for an env-provided token: trust it until a 401.
      expiresAt: this.#auth.accessToken ? Number.POSITIVE_INFINITY : 0,
    };
  }

  /** Whether the personal-list tools are usable right now — a valid access
   *  token in hand, or the means to refresh one. Computed live (not a static
   *  config snapshot) so a token obtained via login_mal during this session, or
   *  loaded from the token store, counts immediately. */
  isConfigured(): boolean {
    return Boolean(this.#state.accessToken || this.#canRefresh());
  }

  // Can we silently refresh? A client id plus a refresh token (from the live
  // state — e.g. just saved by login — or from env). The client secret is
  // optional (public PKCE client).
  #canRefresh(): boolean {
    return Boolean(this.#auth.clientId && (this.#state.refreshToken || this.#auth.refreshToken));
  }

  /** Run `fn` with a valid access token, refreshing once on 401 if possible. */
  async withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.#ensureAccessToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof ApiError && err.code === "unauthorized" && this.#canRefresh()) {
        this.#logger.info("access token rejected; attempting silent refresh");
        const fresh = await this.#refresh();
        return await fn(fresh);
      }
      throw err;
    }
  }

  async #ensureAccessToken(): Promise<string> {
    const valid = this.#state.accessToken && this.#state.expiresAt - REFRESH_SKEW_MS > Date.now();
    if (valid) return this.#state.accessToken;
    if (this.#canRefresh()) return this.#refresh();
    if (this.#state.accessToken) return this.#state.accessToken;
    throw new ApiError({
      code: "unauthorized",
      message: "No MyAnimeList access token configured",
    });
  }

  #refresh(): Promise<string> {
    // Coalesce concurrent refreshes into one in-flight request.
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<string> {
    const refreshToken = this.#state.refreshToken || this.#auth.refreshToken;
    if (!this.#auth.clientId || !refreshToken) {
      throw new ApiError({
        code: "unauthorized",
        message: "Cannot refresh: missing client id or refresh token",
      });
    }
    // Public (secret-less) PKCE client → no client_secret in the request.
    const body = formBody({
      grant_type: "refresh_token",
      client_id: this.#auth.clientId,
      refresh_token: refreshToken,
    });
    let res: TokenResponse;
    try {
      res = await this.#oauth.requestJson<TokenResponse>("token", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        retries: 0,
      });
    } catch (err) {
      // MAL answers an expired or revoked refresh token with 400, which classifies as
      // `bad_request` and reaches the agent as "The request was rejected as invalid" — no hint
      // that re-authorizing is the fix. Restate it as `unauthorized` so result.ts's existing
      // login_mal guidance applies. Only for a genuine rejection: a 5xx or a dropped connection
      // says nothing about the token, and discarding it there would log the user out over a
      // blip.
      if (err instanceof ApiError && !err.retryable) {
        // Drop the dead token so the next personal-list call fails fast with the same advice
        // instead of replaying this exchange against MAL every time.
        this.#state = { ...this.#state, accessToken: "", refreshToken: "", expiresAt: 0 };
        this.#store?.save(this.#state);
        throw new ApiError({
          code: "unauthorized",
          message:
            "MyAnimeList rejected the stored refresh token; it has expired or been revoked. " +
            "Run the login_mal tool to re-authorize.",
          cause: err,
        });
      }
      throw err;
    }

    this.#state = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (res.expires_in ?? 0) * 1000,
    };
    this.#store?.save(this.#state);
    this.#logger.info("refreshed MyAnimeList access token");
    return this.#state.accessToken;
  }

  // ---- interactive login (login_mal / submit_mal_redirect) -----------------

  /** The localhost Redirect URI the MAL app must be registered with. */
  get redirectUri(): string {
    return `http://localhost:${this.#oauthPort}/callback`;
  }

  /** Begin an interactive OAuth login and return the authorize URL for the user
   *  to open. Best-effort, so it works in every environment: it also starts a
   *  localhost listener (auto-completes when the browser is on the same machine)
   *  and tries to open the browser. When the browser is remote/headless, the
   *  user finishes by pasting the redirected URL into {@link submitRedirect}. */
  async startLogin(options: { open?: (url: string) => void } = {}): Promise<{
    authorizeUrl: string;
    redirectUri: string;
    listening: boolean;
  }> {
    if (!this.#auth.clientId) {
      throw new ApiError({ code: "unauthorized", message: "Set MAL_CLIENT_ID before login." });
    }
    this.#loginServer?.close(); // supersede any prior pending login
    this.#loginServer = undefined;

    const verifier = generateVerifier();
    const state = generateState();
    const redirectUri = this.redirectUri;
    this.#pendingLogin = { verifier, redirectUri, state };
    const authorizeUrl = buildAuthorizeUrl({
      oauthBaseUrl: this.#oauthBaseUrl,
      clientId: this.#auth.clientId,
      redirectUri,
      verifier,
      state,
    });

    let listening = false;
    try {
      this.#loginServer = await listenForCode({
        port: this.#oauthPort,
        path: "/callback",
        onCode: (code, state) => {
          void this.#completeWithCode(code, state).catch((err) =>
            this.#logger.warn(`login_mal callback exchange failed: ${errMsg(err)}`),
          );
        },
      });
      listening = true;
    } catch (err) {
      // Port busy / can't bind → user completes via submit_mal_redirect instead.
      this.#logger.info(`login_mal: local callback unavailable (${errMsg(err)}); use manual paste`);
    }

    (options.open ?? openBrowser)(authorizeUrl);
    return { authorizeUrl, redirectUri, listening };
  }

  /** Finish an interactive login from the redirected URL (or bare code) the user
   *  pasted back — the remote/headless path. */
  async submitRedirect(redirect: string): Promise<void> {
    if (!this.#pendingLogin) {
      throw new ApiError({
        code: "bad_request",
        message: "No login in progress; run login_mal first.",
      });
    }
    await this.#completeWithCode(extractCode(redirect), extractState(redirect));
  }

  // Exchange an authorization code for tokens (public PKCE client → no secret),
  // persist them, and clear the pending-login state.
  async #completeWithCode(code: string, returnedState: string | null): Promise<void> {
    const pending = this.#pendingLogin;
    if (!pending) throw new ApiError({ code: "bad_request", message: "No login in progress." });
    // CSRF / authorization-code-injection guard: MAL echoes back the `state` we
    // sent, so a present-but-mismatched state means this isn't the redirect we
    // initiated — reject it. A bare-code paste carries no state to check; there the
    // per-login PKCE code_verifier (unknown to any third party) is the protection.
    if (returnedState !== null && returnedState !== pending.state) {
      throw new ApiError({
        code: "bad_request",
        message: "OAuth state mismatch; ignoring this redirect.",
      });
    }
    const body = formBody({
      grant_type: "authorization_code",
      client_id: this.#auth.clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
    });
    const res = await this.#oauth.requestJson<TokenResponse>("token", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      retries: 0,
    });
    this.#state = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? "",
      expiresAt: Date.now() + (res.expires_in ?? 0) * 1000,
    };
    this.#store?.save(this.#state);
    this.#pendingLogin = undefined;
    this.#loginServer?.close();
    this.#loginServer = undefined;
    this.#logger.info("login_mal: obtained and stored a MyAnimeList token");
  }
}
