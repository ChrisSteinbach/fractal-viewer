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
    resolved: "d96be25b54bf2d98",
    emitted: "0678ded3a8ff419b",
  },
  "3D lens finish0": {
    resolved: "9d831d4770d4ba2c",
    emitted: "b8b80b22b2b010aa",
  },
  "3D lens finish1": {
    resolved: "aef25bc005bfa492",
    emitted: "d754e88870d23a6f",
  },
  "3D balloon finish0": {
    resolved: "9e0bb35ffd947d21",
    emitted: "8a3ca649ed45d7c2",
  },
  "3D balloon finish1": {
    resolved: "648c411b18d4067f",
    emitted: "9fe2b3cadb57aa32",
  },
  "3D plane finish0": {
    resolved: "0d606850ba40cb84",
    emitted: "4ede30dc81198664",
  },
  "3D plane finish1": {
    resolved: "f4278ce2a0d55b3a",
    emitted: "71aa043bc0cf3f17",
  },
  "3D lens+balloon finish0": {
    resolved: "55641a810d77d4cb",
    emitted: "e6302065ea497beb",
  },
  "3D lens+balloon finish1": {
    resolved: "fe0a25add8190f88",
    emitted: "fd44f5a17c42aeb3",
  },
  "3D lens+plane finish0": {
    resolved: "209a99c7df543dec",
    emitted: "1c65d10713495ab7",
  },
  "3D lens+plane finish1": {
    resolved: "2f19b020bb063824",
    emitted: "9dfff5fed89b0f1d",
  },
  "3D escape finish0": {
    resolved: "86f0c307bb5e92ad",
    emitted: "86f0c307bb5e92ad",
  },
  "3D escape finish1": {
    resolved: "71e9259a1de8a672",
    emitted: "71e9259a1de8a672",
  },
  "3D escape+balloon finish0": {
    resolved: "a90b36c91af7e94f",
    emitted: "22a13206008bddc5",
  },
  "3D escape+balloon finish1": {
    resolved: "0fac34b766de662d",
    emitted: "dcdc93e811623797",
  },
  "3D escape+plane finish0": {
    resolved: "d99cd01801d1ceb7",
    emitted: "2fd606033f825428",
  },
  "3D escape+plane finish1": {
    resolved: "582215cc94ca5726",
    emitted: "ecb2c1f99e7c0b1b",
  },
  "3D bulb finish0": {
    resolved: "934401b39b9527d3",
    emitted: "934401b39b9527d3",
  },
  "3D bulb finish1": {
    resolved: "9981ffc5aba156b6",
    emitted: "9981ffc5aba156b6",
  },
  "3D bulb+balloon finish0": {
    resolved: "f154b9993153245f",
    emitted: "f154b9993153245f",
  },
  "3D bulb+balloon finish1": {
    resolved: "0bcd0910c9a9bea6",
    emitted: "0bcd0910c9a9bea6",
  },
  "3D bulb+plane finish0": {
    resolved: "b1f566e878e0006a",
    emitted: "c66d896d94e7df3c",
  },
  "3D bulb+plane finish1": {
    resolved: "8a5bffac9313765f",
    emitted: "26e0f64606c50865",
  },
  "4D base finish0": {
    resolved: "03f1ff298d0b36c7",
    emitted: "b3cc730fc3ae3d6c",
  },
  "4D base finish1": {
    resolved: "3c55e558cb76e2c7",
    emitted: "188ce6c2fb90e8c5",
  },
  "4D balloon finish0": {
    resolved: "1064b1c7f55dac1b",
    emitted: "ed60e94146157569",
  },
  "4D balloon finish1": {
    resolved: "d370a9703f339864",
    emitted: "e446b3b56a95da29",
  },
  "4D plane finish0": {
    resolved: "261c1512a4311fe6",
    emitted: "125f86560b255b40",
  },
  "4D plane finish1": {
    resolved: "0433888b6a16ac6f",
    emitted: "5199542cb5996735",
  },
};
