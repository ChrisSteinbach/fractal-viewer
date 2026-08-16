#!/usr/bin/env node
/**
 * The 4D lifts' browser gate (fr-vag4 / fr-h0c3 / fr-qxxw) — not an npm
 * script, because it drives a real build in a real browser and the three
 * things it checks are exactly the three no unit test reaches.
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-4d-lift.verify.mjs [--display=:0] [--url=…]
 *
 * TWO PHASES: eight hash-borne SCENES (minimal documents, no preset table
 * involved, so the gate survives one changing under it), then the three
 * shipped 4D escape-time PRESETS loaded FROM THE MENU — the only place
 * that checks what a user's first contact with them does, since
 * `escape-family.verify.mjs` reads the Escape-time group and these live in
 * the 4D one.
 *
 * WHAT IT ASKS, per scene, of a session it drives FROM THE UI:
 *
 *   1. does the session ENTER at all (the eligibility gate admits it), and
 *      does it reach a COMPLETED settle (`window.__surfaceState().settled`,
 *      fr-opgk's latch — not "pixels stopped changing", which strip pacing
 *      and measured pass sizing both make a lie);
 *   2. does it DRAW something — the fr-17qu evidence, a hit fraction over
 *      `SURFACE_BLANK_HIT_FRACTION`, read here as the share of non-backdrop
 *      pixels in a downscaled frame so the check is engine-agnostic;
 *   3. WHICH ENGINE took it (`__surfaceState().engine`), which is what keeps
 *      `core: "escape4"` from being dead code and what proves the
 *      compute-only routing decision is the one that actually happened.
 *
 * The scene documents are built into this file as `#v1=` hashes (produced
 * by `persist.ts`'s own encoder), so the gate needs no preset to exist and
 * survives a preset table that changes under it.
 *
 * Exit 0 = every scene entered, settled, drew and took the expected engine.
 * Exit 1 = a harness/setup failure. Exit 3 = a scene FAILED one of the
 * three questions (the numbers are printed per scene either way).
 *
 * `--display=:0` runs headed against a real X display and a real GPU
 * driver, which is the mode that answers question 3 honestly; without it
 * Chrome's new headless mode still exposes WebGPU on some stacks and falls
 * back on others, so the engine column is reported rather than gated.
 */
import { chromium } from "playwright-core";

/** Scene documents, `#v1=` payloads from `persist.ts`'s encoder. Each is a
 * MINIMAL document for one lift — no preset, no side table. */
