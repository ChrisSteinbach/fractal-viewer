/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source. Initially measured at the pre-pattern-arm tree (8f5fb4d,
 * "Unify surface material slot packing"), then advanced for each
 * intentional global shader change since: the invisible terminal-ray alpha
 * side channel (a hit's coverage flag that must never reach the canvas),
 * the corrected live material B-lane/source comments in the resolved GLSL,
 * the zero-tap-safe AO identity for provably AO-independent authored
 * finishes, the second fragment output carrying the
 * background-recomposition coverage/fog/beta sidecar, the SURFACE_BULB
 * arm's chain-twist pair (uBulbTwistM/uBulbTwistC plus the step-affine
 * branch — the six bulb rows only, the uniforms living inside that arm),
 * and the SURFACE_MENGER arm's insertion into the alternatives chain (the
 * template's closing comment names it; the descent-class rows' RESOLVED
 * hashes move, their EMITTED hashes do not — the arm resolves away to the
 * identical token stream, and the stripping variants never carried the
 * comment).
 * This remains the pattern-OFF baseline the byte-identity tests compare
 * pattern-off emissions against.
 *
 * How to regenerate: run the same resolved/emitted sweep over every
 * (variant, finish) pair on the intentional pattern-off source baseline.
 * Any pattern-arm byte that leaks into a pattern-off program changes a row
 * here; an intentional global shader change must advance every affected row
 * and document why above.
 */
export const PRE_PATTERN_SOURCE_HASHES: Record<
  string,
  { resolved: string; emitted: string }
> = {
  // resolved re-recorded for the alternatives chain's closing comment
  // naming the sphairahedron fold — one comment paragraph, no code
  // motion; the emitted bytes are comment-free and unmoved.
  "3D affine finish0": {
    resolved: "1f98436899cf5d88",
    emitted: "91d566a8234dee47",
  },
  "3D affine finish1": {
    resolved: "0a7caa7f3494c958",
    emitted: "1b1db9eb3b2085cb",
  },
  "3D lens finish0": {
    resolved: "9d831d4770d4ba2c",
    emitted: "b8b80b22b2b010aa",
  },
  "3D lens finish1": {
    resolved: "cbdb20952c331989",
    emitted: "5fb19947acab728d",
  },
  "3D balloon finish0": {
    resolved: "9e0bb35ffd947d21",
    emitted: "8a3ca649ed45d7c2",
  },
  "3D balloon finish1": {
    resolved: "2f4f9b3d0505f8be",
    emitted: "42cb004286b5631f",
  },
  "3D plane finish0": {
    resolved: "a79edb5bd50a43b5",
    emitted: "dd7b99e604850665",
  },
  "3D plane finish1": {
    resolved: "dad928535041232a",
    emitted: "0a448c164c388b38",
  },
  "3D lens+balloon finish0": {
    resolved: "55641a810d77d4cb",
    emitted: "e6302065ea497beb",
  },
  "3D lens+balloon finish1": {
    resolved: "488f710242f47469",
    emitted: "238e58d13f0b7045",
  },
  "3D lens+plane finish0": {
    resolved: "bc84e06559721077",
    emitted: "87a5d4ce889e5288",
  },
  "3D lens+plane finish1": {
    resolved: "15d74c1d5abf68f0",
    emitted: "f81149db09e0c875",
  },
  "3D escape finish0": {
    resolved: "86f0c307bb5e92ad",
    emitted: "86f0c307bb5e92ad",
  },
  "3D escape finish1": {
    resolved: "72322288f75e62e8",
    emitted: "72322288f75e62e8",
  },
  "3D escape+balloon finish0": {
    resolved: "a90b36c91af7e94f",
    emitted: "22a13206008bddc5",
  },
  "3D escape+balloon finish1": {
    resolved: "5fda6672df87d33a",
    emitted: "92a9414f41dbbccd",
  },
  "3D escape+plane finish0": {
    resolved: "a6741fe3247427a4",
    emitted: "de586eb8dfb68b1b",
  },
  "3D escape+plane finish1": {
    resolved: "eccc10224527055e",
    emitted: "7c2eaccb717367c5",
  },
  "3D bulb finish0": {
    resolved: "934401b39b9527d3",
    emitted: "934401b39b9527d3",
  },
  "3D bulb finish1": {
    resolved: "1f3ae76aed3c0ae9",
    emitted: "1f3ae76aed3c0ae9",
  },
  "3D bulb+balloon finish0": {
    resolved: "f154b9993153245f",
    emitted: "f154b9993153245f",
  },
  "3D bulb+balloon finish1": {
    resolved: "909cd1e086a6613f",
    emitted: "909cd1e086a6613f",
  },
  "3D bulb+plane finish0": {
    resolved: "9f1db7307b9a8ddd",
    emitted: "b33d689812c5aa6f",
  },
  "3D bulb+plane finish1": {
    resolved: "0ce3a9e73e7450e8",
    emitted: "17827355c17203ce",
  },
  "4D base finish0": {
    resolved: "03f1ff298d0b36c7",
    emitted: "b3cc730fc3ae3d6c",
  },
  "4D base finish1": {
    resolved: "2c7026f0c3b235a7",
    emitted: "91b5c0da97b03f2f",
  },
  "4D balloon finish0": {
    resolved: "1064b1c7f55dac1b",
    emitted: "ed60e94146157569",
  },
  "4D balloon finish1": {
    resolved: "3a575d6a15c9879a",
    emitted: "8ef73e9ea21de7d4",
  },
  "4D plane finish0": {
    resolved: "29927ffa1ea79658",
    emitted: "75e77ae8d9a341e2",
  },
  "4D plane finish1": {
    resolved: "f75fcf017877867d",
    emitted: "51639c0fe8878cd9",
  },
};
