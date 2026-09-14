#!/usr/bin/env node
/**
 * The 4D lifts' browser gate — the escape chain's, the ground plane's and
 * the balloon's, one dimension up — not an npm script, because it drives a
 * real build in a real browser and the three things it checks are exactly
 * the three no unit test reaches.
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
 * TWO KINDS OF SCENE. The eight lift scenes ask the questions below. Two
 * further scenes carry a `thickness` value: after the first settle they set
 * the panel's slice-thickness slider (asserting the row is ENABLED — the
 * nonlinear-fold availability this phase exists for) and wait for a SECOND
 * completed settle at that thickness, then re-ask DRAW and ENGINE. Both are
 * nonlinear 4D IFS documents (a recursive spherefold pair and a mandelbox
 * FINAL over a pentatope base) that the bounded midpoint cover now answers,
 * so a regression in routing, the cover kernel or the panel gate fails here.
 *
 * WHAT IT ASKS, per scene, of a session it drives FROM THE UI:
 *
 *   1. does the session ENTER at all (the eligibility gate admits it), and
 *      does it reach a COMPLETED settle (`window.__surfaceState().settled`,
 *      the settle latch — not "pixels stopped changing", which strip pacing
 *      and measured pass sizing both make a lie);
 *   2. does it DRAW something — the blank-frame notice's evidence, a hit
 *      fraction over `SURFACE_BLANK_HIT_FRACTION`, read here as the share
 *      of non-backdrop pixels in a downscaled frame so the check is
 *      engine-agnostic;
 *   3. WHICH ENGINE took it (`__surfaceState().engine`), which is what keeps
 *      `core: "escape4"` from being dead code and what proves the
 *      compute-only routing decision is the one that actually happened.
 *
 * A `thickness` scene re-asks 2 and 3 after the slider move, and asserts the
 * row was not disabled — the panel's availability answer, not the routing's.
 * `expectSlowSettle: true` marks a cover scene whose full-detail settle is
 * too expensive to wait for (measured; docs/surface-slice-thickness.md):
 * there the check requires the preview that follows the edit to complete
 * and draw, and reports the settle state instead of gating it.
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
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

/** Scene documents, `#v1=` payloads from `persist.ts`'s encoder. Each is a
 * MINIMAL document for one lift — no preset, no side table. */
