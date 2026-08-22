/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source. Initially measured at the pre-fr-cmtl.5 tree (8f5fb4d,
 * "Unify surface material slot packing"), then advanced for two intentional
 * global shader changes: fr-plxs's invisible terminal-ray alpha code, and
 * the corrected live material B-lane/source comments in the resolved GLSL,
 * and fr-cmtl.8's zero-tap-safe AO identity for provably AO-independent
 * authored finishes.
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
    resolved: "7d10ebcfb9a04148",
    emitted: "38cf84a4d9f804b7",
  },
  "3D affine finish1": {
    resolved: "e7c71261aa0b9bc0",
    emitted: "039e2c00989e3ce6",
  },
  "3D lens finish0": {
    resolved: "a8014508c2af2ed8",
    emitted: "650dae6dea960418",
  },
  "3D lens finish1": {
    resolved: "f0e21f80561061b1",
    emitted: "64f88e0fceee902d",
  },
  "3D balloon finish0": {
    resolved: "29bab4eddf4f328a",
    emitted: "78bd7e9b7c301fda",
  },
  "3D balloon finish1": {
    resolved: "291926567fcdc775",
    emitted: "de769e0686a14d6b",
  },
  "3D plane finish0": {
    resolved: "bb61d07f3a08dc0c",
    emitted: "068160df0b8e2526",
  },
  "3D plane finish1": {
    resolved: "c3d6abd98e876284",
    emitted: "a4ecab82c44f629a",
  },
  "3D lens+balloon finish0": {
    resolved: "62fa675fa34430da",
    emitted: "8dccbd2cc4b64eed",
  },
  "3D lens+balloon finish1": {
    resolved: "7cea242e53ae9b77",
    emitted: "fc83d65dad84c911",
  },
  "3D lens+plane finish0": {
    resolved: "503d47a8ed890d96",
    emitted: "2e758c87fb917efc",
  },
  "3D lens+plane finish1": {
    resolved: "923598b21186a76f",
    emitted: "65125e8aad7ec2d5",
  },
  "3D escape finish0": {
    resolved: "440d3c0418fb0c96",
    emitted: "440d3c0418fb0c96",
  },
  "3D escape finish1": {
    resolved: "ae1ea2aa5197f2bb",
    emitted: "ae1ea2aa5197f2bb",
  },
  "3D escape+balloon finish0": {
    resolved: "bc96b9088d675c0d",
    emitted: "bc96b9088d675c0d",
  },
  "3D escape+balloon finish1": {
    resolved: "9479b5f3d5335773",
    emitted: "40a750ce14adc0de",
  },
  "3D escape+plane finish0": {
    resolved: "c88320a8cf64300f",
    emitted: "f681a3f73850b7b4",
  },
  "3D escape+plane finish1": {
    resolved: "be6078148439f8a4",
    emitted: "e4e8bad202f4e5ba",
  },
  "3D bulb finish0": {
    resolved: "4a86de1d16e4ad24",
    emitted: "4a86de1d16e4ad24",
  },
  "3D bulb finish1": {
    resolved: "f7387ed557687d78",
    emitted: "f7387ed557687d78",
  },
  "3D bulb+balloon finish0": {
    resolved: "0998a602c0a8ec60",
    emitted: "0998a602c0a8ec60",
  },
  "3D bulb+balloon finish1": {
    resolved: "90f73a5bd5777f4d",
    emitted: "90f73a5bd5777f4d",
  },
  "3D bulb+plane finish0": {
    resolved: "6dfde1573ebd8232",
    emitted: "98117c35dc09e4b3",
  },
  "3D bulb+plane finish1": {
    resolved: "ddfbfeb4ba38f78f",
    emitted: "4f6d5e9966c7154b",
  },
  "4D base finish0": {
    resolved: "368f8ced965df527",
    emitted: "368f8ced965df527",
  },
  "4D base finish1": {
    resolved: "f37801efa989be0b",
    emitted: "f37801efa989be0b",
  },
  "4D balloon finish0": {
    resolved: "a24b3cffa045ee6a",
    emitted: "497280377c0de3ac",
  },
  "4D balloon finish1": {
    resolved: "234ea1cf8769f2eb",
    emitted: "0ca046130095c60d",
  },
  "4D plane finish0": {
    resolved: "dee1c078f772dd05",
    emitted: "9d21ce389159cd94",
  },
  "4D plane finish1": {
    resolved: "0a23feda406e2a2c",
    emitted: "9f3bb098486923b5",
  },
};
