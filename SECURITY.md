# Security Policy

## Reporting

Use GitHub's private vulnerability reporting: this repository's **Security**
tab, then **Report a vulnerability**. Please do not open a public issue for
anything security-relevant.

Do not discuss publicly, even as a "possible issue", anything touching the
deployed site's security surface: the Content-Security-Policy, the service
worker and its cross-origin-isolation headers, localStorage contents, or the
`#v1=` scene-document hash decoder. A public write-up hands every visitor of
fractal-4d.com the details before a fix exists.

## Scope

This is a static, client-only PWA. There is no backend, no accounts, and no
telemetry: the app sends nothing to third parties and processes nothing
off-device. All runtime network traffic is the service worker serving the
app's own same-origin assets; scenes, palettes, imported `.flame`/JSON files
and images are decoded locally in the browser.

Only the current deployment at fractal-4d.com and the current `main` branch
are supported.