const SCENES = [
  {
    name: "escape4",
    what: "a w-rotated mandelbox chained with a boxfold — the 4D chain's headline shape",
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
    what: "that chain with the FLOOR on — the 4D chain and the 4D floor composed",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV0sInciOnsicm90YXRpb24iOnsieHciOjAuNH19fSx7InBvc2l0aW9uIjpbMCwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlsxLDEsMV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxLjZ9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6dHJ1ZX0",
  },
  {
    name: "ifs4plane",
    what: "a 4D IFS attractor with the floor — the floor's 4D lift on the compute arm",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjowLjMsInJvdGF0aW9uIjp7Inh3IjowLjR9fX0seyJwb3NpdGlvbiI6Wy0wLjUsMC41LC0wLjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjUsLTAuNSwtMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InJvdGF0aW9uIjp7Inl3IjowLjI1fX19LHsicG9zaXRpb24iOlstMC41LC0wLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6ZmFsc2UsImJhbGxvb25SYWRpdXMiOjEuNiwiZm9nRGVuc2l0eSI6MSwiZm9nVGludCI6IiNmZmZmZmYiLCJmb2dUaW50U3RyZW5ndGgiOjAsImdyb3VuZFBsYW5lIjp0cnVlfQ",
  },
  {
    name: "ifs4balloon",
    what: "the same attractor with the balloon — the balloon's 4D lift on the compute arm",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjowLjMsInJvdGF0aW9uIjp7Inh3IjowLjR9fX0seyJwb3NpdGlvbiI6Wy0wLjUsMC41LC0wLjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjUsLTAuNSwtMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InJvdGF0aW9uIjp7Inl3IjowLjI1fX19LHsicG9zaXRpb24iOlstMC41LC0wLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6dHJ1ZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOmZhbHNlfQ",
  },
  {
    name: "ifs4kaleidoPlane",
    what: "kaleidoscope-4D with the floor — compute since the shade-sizer width fix's 12x re-measurement (the fragment arm was its brief earlier home and stays its fallback; this row expected webgl until a later sweep caught the drift). 2 maps at order 3: the DE's order cost is superlinear, and a four-map order-5 system settles neither with the floor NOR without it on this hardware — measured, so the fixture is lighter than its subject",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNDUsMC40NSwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41MiwwLjUyLDAuNTJdLCJ3Ijp7InBvc2l0aW9uIjowLjI1LCJyb3RhdGlvbiI6eyJ4dyI6MC4zNX19fSx7InBvc2l0aW9uIjpbLTAuNDUsLTAuNDUsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNTIsMC41MiwwLjUyXSwidyI6eyJyb3RhdGlvbiI6eyJ5dyI6MC4yfX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjMsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9",
  },
  {
    name: "ifs4kaleidoBalloon",
    what: "kaleidoscope-4D with the balloon — compute since that same fix, like its floor sibling above",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNDUsMC40NSwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41MiwwLjUyLDAuNTJdLCJ3Ijp7InBvc2l0aW9uIjowLjI1LCJyb3RhdGlvbiI6eyJ4dyI6MC4zNX19fSx7InBvc2l0aW9uIjpbLTAuNDUsLTAuNDUsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNTIsMC41MiwwLjUyXSwidyI6eyJyb3RhdGlvbiI6eyJ5dyI6MC4yfX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjMsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjp0cnVlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9",
  },
  {
    name: "escape3plane",
    what: "the classic 3D Mandelbox with the floor — the regression control",
    engine: "compute",
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9",
  },
  {
    name: "coverSpherePair4",
    what: "a recursive spherefold pair — the bounded midpoint cover's fold4 case; thickness set after the first settle (full 8-sample cover settle, minutes-scale: measured 2-5 min on Iris Xe)",
    engine: "compute",
    thickness: 0.2,
    settleMs: 600000,
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMywwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjEyLDAuMTIsMC4xMl0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJzcGhlcmVmb2xkIiwid2VpZ2h0IjowLjl9XSwidyI6eyJyb3RhdGlvbiI6eyJ4dyI6MC40NX19fSx7InBvc2l0aW9uIjpbLTAuMjUsLTAuMiwwLjJdLCJyb3RhdGlvbiI6WzAsMC41LDAuMV0sInNjYWxlIjpbMC4xMSwwLjExLDAuMTFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoic3BoZXJlZm9sZCIsIndlaWdodCI6MS4xfV0sInciOnsicm90YXRpb24iOnsieXciOjAuNH19fV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImVudkxpZ2h0IjowLCJmbG9vckVuYWJsZWQiOmZhbHNlLCJmbG9vclBhdHRlcm4iOiJzb2xpZCIsImZsb29yVGlsZVNjYWxlIjowLjY0LCJmbG9vckVtaXNzaW9uIjowLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjUsImVudkxpZ2h0IjowLjM1LCJmbG9vclBhdHRlcm4iOiJzb2xpZCIsImZsb29yVGlsZVNjYWxlIjowLjY0LCJmbG9vckVtaXNzaW9uIjowfSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJiYWxsb29uVGludCI6IiMwMDAwMDAiLCJiYWxsb29uVGludFN0cmVuZ3RoIjowLCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOmZhbHNlfQ",
  },
  {
    name: "coverMandelFinal4",
    what: "a mandelbox FINAL over a pentatope base — the cover's affine4+lens case; thickness set after the first settle. SLOW-SETTLE CLASS (see docs/surface-slice-thickness.md): the preview completes and is checked, but a full-detail frame was still ~30 min/sample on the Iris Xe the day this shipped, so the completed settle is not waited for here",
    engine: "compute",
    thickness: 0.2,
    expectSlowSettle: true,
    hash: "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMjc5NSwwLjI3OTUsMC4yNzk1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjotMC4xMjV9fSx7InBvc2l0aW9uIjpbMC4yNzk1LC0wLjI3OTUsLTAuMjc5NV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6LTAuMTI1fX0seyJwb3NpdGlvbiI6Wy0wLjI3OTUsMC4yNzk1LC0wLjI3OTVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOi0wLjEyNX19LHsicG9zaXRpb24iOlstMC4yNzk1LC0wLjI3OTUsMC4yNzk1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjotMC4xMjV9fSx7InBvc2l0aW9uIjpbMCwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiZW52TGlnaHQiOjAsImZsb29yRW5hYmxlZCI6ZmFsc2UsImZsb29yUGF0dGVybiI6InNvbGlkIiwiZmxvb3JUaWxlU2NhbGUiOjAuNjQsImZsb29yRW1pc3Npb24iOjAsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNSwiZW52TGlnaHQiOjAuMzUsImZsb29yUGF0dGVybiI6InNvbGlkIiwiZmxvb3JUaWxlU2NhbGUiOjAuNjQsImZsb29yRW1pc3Npb24iOjB9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImJhbGxvb25UaW50IjoiIzAwMDAwMCIsImJhbGxvb25UaW50U3RyZW5ndGgiOjAsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJnbG93QnJpZ2h0bmVzcyI6MSwiZ3JvdW5kUGxhbmUiOmZhbHNlLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMSwwLjA1LC0wLjFdLCJyb3RhdGlvbiI6WzAuMTUsLTAuMiwwLjI1XSwic2NhbGUiOlswLjg1LDAuODUsMC44NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJtYW5kZWxib3giLCJ3ZWlnaHQiOjEuMX1dLCJ3Ijp7InBvc2l0aW9uIjotMC4wOCwicm90YXRpb24iOnsieXciOi0wLjJ9fX19",
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

/** The shipped 4D escape-time presets, by their menu VALUE — the
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
  await guardFreshDist({ url: args.url });
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.display !== undefined) flags.push("--no-sandbox");
  else flags.push("--headless=new");
  // The machine's conditions, before this gate puts its own browser on the
  // GPU: the engine column is a measurement, so the run carries its own
  // conditions rather than asserting "a quiet machine" in prose.
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's engine/timing rows.",
    );
  }
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
      // Mutter only sends frame callbacks to VISIBLE surfaces, and the
      // settle latch this loop polls is present-gated — an occluded window
      // parks it at a deterministic percent (measured 64%/99%
      // stalls in the sibling balloon gate). Keep the window on top before
      // anything waits on it.
      await page.bringToFront();
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
      // corner backdrop. Engine-agnostic, and the same question the
      // blank-frame notice asks of its hit counts.
      // Coverage from a real SCREENSHOT of the canvas, not a readback:
      // a WebGL context without preserveDrawingBuffer reads back empty
      // outside its own rAF, which measures 0% for a frame that is plainly
      // there. The share of pixels differing from the frame's own corner
      // backdrop is the same question the blank-frame notice asks of
      // its hit counts, and it is engine-agnostic.
      const drawn = await coverage(page);
      let thicknessOk = true;
      let thicknessNote = "";
      if (scene.thickness !== undefined) {
        // The panel's availability answer: for a nonlinear system the
        // bounded midpoint cover now answers, the row must be ENABLED —
        // the exact user-visible regression this phase exists for.
        const rowEnabled = await page.evaluate(() => {
          const el = document.getElementById("fourDSliceThicknessSlider");
          return el instanceof HTMLInputElement && !el.disabled;
        });
        await page.evaluate((value) => {
          const el = document.getElementById("fourDSliceThicknessSlider");
          if (!(el instanceof HTMLInputElement)) return;
          el.value = String(value);
          // The panel's own live-edit pair: `input` stores the value (no
          // cloud meaning, so it deliberately skips the slice push), and
          // `change` is the commit-on-release that re-arms the tracer.
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, scene.thickness);
        // The slider stores the value synchronously, but the tracer reads
        // it in the animation loop's per-frame `setSurface4View` push, so
        // the settle latch clears a frame or two later. Poll for that
        // clear — a latch that never clears means nothing new was asked
        // for (a vacuous pass).
        let invalidated = false;
        const invalidateDeadline = Date.now() + 10000;
        while (!invalidated && Date.now() < invalidateDeadline) {
          invalidated = await page.evaluate(() => {
            const state = window.__surfaceState?.();
            return Boolean(state && state.mode === "surface" && !state.settled);
          });
          if (!invalidated) await page.waitForTimeout(100);
        }
        let thickState = null;
        const readProgressLabel = () =>
          page.evaluate(() => {
            const el = document.querySelector("#surfaceProgress");
            return el && !el.classList.contains("hidden")
              ? el.textContent
              : null;
          });
        const thickDeadline = Date.now() + (scene.settleMs ?? args.settleMs);
        let previewDone = false;
        while (Date.now() < thickDeadline) {
          thickState = await page.evaluate(
            () => window.__surfaceState?.() ?? null,
          );
          if (thickState && thickState.settled) {
            previewDone = true;
            break;
          }
          // The slow-settle class gets the same visual check one stage
          // earlier: the preview that follows the edit IS a cover frame,
          // so waiting for the row to announce the full-detail stage
          // proves the edit reached the tracer and drew.
          if (scene.expectSlowSettle === true) {
            const label = await readProgressLabel();
            if (typeof label === "string" && label.startsWith("Full detail")) {
              previewDone = true;
              break;
            }
          }
          await page.waitForTimeout(250);
        }
        const thickSettled = Boolean(thickState && thickState.settled);
        const thickDrawn = thicknessOk ? await coverage(page) : null;
        const settleOk =
          scene.expectSlowSettle === true ? previewDone : thickSettled;
        thicknessOk =
          rowEnabled &&
          invalidated &&
          settleOk &&
          thickDrawn !== null &&
          thickDrawn > 0.005;
        thicknessNote =
          `  thickness=${scene.thickness} rowEnabled=${String(rowEnabled).padEnd(5)} ` +
          `invalidated=${String(invalidated).padEnd(5)} ` +
          `reSettled=${String(thickSettled).padEnd(5)} ` +
          `reDrawn=${thickDrawn === null ? "n/a" : (thickDrawn * 100).toFixed(1) + "%"}` +
          (scene.expectSlowSettle === true
            ? " (slow-settle: preview checked; completed settle not waited for)"
            : "");
      }
      const ok =
        entered &&
        settled &&
        drawn !== null &&
        drawn > 0.005 &&
        engine !== null &&
        thicknessOk;
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
          `${enginePass}${thicknessNote}\n  ${scene.what}\n`,
      );
      if (args.display !== undefined && engine !== scene.engine) failed = true;
      // Back to the explorer so the next scene's entry is a fresh session.
      await page.click("#modePointsBtn").catch(() => {});
    }

    // PHASE 2: the shipped 4D escape-time presets, loaded FROM
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
      await page.bringToFront();
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
