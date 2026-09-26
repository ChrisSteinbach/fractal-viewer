/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source. Initially measured at the pre-pattern-arm tree (8f5fb4d,
 * "Unify surface material slot packing"), then advanced for each
 * intentional global shader change since: the invisible terminal-ray alpha
 * side channel (a hit's coverage flag that must never reach the canvas),
 * the corrected live material B-lane/source comments in the resolved GLSL,
 * the zero-tap-safe AO identity for provably AO-independent authored
 * finishes, and the second fragment output carrying the
 * background-recomposition coverage/fog/beta sidecar.
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
  "3D affine finish0": {
    resolved: "13e90ad814943235",
    emitted: "e80d0cdb03208f27",
  },
  "3D affine finish1": {
    resolved: "a100886e3686a6c3",
    emitted: "a915ba16492f2ed4",
  },
  "3D lens finish0": {
    resolved: "c3960880cd5ed47c",
    emitted: "fe456ad3746e17ae",
  },
  "3D lens finish1": {
    resolved: "4289e7ed76395ef6",
    emitted: "688c1a87bc8f6257",
  },
  "3D balloon finish0": {
    resolved: "70ae21b7b8f9aa5f",
    emitted: "6b4ed7591abffb3a",
  },
  "3D balloon finish1": {
    resolved: "25498ef13dfdba60",
    emitted: "1af650ee7870bc07",
  },
  "3D plane finish0": {
    resolved: "7ef9e2b976ded4fc",
    emitted: "c04b1711531f23f2",
  },
  "3D plane finish1": {
    resolved: "3bc69b5223e7ee21",
    emitted: "6e4a49d70b570d35",
  },
  "3D lens+balloon finish0": {
    resolved: "03b4111f5d980874",
    emitted: "87a1a56207fb75cf",
  },
  "3D lens+balloon finish1": {
    resolved: "a1afbb88a8b97461",
    emitted: "c53f51b53b76113f",
  },
  "3D lens+plane finish0": {
    resolved: "74c30165026b4989",
    emitted: "91341d638ce9196e",
  },
  "3D lens+plane finish1": {
    resolved: "bdf919de4a9934cf",
    emitted: "a4513cfaabe2d185",
  },
  "3D escape finish0": {
    resolved: "45b732e37233ffbb",
    emitted: "45b732e37233ffbb",
  },
  "3D escape finish1": {
    resolved: "3cbff0834e4e07b8",
    emitted: "3cbff0834e4e07b8",
  },
  "3D escape+balloon finish0": {
    resolved: "9c30049fc8515b60",
    emitted: "58d721115127d974",
  },
  "3D escape+balloon finish1": {
    resolved: "b2fde1cc151ae4d5",
    emitted: "b98b784d9fafaf73",
  },
  "3D escape+plane finish0": {
    resolved: "b5ad6fbe4595fd37",
    emitted: "b561d279dc8505a8",
  },
  "3D escape+plane finish1": {
    resolved: "ca0bc1f642fa74b3",
    emitted: "c975d39f02e7e0b6",
  },
  "3D bulb finish0": {
    resolved: "52c03c36902ed756",
    emitted: "52c03c36902ed756",
  },
  "3D bulb finish1": {
    resolved: "4874ab75db831eec",
    emitted: "4874ab75db831eec",
  },
  "3D bulb+balloon finish0": {
    resolved: "7a8394e699b0a9b5",
    emitted: "7a8394e699b0a9b5",
  },
  "3D bulb+balloon finish1": {
    resolved: "829091730b88f503",
    emitted: "829091730b88f503",
  },
  "3D bulb+plane finish0": {
    resolved: "c6a4713443fd783b",
    emitted: "40a8c5fec38e4c26",
  },
  "3D bulb+plane finish1": {
    resolved: "b7e8dac27c68dd8b",
    emitted: "124b2f903b559393",
  },
  "4D base finish0": {
    resolved: "1faa5443d7485caa",
    emitted: "1faa5443d7485caa",
  },
  "4D base finish1": {
    resolved: "d2be72fc4d28af5f",
    emitted: "ebf0adc4beb672a7",
  },
  "4D balloon finish0": {
    resolved: "aba8832def9fc872",
    emitted: "0d23ec9c7f261087",
  },
  "4D balloon finish1": {
    resolved: "73ffde2749c5800f",
    emitted: "03ed8ae6ce24f137",
  },
  "4D plane finish0": {
    resolved: "e5d93a55c42a7f02",
    emitted: "368d3043c330bb61",
  },
  "4D plane finish1": {
    resolved: "b7fdf1b1f4d92b7b",
    emitted: "71f12f0a7b7105b3",
  },
};
