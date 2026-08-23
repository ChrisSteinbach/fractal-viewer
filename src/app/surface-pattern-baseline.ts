/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source. Initially measured at the pre-fr-cmtl.5 tree (8f5fb4d,
 * "Unify surface material slot packing"), then advanced for two intentional
 * global shader changes: fr-plxs's invisible terminal-ray alpha code, and
 * the corrected live material B-lane/source comments in the resolved GLSL,
 * fr-cmtl.8's zero-tap-safe AO identity for provably AO-independent
 * authored finishes, and fr-q6ca's second fragment output carrying the
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
    resolved: "b796706cea426a5a",
    emitted: "814be982a8a9b994",
  },
  "3D affine finish1": {
    resolved: "1ed87b486fff452b",
    emitted: "03e229766c5d3ec3",
  },
  "3D lens finish0": {
    resolved: "1038ea2124f48d1a",
    emitted: "2d454b4f05b1c3ab",
  },
  "3D lens finish1": {
    resolved: "5ddb439dd93d17d4",
    emitted: "46d10b3c273d71bb",
  },
  "3D balloon finish0": {
    resolved: "20ca22410439e45f",
    emitted: "114f40fdefc09b20",
  },
  "3D balloon finish1": {
    resolved: "30a65862840819f3",
    emitted: "e391179f5c96ff2f",
  },
  "3D plane finish0": {
    resolved: "3dfe2e75c86f652a",
    emitted: "f093e722feacbeae",
  },
  "3D plane finish1": {
    resolved: "2d347d766809f70b",
    emitted: "97694609cfb4eb08",
  },
  "3D lens+balloon finish0": {
    resolved: "979363a822657f02",
    emitted: "4d42222c937f7ff3",
  },
  "3D lens+balloon finish1": {
    resolved: "9c6ddf5f925ad4e0",
    emitted: "804c054e240e49f2",
  },
  "3D lens+plane finish0": {
    resolved: "685ec5ea653dc4fd",
    emitted: "c4c74a6f6a7e0533",
  },
  "3D lens+plane finish1": {
    resolved: "d8fd90713df8cad8",
    emitted: "cdc35fa1a88fef5a",
  },
  "3D escape finish0": {
    resolved: "6fefaf2c63a4325a",
    emitted: "6fefaf2c63a4325a",
  },
  "3D escape finish1": {
    resolved: "8bd27bc2dfd8394c",
    emitted: "8bd27bc2dfd8394c",
  },
  "3D escape+balloon finish0": {
    resolved: "8b16d1ab1c0100cd",
    emitted: "8b16d1ab1c0100cd",
  },
  "3D escape+balloon finish1": {
    resolved: "07cd7f5b45a85a72",
    emitted: "09637dd9fa99a038",
  },
  "3D escape+plane finish0": {
    resolved: "bad044def349e9d1",
    emitted: "dd14af627048b9fb",
  },
  "3D escape+plane finish1": {
    resolved: "fa004e04e7c106ac",
    emitted: "6b161cd865a9a695",
  },
  "3D bulb finish0": {
    resolved: "680c4e47649557fe",
    emitted: "680c4e47649557fe",
  },
  "3D bulb finish1": {
    resolved: "d757192881c06d26",
    emitted: "d757192881c06d26",
  },
  "3D bulb+balloon finish0": {
    resolved: "c7997b9295b928e2",
    emitted: "c7997b9295b928e2",
  },
  "3D bulb+balloon finish1": {
    resolved: "bf39d3e892dc4cb2",
    emitted: "bf39d3e892dc4cb2",
  },
  "3D bulb+plane finish0": {
    resolved: "1065aa15a1e0cc5f",
    emitted: "a2ff36afd5018b1d",
  },
  "3D bulb+plane finish1": {
    resolved: "db984554a831195f",
    emitted: "a7f9e8aedd683604",
  },
  "4D base finish0": {
    resolved: "0fea9dfa6c5eef47",
    emitted: "0fea9dfa6c5eef47",
  },
  "4D base finish1": {
    resolved: "b5a9284ecd835290",
    emitted: "b5a9284ecd835290",
  },
  "4D balloon finish0": {
    resolved: "f425b9362d55ad74",
    emitted: "922fe06b78df05d6",
  },
  "4D balloon finish1": {
    resolved: "137f573132da758e",
    emitted: "759313ada6a54e47",
  },
  "4D plane finish0": {
    resolved: "ea50070941addaee",
    emitted: "60aecb6d107d00e7",
  },
  "4D plane finish1": {
    resolved: "e9c8cdd5b13c566e",
    emitted: "ff68ea363c17db05",
  },
};
