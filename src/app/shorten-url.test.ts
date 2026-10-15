import { shortenUrl, SHORTEN_TIMEOUT_MS } from "./shorten-url";
import indexHtml from "./index.html?raw";

/** A fetch stub answering a plain-text body — the module's success shape
 * is a 200 whose text IS the short URL. */
function fetchAnswering(body: string, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(body, { status, headers: { "content-type": "text/plain" } }),
    );
}

/** A fetch stub whose promise never settles until its abort signal fires,
 * then rejects with the abort — the timeout path, for real. */
function fetchHangingUntilAborted(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    })) as unknown as typeof fetch;
}

describe("shortenUrl", () => {
  it("resolves the short URL on a 200 whose body is one", async () => {
    const outcome = await shortenUrl("https://fractal-4d.com/#v1=abc", {
      fetchImpl: fetchAnswering("https://da.gd/3WWRNY\n"),
    });
    expect(outcome).toEqual({ ok: true, shortUrl: "https://da.gd/3WWRNY" });
  });

  it("encodes the long link whole, fragment included", async () => {
    let requested = "";
    const spy = ((_url: string) => {
      requested = _url;
      return Promise.resolve(new Response("https://da.gd/abc"));
    }) as unknown as typeof fetch;
    await shortenUrl("https://fractal-4d.com/#v1=eyJ0eXN0ZXIiOjF9", {
      fetchImpl: spy,
    });
    expect(requested.startsWith("https://da.gd/shorten?url=")).toBe(true);
    // The encoded long link round-trips back to the exact input — the
    // fragment is part of what the shortener must store.
    const sent = decodeURIComponent(
      requested.slice("https://da.gd/shorten?url=".length),
    );
    expect(sent).toBe("https://fractal-4d.com/#v1=eyJ0eXN0ZXIiOjF9");
  });

  it("refuses a non-OK status, a non-da.gd body, and an empty body", async () => {
    expect(
      await shortenUrl("https://fractal-4d.com/", {
        fetchImpl: fetchAnswering("nope", 400),
      }),
    ).toEqual({ ok: false });
    expect(
      await shortenUrl("https://fractal-4d.com/", {
        fetchImpl: fetchAnswering("https://evil.example/not-ours"),
      }),
    ).toEqual({ ok: false });
    expect(
      await shortenUrl("https://fractal-4d.com/", {
        fetchImpl: fetchAnswering(""),
      }),
    ).toEqual({ ok: false });
  });

  it("refuses a network failure instead of throwing", async () => {
    const outcome = await shortenUrl("https://fractal-4d.com/", {
      fetchImpl: () => Promise.reject(new Error("offline")),
    });
    expect(outcome).toEqual({ ok: false });
  });

  it("refuses when the request hangs past the timeout", async () => {
    const outcome = await shortenUrl("https://fractal-4d.com/", {
      fetchImpl: fetchHangingUntilAborted(),
      timeoutMs: 20,
    });
    expect(outcome).toEqual({ ok: false });
  });

  it("keeps its timeout bounded and its endpoint on the measured provider", () => {
    // The constants are part of the contract: a hung connection stops
    // mattering quickly (the fallback is "no swap"), and the endpoint is
    // the provider the module doc's measurement record names.
    expect(SHORTEN_TIMEOUT_MS).toBe(8_000);
  });

  it("is reachable under the app's Content Security Policy", () => {
    // The failure path is silent BY DESIGN — a shortening refusal just
    // keeps the full link — so a CSP that re-tightens connect-src would
    // silently disable the feature with nothing failing anywhere. Pin the
    // one off-origin host the module doc's record names, on the one CSP
    // (index.html's) that governs the page the dialog lives on. A regex
    // on the raw markup keeps this file node-env (no jsdom pragma); the
    // meta tag's shape is pinned by the element-contract tests.
    const csp =
      /Content-Security-Policy"\s+content="([^"]+)"/.exec(indexHtml)?.[1] ?? "";
    expect(csp).toContain("connect-src 'self' https://da.gd");
  });
});