const SCENES = [
  {
    name: "escape4",
    what: "a w-rotated mandelbox chained with a boxfold — fr-vag4's headline shape",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV0sInciOnsicm90YXRpb24iOnsieHciOjAuNH19fSx7InBvc2l0aW9uIjpbMCwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlsxLDEsMV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxLjZ9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9",
  },
  {
    name: "escape4kaleido",
    what: "the same chain under an xw-plane kaleidoscope — the fold 3D cannot do",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV0sInciOnsicm90YXRpb24iOnsieHciOjAuMjV9fX0seyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MS42fV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjUsInBsYW5lIjoieHcifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOmZhbHNlfQ",
  },
  {
    name: "escape4plane",
    what: "that chain with the FLOOR on — fr-vag4 and fr-h0c3 composed",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV0sInciOnsicm90YXRpb24iOnsieHciOjAuNH19fSx7InBvc2l0aW9uIjpbMCwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlsxLDEsMV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxLjZ9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6dHJ1ZX0",
  },
  {
    name: "ifs4plane",
    what: "a 4D IFS attractor with the floor — fr-h0c3 on the compute arm",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjowLjMsInJvdGF0aW9uIjp7Inh3IjowLjR9fX0seyJwb3NpdGlvbiI6Wy0wLjUsMC41LC0wLjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjUsLTAuNSwtMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InJvdGF0aW9uIjp7Inl3IjowLjI1fX19LHsicG9zaXRpb24iOlstMC41LC0wLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6ZmFsc2UsImJhbGxvb25SYWRpdXMiOjEuNiwiZm9nRGVuc2l0eSI6MSwiZm9nVGludCI6IiNmZmZmZmYiLCJmb2dUaW50U3RyZW5ndGgiOjAsImdyb3VuZFBsYW5lIjp0cnVlfQ",
  },
  {
    name: "ifs4balloon",
    what: "the same attractor with the balloon — fr-qxxw on the compute arm",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjowLjMsInJvdGF0aW9uIjp7Inh3IjowLjR9fX0seyJwb3NpdGlvbiI6Wy0wLjUsMC41LC0wLjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjUsLTAuNSwtMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InJvdGF0aW9uIjp7Inl3IjowLjI1fX19LHsicG9zaXRpb24iOlstMC41LC0wLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6dHJ1ZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOmZhbHNlfQ",
  },
  {
    name: "ifs4kaleidoPlane",
    what: "kaleidoscope-4D with the floor — the FRAGMENT arm's measured home (2 maps at order 3: fr-b72d's order cost is superlinear, and a four-map order-5 system settles neither with the floor NOR without it on this hardware — measured, so the fixture is lighter than its subject)",
    engine: "webgl",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNDUsMC40NSwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41MiwwLjUyLDAuNTJdLCJ3Ijp7InBvc2l0aW9uIjowLjI1LCJyb3RhdGlvbiI6eyJ4dyI6MC4zNX19fSx7InBvc2l0aW9uIjpbLTAuNDUsLTAuNDUsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNTIsMC41MiwwLjUyXSwidyI6eyJyb3RhdGlvbiI6eyJ5dyI6MC4yfX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjMsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9",
  },
  {
    name: "ifs4kaleidoBalloon",
    what: "kaleidoscope-4D with the balloon — the fragment arm again",
    engine: "webgl",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNDUsMC40NSwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41MiwwLjUyLDAuNTJdLCJ3Ijp7InBvc2l0aW9uIjowLjI1LCJyb3RhdGlvbiI6eyJ4dyI6MC4zNX19fSx7InBvc2l0aW9uIjpbLTAuNDUsLTAuNDUsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNTIsMC41MiwwLjUyXSwidyI6eyJyb3RhdGlvbiI6eyJ5dyI6MC4yfX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjMsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjp0cnVlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9",
  },
  {
    name: "escape3plane",
    what: "the classic 3D Mandelbox with the floor — the regression control",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9",
  },
];

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: 120000,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
  }
  return out;
}

/** The shipped 4D escape-time presets (fr-vag4), by their menu VALUE — the
 * `PRESET_RENDER_HINTS` route sends all three straight to Surface, so
 * loading one and pressing Surface is a user's whole first contact. */
const PRESETS_4D = [
  {
    value: "mandelboxBrick",
    what: "mandelboxCube turned 1 rad in xw — the cube stretched into a wide brick",
  },
  {
    value: "mandelboxColumn",
    what: "the same map turned in yw instead — the rotation plane picks the long axis",
  },
  {
    value: "hybridChainShells",
    what: "hybridChainQuaternion with the rotation on its POWER link — the one position that costs no rays",
  },
];

const NON_BACKDROP_TOL = 10;

