/**
 * SHA-256 (16-hex-char prefix) of every pattern-off variant's RESOLVED and
 * EMITTED source, measured at the pre-fr-cmtl.5 tree (8f5fb4d, "Unify
 * surface material slot packing") — the genuine pre-pattern baseline the
 * byte-identity tests compare the pattern-off emissions against.
 *
 * How to regenerate (the .5 session's recipe): a git worktree at 8f5fb4d
 * with the main tree's node_modules symlinked, running the same
 * resolved/emitted sweep over every (variant, finish) pair. The hashes are
 * commit-pinned: any pattern-arm byte that leaks into a pattern-off program
 * changes a row here.
 */
export const PRE_PATTERN_SOURCE_HASHES: Record<
  string,
  { resolved: string; emitted: string }
> = {
  "3D affine finish0": {
    resolved: "097981cef9400761",
    emitted: "a4fdd681dc47264a",
  },
  "3D affine finish1": {
    resolved: "c3022b341b1e77e1",
    emitted: "9e1f90076a700bc0",
  },
  "3D lens finish0": {
    resolved: "ed2fe5054418bd96",
    emitted: "e28266a7c828fa25",
  },
  "3D lens finish1": {
    resolved: "e91abdbe15e5c713",
    emitted: "18eb8b947aeeb0c3",
  },
  "3D balloon finish0": {
    resolved: "82afa4616bd7abba",
    emitted: "ba69aeb857797542",
  },
  "3D balloon finish1": {
    resolved: "80da1b0c29647d1e",
    emitted: "df2a058e7005a737",
  },
  "3D plane finish0": {
    resolved: "18187137a9ab6de8",
    emitted: "ea0ce1dd02bd2151",
  },
  "3D plane finish1": {
    resolved: "be9cbf0ebd4ce17f",
    emitted: "b66d5d01859b1da3",
  },
  "3D lens+balloon finish0": {
    resolved: "e947392453028704",
    emitted: "25801d3d495ed535",
  },
  "3D lens+balloon finish1": {
    resolved: "17a33bf2fb6da7b9",
    emitted: "321382de1effda63",
  },
  "3D lens+plane finish0": {
    resolved: "15ee973726ced38a",
    emitted: "a9bc24e4c8730875",
  },
  "3D lens+plane finish1": {
    resolved: "c5862f1813834697",
    emitted: "2692d44fde6357eb",
  },
  "3D escape finish0": {
    resolved: "61a0efcec5dc09f5",
    emitted: "61a0efcec5dc09f5",
  },
  "3D escape finish1": {
    resolved: "dd85e1f2fed7250e",
    emitted: "dd85e1f2fed7250e",
  },
  "3D escape+balloon finish0": {
    resolved: "36d7fc03e67bb6dc",
    emitted: "36d7fc03e67bb6dc",
  },
  "3D escape+balloon finish1": {
    resolved: "dc0751a7efb616d8",
    emitted: "8631084ec06fdfe5",
  },
  "3D escape+plane finish0": {
    resolved: "ac04516fc832eadd",
    emitted: "42c19a34b3f64a5e",
  },
  "3D escape+plane finish1": {
    resolved: "1ad16da4325cc414",
    emitted: "c2022f3604ce185c",
  },
  "3D bulb finish0": {
    resolved: "1d9a96f165b37674",
    emitted: "1d9a96f165b37674",
  },
  "3D bulb finish1": {
    resolved: "7af9d14d07ac1efc",
    emitted: "7af9d14d07ac1efc",
  },
  "3D bulb+balloon finish0": {
    resolved: "2da96775996296fe",
    emitted: "2da96775996296fe",
  },
  "3D bulb+balloon finish1": {
    resolved: "5c498d8b18135c70",
    emitted: "5c498d8b18135c70",
  },
  "3D bulb+plane finish0": {
    resolved: "d954e3cd4fe47c09",
    emitted: "cf12529a62f99ce0",
  },
  "3D bulb+plane finish1": {
    resolved: "85c6d6188383b543",
    emitted: "3869adc11cfe50e0",
  },
  "4D base finish0": {
    resolved: "ab5ad33f4f3e985a",
    emitted: "ab5ad33f4f3e985a",
  },
  "4D base finish1": {
    resolved: "3a24132e8aae206e",
    emitted: "3a24132e8aae206e",
  },
  "4D balloon finish0": {
    resolved: "ee585e7f370af066",
    emitted: "807221ee24c51f56",
  },
  "4D balloon finish1": {
    resolved: "3137a79e48b3b546",
    emitted: "1752502389b12f4c",
  },
  "4D plane finish0": {
    resolved: "51c7bf29e82226ac",
    emitted: "8aba684e43f8c9ea",
  },
  "4D plane finish1": {
    resolved: "a758bb7d9544dffc",
    emitted: "daf4c1ab7ab6ad37",
  },
};
