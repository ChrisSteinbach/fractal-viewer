/**
 * The scene link's SHORTENER: the one network call the description dialog
 * makes, turning a multi-kilobyte `#v1=…` share link into something a
 * microblog post can carry. User-initiated (they are about to post, so
 * they are online), optional (every failure path degrades to the full
 * link), and never blocking: the dialog composes instantly with the long
 * link and swaps in the short one when — and only when — the service
 * answers.
 *
 * THE PROVIDER IS da.gd, NOT by preference but by measurement (2026-10-15;
 * each candidate checked for the three properties a client-side shortener
 * needs here — CORS open to the app's origin, a willingness to shorten
 * this domain, and the owner's trust):
 *
 * - **is.gd** (the user's first choice) and **v.gd** (its sister domain,
 *   asked about next) share one backend and one blocklist: both send
 *   `access-control-allow-origin: *` and shorten `example.com` and
 *   `github.com` fine, but REFUSE every form of `fractal-4d.com` — root,
 *   `www`, pathed, hashed, http and https — with "Error, database insert
 *   failed" while their neighbors succeed. The domain is rejected at
 *   their end; no request shape reaches it.
 * - **tinyurl.com** shortens the domain but locks CORS to its own origin
 *   (`access-control-allow-origin: https://tinyurl.com`) — a browser fetch
 *   from anywhere else is refused before the request leaves the page.
 * - **cleanuri.com** answered 504 — unreliable enough to disqualify.
 * - **clck.ru** (Yandex) passes CORS and shortens the domain, but the
 *   owner declined it on trust grounds (a Russian service), and its
 *   short links route through a SIGNED TRACKER HOP
 *   (`sba.yandex.ru/redirect?url=…&sign=…`) before reaching the target —
 *   two hops where one would do.
 * - **da.gd** passes everything: `access-control-allow-origin: *`, it
 *   shortens the domain with its `#v1=` fragment, its short links are ONE
 *   plain 302 straight to the target (fragment restored verbatim on the
 *   hop — no interstitial, no tracker), multi-kilobyte links shorten fine
 *   (1.5k and 3k measured; the ceiling is untested past that, and a 400
 *   with a plain-text complaint is the error shape), errors answer
 *   HTTP 400, and it is hosted on OVH in France (measured via the
 *   resolve IP's whois) — the trust criterion the owner set. A
 *   long-running personal utility service rather than a corporate
 *   product; the never-throw fallback is the hedge if it ever vanishes:
 *   the dialog keeps the full link and nothing breaks.
 *
 * COEP NOTE: the app serves `Cross-Origin-Embedder-Policy: require-corp`
 * (its service worker's isolation headers), which cross-origin `fetch()`s
 * satisfy in cors mode when the response passes the CORS check — an
 * `access-control-allow-origin: *` response is enough; no CORP header is
 * needed on the shortener.
 *
 * THE CONTRACT IS NEVER-THROW: every outcome — network failure, timeout,
 * non-OK status, a body that is not a da.gd URL — resolves to
 * `{ok: false}`. The caller composes the fallback itself; this module has
 * no opinion about what the full link looks like.
 */

/** The endpoint this module calls. `url` is the full long link,
 * `encodeURIComponent`-encoded (the fragment inside it is part of the
 * stored URL — shorteners preserve fragments, which is what makes a
 * `#v1=` link shortenable at all). */
const DA_GD_ENDPOINT = "https://da.gd/shorten?url=";

/** The short-URL prefix a response body must carry to be believed — a
 * defensive shape check against an error page or a changed API answering
 * 200 with prose (da.gd's own errors are 400s with plain text, but the
 * prefix check is the belt under that braces). */
const DA_GD_PREFIX = "https://da.gd/";

/** How long the swap may take before the dialog stops waiting. The user is
 * composing meanwhile; a hung request must not keep the long link silent
 * about its fate — the fallback is simply "no swap", so the timeout only
 * bounds a connection that would otherwise dangle past the user's
 * patience. */
export const SHORTEN_TIMEOUT_MS = 8_000;

/** What {@link shortenUrl} resolves to: the short URL, or a refusal. */
export type ShortenOutcome =
  { readonly ok: true; readonly shortUrl: string } | { readonly ok: false };

/**
 * Ask the shortener for a short form of `longUrl`. Never throws and never
 * hangs past {@link SHORTEN_TIMEOUT_MS}: any failure resolves
 * `{ok: false}` and the caller keeps the long link. The injected
 * `fetchImpl` exists for tests; production passes nothing.
 */
export async function shortenUrl(
  longUrl: string,
  opts?: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  },
): Promise<ShortenOutcome> {
  const doFetch = opts?.fetchImpl ?? fetch.bind(globalThis);
  const timeoutMs = opts?.timeoutMs ?? SHORTEN_TIMEOUT_MS;
  try {
    const response = await doFetch(
      `${DA_GD_ENDPOINT}${encodeURIComponent(longUrl)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!response.ok) return { ok: false };
    const body = (await response.text()).trim();
    if (!body.startsWith(DA_GD_PREFIX)) return { ok: false };
    return { ok: true, shortUrl: body };
  } catch {
    return { ok: false };
  }
}