/** Share of canvas pixels that differ from the frame's own corners. */
async function coverage(page) {
  const canvas = await page.$("canvas");
  if (!canvas) return null;
  const shot = await canvas.screenshot({ type: "png" });
  return page.evaluate(
    async ({ bytes, tol }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const w = 128;
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const at = (x, y) => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
      let n = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = at(x, y);
          const backdrop = corners.some(
            (c) =>
              Math.abs(c[0] - p[0]) <= tol &&
              Math.abs(c[1] - p[1]) <= tol &&
              Math.abs(c[2] - p[2]) <= tol,
          );
          if (!backdrop) n++;
        }
      }
      return n / (w * h);
    },
    { bytes: Array.from(shot), tol: NON_BACKDROP_TOL },
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.display !== undefined) flags.push("--no-sandbox");
  else flags.push("--headless=new");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    args: flags,
    ...(args.display !== undefined
      ? { env: { ...process.env, DISPLAY: args.display } }
      : {}),
  });
  let failed = false;
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 640 },
    });
    page.on("pageerror", (e) => {
      process.stderr.write(`[page:uncaught] ${e.message}\n`);
    });
    for (const scene of SCENES) {
      // A unique query per scene, because navigating to a URL that differs
      // only in its FRAGMENT does not reload — and this app reads the
      // scene hash exactly once, at boot. Without it every scene after the
      // first renders the first one (measured: three different documents,
      // three identical hit counts).
      const url = `${args.url}/?surfacestate&scene=${scene.name}#${scene.hash}`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(
        () => typeof window.__surfaceState === "function",
        {
          timeout: 30000,
        },
      );
      // Enter surface mode FROM THE UI, exactly as a user would — the
      // routing under test is the session start's, not a direct call.
      await page.click("#modeSurfaceBtn");
      let state = null;
      const deadline = Date.now() + args.settleMs;
      let entered = false;
      while (Date.now() < deadline) {
        state = await page.evaluate(() => window.__surfaceState?.() ?? null);
        if (state && state.mode !== "surface") break;
        if (state && state.firstFrame) entered = true;
        if (state && state.settled) break;
        await page.waitForTimeout(250);
      }
      const settled = Boolean(state && state.settled);
      const engine = state ? state.engine : null;
      // Coverage: the share of pixels that differ from the frame's own
      // corner backdrop. Engine-agnostic, and the same question fr-17qu's
      // blank-frame notice asks of its hit counts.
      // Coverage from a real SCREENSHOT of the canvas, not a readback:
      // a WebGL context without preserveDrawingBuffer reads back empty
      // outside its own rAF, which measures 0% for a frame that is plainly
      // there. The share of pixels differing from the frame's own corner
      // backdrop is the same question fr-17qu's blank-frame notice asks of
      // its hit counts, and it is engine-agnostic.
      const drawn = await coverage(page);
      const ok =
        entered &&
        settled &&
        drawn !== null &&
        drawn > 0.005 &&
        engine !== null;
      if (!ok) failed = true;
      const enginePass =
        args.display === undefined || engine === scene.engine
          ? ""
          : "  ENGINE MISMATCH";
      process.stdout.write(
        `${ok ? "PASS" : "FAIL"}  ${scene.name.padEnd(20)} ` +
          `entered=${String(entered).padEnd(5)} settled=${String(settled).padEnd(5)} ` +
          `engine=${String(engine).padEnd(8)} (want ${scene.engine}) ` +
          `drawn=${drawn === null ? "n/a" : (drawn * 100).toFixed(1) + "%"}` +
          `${enginePass}\n  ${scene.what}\n`,
      );
      if (args.display !== undefined && engine !== scene.engine) failed = true;
      // Back to the explorer so the next scene's entry is a fresh session.
      await page.click("#modePointsBtn").catch(() => {});
    }

    // PHASE 2 (fr-vag4): the shipped 4D escape-time presets, loaded FROM
    // THE MENU rather than as a hash — which is the only way to check
    // what a user's first contact with them actually does, and what
    // `escape-family.verify.mjs` does for the 3D group it covers (this
    // group is the 4D one, which that script does not read). Unit tests
    // pin the gate and the fill; nothing but this pins that the option
    // exists, loads, and draws.
    for (const preset of PRESETS_4D) {
      await page.goto(`${args.url}/?surfacestate&preset=${preset.value}`, {
        waitUntil: "load",
      });
      await page.waitForFunction(
        () => typeof window.__surfaceState === "function",
        { timeout: 30000 },
      );
      await page.selectOption("#presetSelect", preset.value);
      await page.click("#modeSurfaceBtn");
      let state = null;
      const deadline = Date.now() + args.settleMs;
      let entered = false;
      while (Date.now() < deadline) {
        state = await page.evaluate(() => window.__surfaceState?.() ?? null);
        if (state && state.mode !== "surface") break;
        if (state && state.firstFrame) entered = true;
        if (state && state.settled) break;
        await page.waitForTimeout(250);
      }
      const settled = Boolean(state && state.settled);
      const engine = state ? state.engine : null;
      const drawn = await coverage(page);
      const ok =
        entered &&
        settled &&
        drawn !== null &&
        drawn > 0.005 &&
        engine !== null;
      if (!ok) failed = true;
      if (args.display !== undefined && engine !== "compute") failed = true;
      process.stdout.write(
        `${ok ? "PASS" : "FAIL"}  preset:${preset.value.padEnd(13)} ` +
          `entered=${String(entered).padEnd(5)} settled=${String(settled).padEnd(5)} ` +
          `engine=${String(engine).padEnd(8)} (want compute) ` +
          `drawn=${drawn === null ? "n/a" : (drawn * 100).toFixed(1) + "%"}` +
          `\n  ${preset.what}\n`,
      );
      await page.click("#modePointsBtn").catch(() => {});
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 3 : 0);
}

run().catch((e) => {
  process.stderr.write(
    `[surface-4d-lift] ${e instanceof Error ? e.stack : String(e)}\n`,
  );
  process.exit(1);
});
