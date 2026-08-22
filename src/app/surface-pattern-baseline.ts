/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source. Initially measured at the pre-fr-cmtl.5 tree (8f5fb4d,
 * "Unify surface material slot packing"), then advanced for two intentional
 * global shader changes: fr-plxs's invisible terminal-ray alpha code, and
 * the corrected live material B-lane/source comments in the resolved GLSL.
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
    resolved: "a807514dd4e13695",
    emitted: "4c52a02070792f6c",
  },
  "3D affine finish1": {
    resolved: "2e543f5c83372196",
    emitted: "e34017ea588b8e11",
  },
  "3D lens finish0": {
    resolved: "a12b205ffb493b87",
    emitted: "274151ba975b6f98",
  },
  "3D lens finish1": {
    resolved: "8e221c4d07b7ea8b",
    emitted: "49253151ec3b0bfb",
  },
  "3D balloon finish0": {
    resolved: "bb499afd96ec097d",
    emitted: "56babe760f6b1981",
  },
  "3D balloon finish1": {
    resolved: "28e6cecefc162ecf",
    emitted: "7364a2249e792f0d",
  },
  "3D plane finish0": {
    resolved: "aad3cfd441157a78",
    emitted: "801b1f817f00dc1c",
  },
  "3D plane finish1": {
    resolved: "edb95ddf344b1c30",
    emitted: "bc5cf3e13618291f",
  },
  "3D lens+balloon finish0": {
    resolved: "b5ceed82d6b245cb",
    emitted: "5f48fb7522d318a4",
  },
  "3D lens+balloon finish1": {
    resolved: "9b62978993d9d285",
    emitted: "1f500e04ffdbc653",
  },
  "3D lens+plane finish0": {
    resolved: "f6612cf5faae1b42",
    emitted: "180bc54bd8919fe5",
  },
  "3D lens+plane finish1": {
    resolved: "eef69be601e069b2",
    emitted: "cadc34f4b3739f47",
  },
  "3D escape finish0": {
    resolved: "373498edf799eb14",
    emitted: "373498edf799eb14",
  },
  "3D escape finish1": {
    resolved: "f2297708a23d1980",
    emitted: "f2297708a23d1980",
  },
  "3D escape+balloon finish0": {
    resolved: "7defec12a5d03014",
    emitted: "7defec12a5d03014",
  },
  "3D escape+balloon finish1": {
    resolved: "b3fe8c4d55d60af8",
    emitted: "f447a38776e26957",
  },
  "3D escape+plane finish0": {
    resolved: "6bc8749b2c56f09e",
    emitted: "6aa6ece5db6fbb73",
  },
  "3D escape+plane finish1": {
    resolved: "97f312687121aac4",
    emitted: "d471a20213962837",
  },
  "3D bulb finish0": {
    resolved: "c0828ca3f9ed4eec",
    emitted: "c0828ca3f9ed4eec",
  },
  "3D bulb finish1": {
    resolved: "9ec0571cfecd9fa1",
    emitted: "9ec0571cfecd9fa1",
  },
  "3D bulb+balloon finish0": {
    resolved: "a53f6d65a4fc882a",
    emitted: "a53f6d65a4fc882a",
  },
  "3D bulb+balloon finish1": {
    resolved: "8da77cef9c39faa9",
    emitted: "8da77cef9c39faa9",
  },
  "3D bulb+plane finish0": {
    resolved: "2507e8f0cd1e099b",
    emitted: "5270dfaddf648019",
  },
  "3D bulb+plane finish1": {
    resolved: "9f8d66e869f667fe",
    emitted: "4d1a5b9c58580bd8",
  },
  "4D base finish0": {
    resolved: "123c54729c33db40",
    emitted: "123c54729c33db40",
  },
  "4D base finish1": {
    resolved: "e027ec0023f6867b",
    emitted: "e027ec0023f6867b",
  },
  "4D balloon finish0": {
    resolved: "4a5d772c78e361fa",
    emitted: "d94fb4928117819d",
  },
  "4D balloon finish1": {
    resolved: "4d9c47d7d95ccd9c",
    emitted: "d97fe1d05eaef6ea",
  },
  "4D plane finish0": {
    resolved: "bcc6da2887c7bde5",
    emitted: "5309a251633ec9bc",
  },
  "4D plane finish1": {
    resolved: "e7bcba05fa53c14e",
    emitted: "fcc13abbfae64892",
  },
};
