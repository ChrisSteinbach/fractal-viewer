# Sphere-inversion seed orbits (pre-gate study)

The record behind the proposed Surface family built from ITERATED SPHERE
INVERSIONS: recursively nested pearls, perforated shells and vaults with detail
repeating through their openings, in 3D and native 4D. Nothing here is
production code. The prototype math lives in `scripts/sphere-inversion-orbit.ts`
and the executable record in `scripts/sphere-inversion.harness.ts`; both wait
on the owner's visual gate before any `src/` module, shader, persistence or UI
work begins.

Run:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion.harness.ts
```

It writes `scripts/out/sphere-inversion-3d.png`, `-estimator.png`,
`-compare.png` and `-4d.png` in about 100 s on one CPU core (the Balloon
comparison panel alone is ~50 s). `SPHERE_INV_SIZE=N` sets the panel size; the
figures below are at 320 px (102,400 rays per panel) unless stated.

## The construction

The same definition serves both dimensions; only the vector length changes.

- **Generators.** Closed balls `B_i = B(c_i, r_i)` in `R^n` (`n` = 3 or 4) with
  pairwise disjoint interiors. Tangency is admitted: the minimum generator gap
  `|c_i − c_j| − r_i − r_j` may be 0. Overlap is refused at build. Inversion is
  `I_i(x) = c_i + r_i²(x − c_i)/|x − c_i|²`. In 4D the generators are
  HYPERSPHERES acting on all of `xyzw`; no coordinate is carried passively.
- **Group and fundamental domain.** `G = <I_i>` (a free product of order-two
  reflections in spheres). Its fundamental domain is
  `F = R^n \ ∪ open B_i`, which is unbounded. The tile identity is
  `B_j = I_j(F) ∪ ∪_{l≠j} I_j(B_l)`, up to boundaries.
- **Seed.** `K ∩ F`, where `K` is an intersection of GENERALIZED BALLS: a ball
  or the complement of one. That class is closed under inversion, so every copy
  is exact. The shipped candidate seeds are:
  - a ball `B(0, ρ)` inside the central void (the pearls);
  - a shell `ρ − τ <= |x| <= ρ + τ` crossing the generators (the perforated
    shells);
  - a cap `B(0, ρ)` whose `∩ F` is a sphairahedron;
  - a shell cut by a large complement ball (the vaults).

  A seed sphere passing through a generator centre (a plane image) is refused
  at build.

- **Generator ordering.** It is NOT part of the geometry. Disjoint interiors
  mean at most one ball contains a point, so the fold is order-free except on
  a tangency point, where the lowest index wins.
- **Stopping rule.** An inversion budget `D`, equal to the reduced word length.
- **The object.** The DEPTH-D SEED ORBIT

  `O_D = ∪ { g(K ∩ F) : g a reduced word of length <= D }`.

- **Bounded region.** `O_D ⊂ (K ∩ F) ∪ ∪ B_i`, so the enclosing radius is
  `max(seed reach, max_i |c_i| + r_i)`. Panels are FRAMED on the membership
  reach from `set-extent.ts`, never on that bound, because the generator balls
  themselves are invisible.
- **Native 4D view.** The query is `q = rotorInv · (p, w0)`, the app's
  established rotor/slice lift, identical to `escape-4d.harness.ts`. A slice's
  distance is at least the 4D distance, so a certified 4D bound is a certified
  in-slice bound.

### Seed orbit, not limit set

Every panel depicts `O_D`. The limit set `Λ`, where `O_∞` accumulates, is a
different object with a different remainder argument, and no panel renders an
approximation to it. The prototype has no nested-ball stand-in at the depth cap:
an exhausted fold returns a POSITIVE bound and counts as a non-member. The lace
visible in the near-kissing panels is sub-pixel deep copies of the seed, not
`Λ`. A limit-set preset, like the paper's Figure 4, would need its own
definition, stopping rule and remainder argument before it could be proposed.

### Defined outcomes

| Situation                                           | Outcome                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fold reaches `F` within `D` inversions              | Member iff the folded point is in `K ∩ F`; distance is the transported bound below.                                                                                                        |
| Budget spent while still inside a ball `B_i`        | NOT a member of `O_D`; the bound drops `B_i`'s terms (nothing of `O_D` lies there) and stays positive.                                                                                     |
| Query within `1e-12·r` of a generator centre (pole) | Distance 0, non-member. The bound also decays toward centres (to about half the query's distance from that centre), so a ray aimed exactly at one creeps. No panel showed a pole artefact. |
| Tangent generators                                  | Valid. The depth-2 gap terms vanish at the tangency points only (cusps); measured 0% exhaustion at cube8 kissing, depth 16.                                                                |
| Seed sphere through a generator centre              | Refused at build (plane image).                                                                                                                                                            |
| Numerical limits                                    | f64 throughout. `inversionDistanceLowerBound` carries its `1 + 2^-20` margin. No f32 argument exists yet; that belongs to the shader scoping.                                              |

## Representation verdict: a dedicated estimator is required

The existing per-map vocabulary was tried before proposing a new core, and each
route was rendered or gated in section (d) of the harness.

- **One inversion IS expressible, and that is the closest existing expression.**
  A `spherefold` (fixed radius 1, minimum radius 1e-3) conjugated by the affine
  that takes `B(c, r)` to the unit ball, plus the post-affine that takes it
  back, equals `I(x)` inside the ball and the identity outside. That is exactly
  one IIS fold step.
- **The contractive IFS gate refuses it.** `analyzeSurfaceSystem` reports
  "map N does not contract" for all six maps, with and without a sphere emitter
  as the condensation seed. That is correct, not a gate defect. A whole-space
  inversion has a pole, and even the restricted map is the identity outside its
  ball, so an IFS attractor `A = ∪ f_i(A)` under such maps contains
  `A \ B_i`: it is not the seed orbit.
- **The escape-time chain admits the document and draws a different object.**
  `analyzeEscapeSystem` is `eligible`, but the Mandelbrot-form chain adds the
  query point after every link and renders an escape-time set. Measured: a thin
  tripod spike, membership reach 0.029, fill 0.000%, 6.4% of rays at its own
  fitted frame. It has no seed and no fold into `F`.
- **Balloon** is one inversion of an existing attractor; it never iterates.
- **Space tiling** folds by finite reflection groups in PLANES; a sphere
  inversion group is neither finite nor planar.

What does carry over is `src/fractal/inversion.ts`. `inversionDistanceLowerBound`
is used unchanged as the transport. The generalized-ball image needs a SIGNED
form of `inversionBallScale` (a ball containing the centre maps to a ball
complement), which the prototype restates locally. A production module should
export that signed variant beside the unsigned one rather than restate it a
second time.

## Estimator status

**The transported bound: CERTIFIED lower bound on Euclidean distance to `O_D`,
modulo f64, for disjoint (including tangent) generators. Marched at step scale
1.0 with no damping factor.** A written argument plus a measurement, not yet
the oracle-backed pin the CPU core will need.

The argument:

1. **Covering.** From the tile identity, `O_∞ ∩ F = K ∩ F`,
   `O_∞ ∩ I_j(F) = I_j(K ∩ F)`, and hence
   `O_∞ ⊂ (K∩F) ∪ ∪_j [ I_j(K∩F) ∪ ∪_{l≠j} I_j(B_l) ]`. Each member is a
   generalized-ball intersection or a ball, with exact SDFs; the max of an
   intersection's member SDFs lower-bounds its distance. That gives `L(x)`.
2. **Depth budget.** After folding `k` inversions with last generator `p`, the
   remaining budget is `m = D − k`:
   - the parent's ball `B_p` holds the shallower copies (always counted);
   - any other `B_j` holds copies of depth `>= k + 1` only, so it is skipped at
     `m = 0` and contributes `I_j(K∩F)` without gap balls at `m = 1`;
   - an exhausted fold (`k = D`, inside some `B_i`) drops `B_i`.

   For disjoint non-tangent generators the zero set of `L` is exactly `O_D`,
   and it stays positive on the invisible generator spheres, because the gap
   balls sit strictly inside their parent.

3. **Transport.** Carry `L` back through each inversion with
   `inversionDistanceLowerBound(r, R², d) = r·d/(s + d)`, where `r = |x − c|`
   before the inversion and `s = R²/r`. This is EXACT for a ball. If
   `B(a, d)` is empty about `a = I(x)`:
   - when `s > d`, its image is a ball of centre `c + σ(a − c)` and radius
     `σd`, with `σ = R²/(s² − d²)`, and `x`'s distance to that image's boundary
     is `R²d/(s(s+d)) = r·d/(s+d)`;
   - when `d >= s`, the image is a ball complement and the same expression
     results.

   It is monotone in `d`, so a lower bound transports to a lower bound. Every
   step is a similarity-free conformal map, so no scalar derivative is guessed
   anywhere.

Measured against the EXACT explicit orbit (section (c): every copy of every
reduced word up to depth 4, or 3 for ico12, as exact spheres; about 6,000
off-set queries per arrangement, half uniform in the bound ball and half on
shells 1e-4..1e-1 copy radii outside random copies):

| Arrangement            | Copies | Cert. violations | Cert. p05 / p50 of true distance | Paper factor 1: over% / max | Paper factor 0.08: over% / max |
| ---------------------- | ------ | ---------------- | -------------------------------- | --------------------------- | ------------------------------ |
| oct6 r .62, ball .30   | 937    | 0 / 5991         | 0.476 / 0.953                    | 82.1 / 2.3x                 | 0.0 / 0.19                     |
| oct6 r .70, ball .28   | 937    | 0 / 5985         | 0.375 / 0.939                    | 82.4 / 2.7x                 | 0.0 / 0.21                     |
| oct6 kissing, ball .28 | 937    | 0 / 5983         | 0.369 / 0.940                    | 82.4 / 2.6x                 | 0.0 / 0.21                     |
| cube8 r .57, ball .41  | 3201   | 0 / 5966         | 0.405 / 0.957                    | 86.2 / 2.9x                 | 0.0 / 0.23                     |
| ico12 r .52, ball .47  | 1597   | 0 / 5935         | 0.386 / 0.951                    | 86.6 / 2.6x                 | 0.0 / 0.21                     |

**The Bridges 2016 form (Nakamura & Ahara, Algorithm 2): HEURISTIC.** It is
the own copy's SDF in folded coordinates over the accumulated inversion
Jacobian, times an empirical factor the paper puts "less than 0.08". It sees
only the query's own tile, so at factor 1 it overshoots into neighbouring
copies on 82–87% of queries, by up to 2.9x, and the depth-8 panel shows visible
bites out of pearls. At 0.08 no sampled query overshot (worst 0.23 of the true
distance), but it costs 33.7 steps/ray against the certified bound's 13.2. It
also FATTENS every pearl (the depth-8 factor-0.08 panel), because a factor
inside the DE scales hit acceptance along with the stride. That fattening is
the practical reason the factor cannot be copied: it is a geometry change, not
just a cost. Neither the factor nor the local derivative is advertised as a
certificate anywhere here.

**Exhaustion.** 0.0% exhausted rays on every panel of every sheet (600-step
budget, `de-preview.ts`'s acceptance), including cube8 kissing at depth 16. The
panel budget does not measure the shipped tracer's tier budgets; that belongs to
the cost measurement on verified hardware.

## The sheets (320 px)

H = hit % of rays, S = steps/ray, ms = one CPU core. Reach and fill come from
`set-extent.ts` against the membership oracle, at a 32,768-point framing budget.

### 3D beauty candidates (`sphere-inversion-3d.png`)

Arrangements: `oct6` = `±e_x,±e_y,±e_z` (tangent at `r = d/√2`); `cube8` =
cube vertices at distance 1 (tangent `1/√3`); `ico12` = icosahedron vertices at
distance 1 (tangent 0.5257).

| Panel                          | Seed             | D   | H    | S    | ms   | Reach | Fill    |
| ------------------------------ | ---------------- | --- | ---- | ---- | ---- | ----- | ------- |
| Pearls oct6 r .70              | ball .28         | 8   | 51.7 | 13.2 | 900  | 0.712 | 0.995%  |
| Pearls oct6 kissing, axis view | ball .28         | 10  | 46.3 | 11.8 | 1000 | 0.703 | 1.038%  |
| Pearls cube8 r .57             | ball .41         | 8   | 41.8 | 11.2 | 900  | 0.819 | 2.896%  |
| Pearls ico12 r .52             | ball .47         | 6   | 60.3 | 14.2 | 1700 | 0.853 | 4.858%  |
| Pearls cube8 kissing, top view | ball .42         | 12  | 43.7 | 8.5  | 700  | 0.815 | 3.201%  |
| Lace shell ico12 r .52         | shell 1 ± .03    | 6   | 71.4 | 8.3  | 1000 | 1.030 | 2.573%  |
| Lace shell cube8 r .57         | shell 1 ± .03    | 7   | 68.9 | 7.1  | 600  | 1.030 | 3.012%  |
| Cap oct6 r .66                 | cap 1.15         | 6   | 66.0 | 7.9  | 400  | 1.150 | 24.942% |
| Vault inside oct6 r .70        | half shell ± .06 | 8   | 96.5 | 11.1 | 700  | —     | 2.872%  |
| Dome oct6 r .66                | half shell ± .06 | 6   | 63.9 | 12.5 | 900  | 1.060 | 3.354%  |
| Vault inside ico12 r .50       | half shell ± .06 | 5   | 96.6 | 7.3  | 900  | —     | 3.687%  |
| Vault inside cube8 r .57       | half shell ± .06 | 7   | 96.4 | 7.9  | 600  | —     | 3.784%  |

Interior vaults run with the shadow off (a closed shell shadows its own
inside), and the domes and vaults with fog off (`de-preview.ts` fogs on absolute
distance and buried the lit far wall). Depth progression on pearls oct6 r .70:
H 74.7/35.5/38.2/48.0/51.7 and S 3.7/6.6/9.8/13.2/13.2 at D = 0/1/2/4/8. Steps
saturate by depth 4, because deeper copies are sub-pixel.

### Comparison (`sphere-inversion-compare.png`)

At the same eye offset and zoom, in marching radii. Candidate panels as above.

- Shipped Mandelbox cube: H 42.6, S 8.8, 300 ms.
- Shipped B3 tiling of `octahedronFlake`: H 26.5, S 9.6, 3.1 s.
- Shipped Balloon of `mengerSponge` at `R = 0.7`: H 49.5, S 21.2, 49.6 s.
- Existing vocabulary (spherefold chain): H 6.4, S 5.1, 1.9 s.

### Native 4D (`sphere-inversion-4d.png`)

Arrangements: `cross8` = `±e_k` for k = x,y,z,w (the 16-cell; the
eight-hypersphere candidate); `cell24` = permutations of `(±1,±1,0,0)/√2`
(twelve centres at `w = 0`, twelve at `w = ±0.707`); `tess16` =
`(±½,±½,±½,±½)`. Each group is framed at ONE radius. Three membership columns
(131,072-point cloud) are measured against the group's first pose:

- IoU;
- containment: the share of this pose's members that are reference members;
- copy containment: the same, over members whose fold spent at least one
  inversion.

**Two exact reductions, pinned.**

- **The deliberate flat embedding** (oct6 r .70 in `R^4`, every centre at
  `w = 0`, 4-ball seed) reproduces the 3D object BIT FOR BIT at `w = 0`: 75,937
  queries (40,000 uniform plus a 33³ grid through walls and centres), 0
  estimate and 0 membership mismatches, byte-identical 120 px panel.
- **An identity slice is passive by construction.** If every generator either
  has its centre in the hyperplane or its ball misses it, the in-plane
  inversions preserve the slice and the others never act on a slice point. The
  slice is then exactly the in-plane sub-arrangement's 3D orbit. Measured:
  cell24 shell vs its cuboctahedral twelve, and cross8 kissing vs oct6 kissing,
  IoU 1.000 and 0.0% pixel difference. A genuinely non-flat slice therefore
  needs a generator ball that meets it with its centre OFF it, which the rotor
  and offset poses supply.

| Group, pose                       | H    | S    | IoU   | Contain | Copy contain | Reading          |
| --------------------------------- | ---- | ---- | ----- | ------- | ------------ | ---------------- |
| flat, identity                    | 51.7 | 13.2 | 1.000 | 1.000   | 1.000        | = 3D             |
| flat, `w0` .15                    | 6.8  | 9.5  | 0.274 | 1.000   | 1.000        | passive erosion  |
| flat, xw .40                      | 28.6 | 10.3 | 0.765 | 1.000   | 1.000        | passive erosion  |
| cross8 kiss, identity             | 58.7 | 13.6 | 1.000 | 1.000   | 1.000        | = oct6 kiss      |
| cross8 kiss, xw .15               | 41.5 | 14.4 | 0.875 | 1.000   | 1.000        | erosion          |
| cross8 kiss, xw .30               | 38.3 | 12.8 | 0.766 | 0.992   | 0.983        | erosion          |
| cross8 kiss, yw .6 zw .3          | 21.3 | 10.1 | 0.577 | 0.985   | 0.947        | mostly erosion   |
| cross8 kiss, `w0` .10             | 20.4 | 13.0 | 0.514 | 0.999   | 0.998        | erosion          |
| cross8 kiss, xw .3 `w0` .15       | 20.1 | 14.3 | 0.333 | 0.957   | 0.840        | some new copies  |
| cell24 r .49 shell, identity      | 73.5 | 7.6  | 1.000 | 1.000   | 1.000        | = cuboct12 shell |
| cell24 shell, xw .30              | 73.6 | 6.8  | 0.651 | 0.734   | 0.512        | NEW arrangement  |
| cell24 shell, `w0` .30            | 65.9 | 6.9  | 0.253 | 0.351   | 0.240        | NEW arrangement  |
| cell24 shell, `w0` .60            | 41.2 | 9.4  | 0.000 | 0.000   | 0.000        | NEW, nearly bare |
| tess16 kiss, `w0` .30 (reference) | 26.6 | 8.4  | 1.000 | 1.000   | 1.000        | —                |
| tess16 kiss, `w0` .45             | 19.1 | 13.0 | 0.240 | 0.878   | 0.806        | NEW copies       |
| tess16 kiss, xw .5 `w0` .10       | 25.3 | 7.0  | 0.484 | 0.565   | 0.472        | NEW arrangement  |
| tess16 kiss, xw .5 yw .4 zw .3    | 26.7 | 9.6  | 0.468 | 0.549   | 0.511        | NEW arrangement  |

All 0.0% exhausted, 0.9–2.1 s per panel. The harness pins the split:

- cell24 shell and tess16 poses must read IoU and copy containment below 0.95;
- the cross8 poses must read IoU below 0.95 AND copy containment above 0.8.

IoU alone cannot tell the two apart: the passive offset drops it to 0.274.

**The eight-hypersphere candidate is the measured weak point.** Its rotor and
offset slices of the kissing cross8 mostly ERODE the octahedral lace (copy
containment 0.84–1.00), which is the flat embedding's behaviour rather than new
arrangement. Its ±w hyperspheres reach these slices too rarely to matter. The
genuinely non-flat fixtures are the cell24 perforated shell and tangent tess16.

## Assessment for the owner's gate

This is the author's reading of the sheets, recorded so the owner's own verdict
has something concrete to agree or disagree with.

- **3D pearls (striking, distinct).** The near-kissing octahedral, cube and
  icosahedral pearls grow curved Kleinian lace arches along the tangency
  circles. The kissing axis view reads as a lace cross, and the kissing cube
  top view as a lace triangle framing the pearls. Nothing on the comparison row
  resembles them: the Mandelbox cube is fine texture on a solid, the tiling is
  discrete flake copies, and the Balloon is a Menger echo with square windows.
  Weaknesses: the central seed ball dominates, pearls are plain spheres until
  materials arrive, and the lace resolves to sub-pixel dust at this panel size.
- **Interior vaults (the most novel image).** Nested circular windows with lace
  through every opening, the brief's "detail repeating through openings".
  Weaknesses: they need the shadow off in this single-light marcher, and the
  exterior dome read poorly (ragged rim).
- **Lace shells and the cap (readable, least distinct).** They read as
  medallioned dice, the family's closest approach to the Mandelbox cube's
  carved-medallion solid.
- **Native 4D (genuine but less striking).** The cell24 shell and tess16 slices
  change arrangement under rotor and offset. They read as rosette dice and
  sparse pearls, not as the 3D lace. The eight-hypersphere candidate barely
  changes (above).

**Candidate domains for the gate to consider, not a public control range.**

| Parameter         | Candidate range                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Generator radius  | 0.9–1.0 of tangent (the lace needs near-kissing)                                              |
| Ball seed         | up to the central void                                                                        |
| Shell thickness   | 0.03–0.06                                                                                     |
| Depth             | 6–12 (3D), 5–10 (4D)                                                                          |
| Arrangements (3D) | oct6, cube8, ico12                                                                            |
| Arrangements (4D) | cell24 shell and tess16 kissing; cross8 ball only if a pose search finds genuinely new slices |

Cost and exhaustion on the shipped tracers are unmeasured and belong to the
verified-hardware step.

## Gate verdict (2026-09-14, delegated)

The owner was unavailable and delegated this call to the agent running the
program; it was made from the sheets above, not the owner's own review, and
stands until the owner ratifies or overturns it.

- **PASS — production integration proceeds.** The 3D near-kissing pearls and
  the interior vaults are striking and share nothing with the comparison row
  (Mandelbox texture on a solid, discrete tiling flakes, Balloon's square
  windows). They are the family's primary subjects. Lace shells and the cap are
  admitted as secondary subjects. The exterior dome is not a preset subject.
- **Representation: the dedicated seed-orbit estimator.** The existing
  vocabulary's closest expressions are refused by the contractive gate or draw
  a different object (the escape-chain tripod), so a new 3D/4D core is
  required and must be disclosed as one.
- **Estimator: the transported bound, marched at step scale 1.0.** The
  Bridges 2016 damping factor is rejected as a geometry change, not just a
  cost; neither it nor a local derivative is advertised as a certificate.
- **Object: the depth-D seed orbit.** No limit-set preset is admitted.
- **4D: feasible and genuine, NOT yet striking — a CONDITION, not a
  deferral.** The cell24 shell and tess16 fixtures change under rotor and
  offset slice, and the flat embedding reduces bit for bit, so parity is
  achievable; but their slices read as sparse pearls and dust. A native 4D
  beauty search (arrangements not reducible to 3D sub-arrangements under
  axis slices, w-offset generator centres, seeds that cross hyperspheres) must
  find at least one striking native 4D subject before presets are authored.
  It does not block the CPU core, the persistence or the shaders. If it fails,
  the family stays unfinished; it does not ship 3D-first.
- **4D condition MET (2026-09-15, delegated).** The 600-cell interior vault
  and medallion sphere (next section) hold the 3D vault's and lace shell's
  strength under w offset and rotor on the 320 px winners sheet; the lace
  snowflakes are genuine but dusty off identity and are not a primary 4D
  subject. The 600-cell's 120 generators are now a scoping input for the
  shader routes, not an afterthought.
- **Candidate domains** are the table above, subject to the verified-hardware
  cost measurement. Known weaknesses the controls must address: the central
  seed dominating (seed size), and lace dissolving into sub-pixel dust
  (depth/refinement).

## Native 4D beauty search (2026-09-15)

The search the gate verdict made a condition of preset authoring. It keeps
the construction unchanged: disjoint (tangent-allowed) generator
hyperspheres, generalized-ball seeds, the depth-D seed orbit, the certified
transported bound at step scale 1.0 and the app's rotor/slice lift. It
searches only arrangements, seeds, poses and cameras.

Run (panels at 128 px unless stated; `SI4_SHARD`/`SI4_SHARDS` split a round
across processes):

```bash
SI4_ROUND=r1 npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion-4d-search.harness.ts
SI4_ROUND=r2 ...   SI4_ROUND=r3 ...   SI4_ROUND=r4 ...
for p in ref 0 1 2; do SI4_ROUND=win SI4_SIZE=320 SI4_WIN_PART=$p npx vitest run ... & done; wait
SI4_ROUND=win SI4_SIZE=320 SI4_WIN_PART=combine npx vitest run ...
```

It writes `scripts/out/sphere-inversion-4d-search-r{1,2,3,4}-s*.png` and
`scripts/out/sphere-inversion-4d-winners.png`.

### Why slices dust

- **Caps shrink.** A slice at height `h` off a hypersphere's centre is a
  sphere of radius `√(r² − h²)`. The copies of an orbit spread through all
  four dimensions, so most copies that meet a given slice meet it as small
  caps.
- **Lace is a curve, and a hyperplane meets a curve in points.** The 3D lace
  arches are where deep copies accumulate on circles through the tangency
  points of mutually tangent generator triples. Each circle lies in the
  2-plane of its three centres. A generic hyperplane meets it in at most two
  points, which is dust. An arch survives whole only in a slice that contains
  all three centres, and there the slice is locally the passive in-plane
  sub-arrangement.
- **Symmetric axis slices are passive.** This was already pinned by the gate
  sheet.
- **A ball seed's own slice dominates.** The central 4-ball slices to a large
  ball at every pose, while its copies are small 4-balls that mostly miss the
  slice. Every exterior ball-seed panel of round 1 read as one big sphere with
  pearls and dust around it.

What survives is DENSITY plus SURFACE SEEDS. The 600-cell's 120 hyperspheres
put many generators across every slice at a spread of heights. A 3-sphere
shell's slice is a 2-sphere shell, and every generator that meets it cuts a
window whose size records that generator's height off the slice.

### Instruments

Each pose is measured beside the gate sheet's cloud columns (IoU `I0` and copy
containment `K0` against the candidate's first pose):

- **off**: the share of copies, over a membership cloud and over HIT PIXELS,
  whose fold word uses a generator centred off the slice.
- **sub**: IoU against the EXPLICIT 3D sub-arrangement, meaning the in-plane
  generators acting on the seed's own slice.
- **vs3D**: the percentage of pixels whose colour differs from that
  sub-arrangement rendered through the same camera. Its floor on passive
  identity slices is 0.2–9.6%, because the step-count AO and the shading taps
  read the 4D bound rather than membership.
- **word0**: the share of copy pixels whose fold word at the same in-slice
  point is IDENTICAL under the first pose. Erosion keeps every word. It was
  added because the other columns cannot judge lace: lace has no volume, so
  its cloud copy share reads 0.00 and `K0` is vacuous, and a pure offset puts
  every centre off the slice, so `off` is 1 by construction. Calibrated on the
  gate's flat embedding (oct6 r .70 at `w = 0`): its passive `w0` .15 reads
  word0 **1.00**, its `xw` .40 reads 0.95, and its identity reads vs3D 0.0%.

Every panel of every round was **0.0% exhausted** (600-step budget).

### What was tried

| Round | Candidates                                                                                                                                                                                                                                                                                                                                                                                                              | Reading                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Twelve families under one seven-pose sequence: cell24 kissing (ball .45; ball offset to `w` .25); the dual 24-cell `cross8 ∪ tess16` kissing and with mixed radii .6/.4; the 600-cell with a ball and with a shell; Hopf-linked 6+6 necklaces; 6×6 and 5×5 Clifford-torus duoprisms; the oct6 kissing clique in `w = 0` plus eight alternating cutters at `w = ±.3`; 20 random S³ centres; ico12 in `w = 0` plus tess16 | Every ball-seed exterior was one dominant seed sphere with sparse pearls and dust. The in-plane-clique design keeps its 3D lace only where it is passive and erodes to nothing by `w0` .15 (H 6%). Duoprisms, Hopf rings and random arrangements read as a bare seed ball with a few pearls. Only the 600-cell kept structure: lace fragments around the ball, and a rich medallion sphere as the shell (sub IoU 0.66–0.77, `K0` 0.22–0.66). |
| 2     | The 600-cell with balls .45/.30, shells .9/1.0/1.1, its kiss slice `w0 = 1/(4φ)` (where the equatorial icosidodecahedron's caps kiss the next layer's), the snub 24-cell (96 centres), and interior vaults at the gate's camera                                                                                                                                                                                         | The .30 ball's identity is a striking icosidodecahedral lace CAGE, but it is passive. The shells read as medallion or lace-embossed spheres and are genuine. The snub 24-cell reads the same, with less. The gate's vault camera faced the light head-on (inward normal · light ≈ 0.9) and washed the small windows to white.                                                                                                                |
| 3     | Near-identity lace poses for 600-cell balls .20/.30; close shell cameras; two grazing-lit vault cameras                                                                                                                                                                                                                                                                                                                 | The lace cage breaks into snowflake lace at `w0` .03–.10 (vs3D 22–36% against a 10% floor). The close camera B on the .9 cut shell is a pearl-window vault (24–44%). The 1.1 shell is a medallion sphere (37–49%).                                                                                                                                                                                                                           |
| 4     | word0 on the three winners and the flat control                                                                                                                                                                                                                                                                                                                                                                         | See the subjects below.                                                                                                                                                                                                                                                                                                                                                                                                                      |

### The three native 4D subjects (`sphere-inversion-4d-winners.png`)

All three use the 600-cell's 120 vertices at unit distance as centres, with a
uniform radius as a fraction of the kissing radius `1/(2φ) ≈ 0.309`. Each
sheet row is the pose/slice sequence the preset's rotor and slice sliders
reveal. The first column is the identity, which is PASSIVE: the equatorial
slice holds the 30 icosidodecahedral centres, and the nearest off-slice layer
is exactly tangent at the kissing radius and misses at these fractions. The
genuine slices are the other columns. The first row is the 3D bar at the same
320 px: kissing oct6 pearls (axis view), kissing cube8 pearls (top view), the
oct6 interior vault and the ico12 lace shell.

`WKISS` is `w0 = 1/(4φ) ≈ 0.1545`. Rotor angles are radians, composed in the
order listed. Cost is one CPU core at 320 px, four processes in parallel.

1. **Pearl-window vault** — radius 0.99 × kissing; seed a shell
   `0.9 ± 0.04` cut by the complement of `B(10.25·û, 10)`, with
   `û = (0.35, 1, 0.55, 0)/|·|`; depth 5. Interior camera: eye
   `(−0.21, −0.41, 0.19)`, target `(−0.42, −0.82, 0.38)`, zoom 0.85, shadow
   and fog off, marching ball = bound radius 1.306. Sequence: ID → `w0` .08 →
   WKISS → `xw` .3 with `w0` .1.

   | Pose        | H     | S   | ms    | off px | word0 | vs3D  | sub IoU | K0   |
   | ----------- | ----- | --- | ----- | ------ | ----- | ----- | ------- | ---- |
   | ID          | 99.7  | 5.3 | 5,900 | 0.00   | 1.00  | 2.5%  | 1.000   | 1.00 |
   | `w0` .08    | 100.0 | 5.2 | 8,300 | 1.00   | 0.35  | 39.0% | 0.608   | 0.75 |
   | WKISS       | 100.0 | 5.3 | 7,500 | 1.00   | 0.44  | 43.5% | 0.685   | 0.50 |
   | xw .3 w0 .1 | 100.0 | 5.2 | 7,300 | 1.00   | 0.39  | 37.5% | 0.669   | 0.64 |

2. **Medallion sphere** — radius 0.99 × kissing; seed a shell `1.1 ± 0.03`;
   depth 5. Exterior gate camera (eye offset `(1.1, 0.8, 1.3)`, zoom 0.6),
   framed at membership reach, R 1.198. Sequence: ID → WKISS →
   `xw .4, yw .3, zw .2` → `xw` .3 with `w0` .1.

   | Pose              | H    | S   | ms     | off px | word0 | vs3D  | sub IoU | K0   |
   | ----------------- | ---- | --- | ------ | ------ | ----- | ----- | ------- | ---- |
   | ID                | 72.8 | 7.0 | 9,100  | 0.00   | 1.00  | 0.2%  | 1.000   | 1.00 |
   | WKISS             | 71.6 | 7.2 | 11,600 | 1.00   | 0.68  | 26.5% | 0.469   | 0.24 |
   | xw .4 yw .3 zw .2 | 73.9 | 7.3 | 11,200 | 1.00   | 0.03  | 32.0% | 0.519   | 0.32 |
   | xw .3 w0 .1       | 72.9 | 7.3 | 10,500 | 1.00   | 0.67  | 29.9% | 0.508   | 0.37 |

3. **Lace snowflakes** — radius 0.995 × kissing; seed the ball `B(0, 0.20)`;
   depth 7. Exterior gate camera, framed R 0.998. Sequence: ID (the passive
   icosidodecahedral lace cage) → `w0` .03 → `w0` .06 → `xw` .1 with
   `w0` .04. `K0` and the cloud columns are vacuous here (no volume); word0
   is the evidence.

   | Pose         | H    | S    | ms     | off px | word0 | vs3D  |
   | ------------ | ---- | ---- | ------ | ------ | ----- | ----- |
   | ID           | 33.8 | 17.2 | 41,500 | 0.00   | 1.00  | 9.5%  |
   | `w0` .03     | 24.3 | 18.9 | 28,100 | 1.00   | 0.25  | 34.4% |
   | `w0` .06     | 18.8 | 18.2 | 24,300 | 1.00   | 0.13  | 25.3% |
   | xw .1 w0 .04 | 24.3 | 18.2 | 26,200 | 1.00   | 0.36  | 33.1% |

   The word0/vs3D figures in the lace and the other tables are the 128 px
   round-4 measurements; H/S/ms are the 320 px sheet's.

**Genuineness, stated once for all three.** A genuine column has an
off-slice copy-pixel share of 1.00. Its fold words match the identity pose at
only 3–68% of copy pixels, where erosion reads 95–100% on the calibrated flat
control. It differs from its explicit 3D sub-arrangement on 25–44% of pixels,
against a 0.2–9.6% passive floor, and its membership IoU against that
sub-arrangement is 0.47–0.69 wherever volume exists to measure.

### Verdict

- **Pearl-window vault: meets the 3D bar.** Nested circular windows hold
  pearl rosettes, and further windows open inside those rosettes. Window
  sizes and pearl counts change with the slice, which the 3D vault cannot do,
  because in 4D a window's size is its generator's height off the slice. It
  has fewer lace arches than the oct6 vault: its deep structure is pearls
  rather than lace tetrahedra. Recommended as the family's primary native 4D
  subject.
- **Medallion sphere: comparable to the 3D lace shell.** It is a secondary
  subject, and the stronger of the two: dozens of medallions over a round body
  instead of the ico12 shell's dice. The double rotation makes the medallions
  asymmetric, holding 2, 3, 4 or 5 pearls.
- **Lace snowflakes: genuine, NOT at the bar in its genuine poses.** The
  identity cage is the most striking 600-cell image, but it is 3D-reducible.
  Offsets of 0.03–0.06 break it into lace stars and fragments with dust
  between them, which is exactly the "lace is a curve" argument above. It is
  worth a preset whose DEFAULT is the passive cage, with the slice slider
  revealing the snowflakes, disclosed as such. Depth 7 over 120 generators is
  also the costliest panel measured (24–42 s CPU at 320 px, S 17–19).

The gate condition is therefore met by the vault, and supported by the
medallion sphere. What is still owed: shipped-tracer cost for 120 generators,
which is a production kernel question (the GLSL tracers' 24-slot per-map uniform arrays could not hold them), and the owner's ratification.

### Failures worth recording

- **Clifford-torus duoprisms (6×6, 5×5) and Hopf-linked necklaces.** Their
  symmetric slices are passive, and every genuine slice left the seed ball
  alone with 1–5% copy volume.
- **In-plane kissing clique plus off-plane cutters** (oct6 kissing at `w = 0`,
  eight cutters at `(±.75)³` with `w = ±.3`, r .42). The lace is in-plane and
  so passive, and it vanishes by `w0` .15. Designing lace INTO a slice
  reproduces a 3D arrangement by the argument above.
- **Random S³ arrangements** (20 centres, 0.98 × kissing). Genuine by every
  column and visually the dullest: a bare ball with a handful of pearls.
- **The 24-cell in both orientations, mixed radii and a w-offset seed.**
  Genuine at most poses, still sparse pearls and dust. Too few generators per
  slice.
- **Ball seeds generally.** The seed's own slice dominates the frame, which is
  the gate's "central seed dominating" weakness in 4D form. Shrinking the seed
  helps only where the passive lace remains.
- **The gate's vault camera on the 600-cell.** Head-on light washes out the
  small windows. A camera lit at grazing incidence and close to the wall is
  required.

## CPU core (2026-09-15)

The production CPU core that follows the gate. Modules:

- `src/fractal/sphere-inversion.ts` — the shared vocabulary: authored form,
  resolver, construction gate, covering tables, hit record, and the transport
  and cutoff scalars.
- `src/fractal/sphere-inversion-de.ts` and `sphere-inversion-de-4d.ts` — the
  estimator twins; only the vector arithmetic is duplicated.
- `src/fractal/sphere-inversion-oracle.ts` — the independent explicit-orbit
  oracle.
- `scripts/sphere-inversion-oracle.harness.ts` — the increased-depth
  reference.

Persistence and Surface eligibility are now wired (section "Persistence, scene dimension and Surface routing" below); no shader route exists yet.

### Authored form and resolver

| Field            | Default                                             | Domain (outside it: REFUSED with a reason)                                       |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `arrangement`    | none (required)                                     | a registry id: `oct6`, `cube8`, `ico12`, `cell24`, `tess16`, `cross8`, `cell600` |
| `radiusFraction` | 0.99                                                | `(0, 1]` of the arrangement's tangent radius; 1 is kissing (degraded)            |
| `depth`          | 8                                                   | integer `[0, 32]` (structural cap, not a public range)                           |
| `seed.kind`      | `ball`                                              | `ball`, `shell`, `cutShell`                                                      |
| `seed.size`      | ball .28, shells 1                                  | `> 0`; a ball may cross the generators (its seed is `K ∩ F`)                     |
| `seed.thickness` | shell .03, cut shell .06                            | `(0, size)`                                                                      |
| cut fields       | direction (.35, 1, .55), w 0, offset .25, radius 10 | direction nonzero; `w` nonzero only in 4D; radius `> 0`; `                       | offset | < size + thickness` |

Every arrangement puts its centres at distance 1, so lengths are absolute. The
registry is extensible: a new id is one entry. The resolver collects every
reason, never clamps, and never mutates the authored block. It then runs the
construction gate, which refuses overlapping generators, a seed sphere whose
depth-1 image scale reaches 1e6 (a plane image), a seed with no bounded
member, and a bounded member inside one closed generator ball (an empty orbit;
sufficient, not necessary). Tangent generators are DEGRADED: still certified,
still step scale 1, with a cusp disclosure. The two decisions to review:

- **`ball` versus `cap`: MERGED** into one `ball` kind (see "One `ball` seed kind" below).
- **Degraded means tangency.** The primary presets sit at 0.99, not 1.

### What is certified

For generators with pairwise disjoint interiors (tangency included) and a
seed of generalized balls with no depth-1 plane image — exactly what the gate
admits — a positive return is a lower bound on the Euclidean distance to
`O_D`, modulo f64, marched at step scale 1. A return `<= 0` is a MEMBER SIGNAL
in folded coordinates, not a signed distance. No damping factor or local
derivative appears anywhere. The f32 argument belongs to the shader mirror.

The cutoff follows `surface-de.ts`'s contract. An exit is taken only after
transporting the RUNNING minimum, which is an exact bound on the part of the
cover already scanned, so no cutoff-shortened distance ever reaches
`inversionDistanceLowerBound`. A folded threshold (the transport's monotone
inverse) decides only when an exit is tried.

### Attribution

`sphereInversionHitInfo` / `sphereInversionHitInfo4` return, beside a `d`
bit-identical to the plain estimate: the fold status (domain, exhausted,
pole), the fold depth, the word length of the winning covering term (fold
depth, +1 for a copy, +2 for a gap ball), that word's first and last
generator, and the binding seed member (−1 for a generator wall, a gap ball or
a pole). The cost is one member scan of the winning term. `boundingRadius`
(origin-centred, the full 4D radius in 4D) is the march entry sphere.

### Defined outcomes as implemented

| Situation                    | Implemented outcome (each has its own test in 3D and 4D)                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Pole                         | `d = 0`, status pole, not a member; just off the centre positive and sound      |
| Budget spent inside a ball   | status exhausted, not a member, positive and at most the true distance          |
| Kissing tangency point       | `d = 0` without membership, true distance positive: a stall, never an overshoot |
| Seed sphere through a centre | refused when the DE is built (plane image)                                      |
| Overlapping generators       | refused when the DE is built                                                    |
| Far field                    | finite; between `                                                               | p   | − boundingRadius` and the seed term |

### Oracle and verdict

The oracle enumerates every reduced word as an exact intersection of
generalized balls and finds the true distance by enumerating the critical
points of `|p − ·|` on every member-sphere intersection of size `<= n`,
pruned to spheres within the running best. Its own tests pin primitive images
against raw point inversion, membership against pointwise word images, and
distances against attained feasible points plus near-sphere sampling that
never beats them.

Unit tests: seven 3D fixtures (oct6 r .70 and kissing, cube8 kissing, ico12
.99, a cube8 shell, an oct6 generator-crossing ball, an ico12 vault) and five 4D fixtures (tess16
and cross8 kissing, the cell24 shell in general position and on an xw .3 /
`w0` .15 lifted slice, a w-tilted tess16 cut shell): 0 violations. The
increased-depth sheet: 0 violations on every row. Its figures are in
`docs/harness-sheets.md`'s `sphere-inversion-oracle` entry.

Tightness differs from the pre-gate table (p50 0.94–0.96 there, 0.64–0.93
here) because this query set puts half its samples on rays toward pieces at
down to 1e-5 of the ray, where the depth-budget and gap terms bind; it is a
harder sample, not a looser bound.

### 4D reductions

- **Flat embedding.** oct6 r .70 at `w = 0` with a 4-ball seed, depth 8,
  queried at `w = 0`: the estimate equals the 3D estimator BIT FOR BIT (6,000
  uniform points plus a 17³ lattice through walls and centres), with identical
  membership and attribution. Each fourth-coordinate term is appended last and
  is an exact `+ 0`.
- **Non-flat.** tess16 kissing at `w0` .3 holds members whose fold spent at
  least one inversion outside the seed's own slice, though no centre lies in
  that hyperplane, so the only 3D reduction is the bare seed slice. The cell24
  shell's membership changes under an xw .3 rotation and differs from its
  four-generator in-hyperplane 3D sub-arrangement; its estimate moves under a
  `w0` offset.

### Slab (`halfExtent`): refused

A thick slice renders the projected shadow of `O_D ∩ {|w − w0| <= h}`. The
trivially sound `d(p, w0) − h` is a lower bound, but its zero set is the
`h`-thickening of the slice in every 3D direction, a different object; a test
exhibits a point `h/2` outside the shadow that it accepts. The exact route
would transport the segment's enclosing ball through each inversion (exact by
`inversionBallScale`), but a ball straddling a generator sphere belongs to two
fold branches, which needs the branch enumeration this fold does not have. The
4D estimator therefore takes no `halfExtent`, and a host must hold the slice
thickness at zero for this family.

## The 600-cell in the registry (2026-09-15)

`cell600` is now a registry arrangement: the 120 unit vertices (8 axis units,
16 `(±½)⁴`, 96 even permutations of `(±φ, ±1, ±1/φ, 0)/2`), kissing radius
`1/(2φ) ≈ 0.309`. The unit test checks 120 distinct unit vertices with
exactly 12 nearest neighbours each at the edge `1/φ`. The two qualifying
native 4D subjects are ordinary authored blocks and resolve eligible:

- pearl-window vault:
  `{arrangement: "cell600", seed: {kind: "cutShell", size: 0.9, thickness: 0.04}, depth: 5}`
  (the default radius fraction .99 and the default cut, direction
  `(.35, 1, .55)`, offset .25, radius 10);
- medallion sphere:
  `{arrangement: "cell600", seed: {kind: "shell", size: 1.1, thickness: 0.03}, depth: 5}`.

**Oracle.** Depth 2 is 14,401 pieces and costs about 170 ms per oracle query,
so the unit tests pin DEPTH 1 (121 pieces): the vault on the usual half-uniform,
half-ray-targeted queries, and the medallion on those plus 60 queries on the
outer shell sphere just outside a crossing generator, where a medallion meets
its wall. 0 violations. The increased-depth sheet's section (c) carries D0–D2
(300/300/60 queries): 0 violations; estimate/true p05 0.39–0.40 and p50
0.70–0.85 at D2.

**CPU cost per query** at the subjects' depth 5 (section (c), one core;
uniform in the bound ball / the near set `0 < d < 0.01` on the shell):

| Subject                       | Uniform us/eval | Near us/eval |
| ----------------------------- | --------------- | ------------ |
| cell600 vault D5              | 3.5–3.9         | 2.4–2.7      |
| cell600 medallion D5          | 2.4–2.5         | 1.5–1.7      |
| oct6 pearls D8 (3D, scratch)  | 0.35            | 0.18         |
| ico12 shell D6 (3D, scratch)  | 0.43            | 0.36         |
| cell24 shell .98 D5 (scratch) | 0.63            | 0.40         |

The 120-generator subjects cost 4–9x the 3D subjects and about 4–6x the
shipped fold's 0.633 us/eval. The cost is the fold's linear generator scan
plus the covering scan (`domainSeed` carries 120 exterior members, each copy
122); a broad-phase over generators would cut both and is a kernel question
for the shader scoping, not a CPU core change. The 3D and cell24 rows came
from a one-off scratch probe on the same machine and are context, not a
reproducing harness.

## One `ball` seed kind (2026-09-15)

The CPU core shipped `ball` and `cap` as two seed kinds that resolved to the
same single `B(0, size)`, with the kind naming the subject: a `ball` that met a
generator was refused with a pointer to `cap`, and a `cap` that met none with a
pointer to `ball`. That was two document spellings for one object, which is a
defect in a document vocabulary: the same geometry would encode two ways, and a
size edit across the first generator's reach would flip a valid document into a
refusal.

They are merged into ONE `ball` kind. A ball that crosses the generators is
simply allowed, because the seed is always `K ∩ F`: inside the central void
that is the pearls, and grown across the generators it is the sphairahedron
the pre-gate sheets called a cap. The resolver's remaining ball refusals are
the construction gate's (plane image, a ball inside one closed generator ball).
`"cap"` is now an unknown kind and is refused as such, never aliased; nothing
had been persisted, so there is no compatibility cost. The pre-gate sections
above keep "cap" as the historical name of that subject.

## The cutoff contract, pinned (2026-09-15)

The contract is `surface-de.ts`'s and is now pinned against the explicit orbit
in both dimensions (cube8 shell D2 in 3D, cell24 .98 shell D2 in 4D; cutoffs
1e-3, 1e-2, 0.05, 0.2):

- **At or above the cutoff** the return is the uncut estimate bit for bit and
  never above the oracle's true distance.
- **Below the cutoff** the return is sub-cutoff exactly when the uncut
  estimate is. Every query whose true distance is below the cutoff returns
  below it; a query whose true distance is above it can still return below it
  only where the uncut bound already under-reads (the lower bound's safe
  direction). The cutoff never changes a decision, including with the cutoff
  on the full estimate to the ulp.
- **An exit value lies in `[full, cutoff)`.** It is a decision value, not a
  distance. The estimator itself only ever transports the running minimum,
  which is an exact bound on the part of the cover already scanned, so
  `inversionDistanceLowerBound` never consumes a cutoff-shortened distance.
  A caller must not transport or compose a sub-cutoff return either; a
  Balloon- or lens-style wrapper queries with cutoff 0 or uses the decision
  alone.

**Was a fix needed? No violation was found.** The exact transport is monotone,
but its f64 evaluation (a quotient of two rounded increasing terms) is not
exactly monotone, so in principle an exit within a few ulps of the cutoff could
flip the decision. A scratch search of about 580,000 positive queries (ico12
shell D6, oct6 kissing D8, cube8 vault D7, cell24 shell D5, cutoff at the full
value and one ulp either side) found no mismatch and no exit at all in that
band: reaching it needs the folded threshold's own rounding to line up. The
exit now clears `SPHERE_INVERSION_CUTOFF_EXIT_MARGIN = 2^-40` anyway. Each
transport step's relative rounding is a few ulps and its sensitivity
`s/(s+d)` never amplifies it, so 32 steps stay far inside `2^-40`. That makes
the decision identity a written argument rather than a sampled one. The
folded threshold's comment is also corrected: ignoring the `1 + 2^-20` margin
puts it slightly below the true threshold (an exit may be tried late, never
wrongly), not above it.

## Persistence, scene dimension and Surface routing (2026-09-15)

The document half of the family. Nothing here renders: no Surface session,
renderer route, UI control or preset exists, and Surface entry for such a
document is refused with an honest reason.

### The document field

`sphereInversion?: SphereInversionAuthored` on `AppState` and `SceneSnapshot`
(`src/app/state.ts`, `src/app/persist.ts`). When present it REPLACES the
transform system as the scene's Surface subject; the transforms stay in the
document untouched, so clearing the block restores the IFS scene. Absent, the
document is byte-identical to every document predating the field: the hash
payload omits the key, and `toSnapshot` omits it too, because evolution's
content digest counts an own `undefined` key and would otherwise change for
block-less scenes.

**Preservation mechanism.** The wire is the authored JSON VERBATIM:

- `encodeScene` writes the block as-is, with no `round4` (a rounded radius
  fraction or seed length can move a document across a resolver refusal).
- `decodeSphereInversion` keeps any plain JSON object exactly as `JSON.parse`
  produced it, key order included, so decode then encode reproduces the hash
  byte for byte. A non-object (array, scalar, `null`) names no block and drops
  to absent without rejecting the scene. This is deliberately NOT the other
  blocks' whole-block-or-nothing fallback.
- A block this version cannot render survives: an unknown arrangement, an
  out-of-domain or wrongly typed value, or a field a newer version wrote. The
  resolver now REFUSES unknown top-level and seed keys by name (ignoring them
  would render a different object than the document names), refuses non-object
  blocks and seeds, and refuses wrong types rather than coercing them. Its
  reasons reach the user through the Surface gate's note.
- Every other persistence consumer (collection, timeline, JSON scene files,
  undo history) stores encoded strings, so it inherits the rule. Evolution
  crossover carries the block whole from the PRIMARY parent (a subject is
  never mixed) and validates it only as a plain object of finite JSON values.

### Scene dimensionality

`src/fractal/scene-dimension.ts`'s `scenePartsAreNonFlat` is the one
derivation: a present block whose arrangement id names a registry entry decides
(3D or native 4D); otherwise the transform system's `systemPartsAreNonFlat`.
`sphereInversionAuthoredDimension` reads only the arrangement, so a block
refused for another reason still names its dimension, and repairing that reason
never flips the scene. An unknown arrangement names no dimension, and the scene
keeps the transforms'.

Routed through it:

- `surface-eligibility.ts` (the route kind's dimension);
- the Surface session door in `main.ts` (its 4D branch);
- `state.ts`'s `sceneIsNonFlat`, and `displayedIsNonFlat`, which the panel's
  dimensional gating in `ui.ts` (4D view rows, 4D color, legend, title) now
  reads;
- evolution crossover's child 4D pose.

**NOT routed, by decision:** the IFS renderers' engine choice (the Points
chaos-game request's `fourD`, the Flame and Solid workers, the symmetry and
tiling edit guards, transform-edit planning, mutation thumbnails). Until the
family has a Points/Flame/Solid representation, those modes draw the PRESERVED
transforms, and their engines must follow the transforms' own flatness. The 3D
engine cannot run a non-flat system (`chaos-game.ts`'s `symmetryRotation`
throws on a w-plane kaleidoscope). `displayedIsNonFlat` therefore reads the
scene's dimension in Surface and the transforms' in Points, Flame and Solid.
Without a block the two agree everywhere, so no existing document changes. A
document whose block dimension differs from its transforms' shows the
transforms' dimension outside Surface. That is the interim seam the
Points/Flame/Solid representation work owns.

### Surface eligibility

A present block takes precedence over every other gate and is disjoint from
them: they read a `Transform[]`, and it reads a construction no transform list
expresses. Its route kinds are `"sphereInversion"` (3D) and
`"sphereInversion4"` (native 4D).

- **Refused block:** ineligible, note `Sphere-inversion scene refused:
<resolver reasons>`.
- **Admissible block, no compute adapter:** ineligible, note `3D|native 4D
sphere-inversion scenes render on WebGPU compute, which is unavailable
here`. Neither dimension has a fragment arm yet
  (`sphereInversionHasFragmentArm`).
- **Admissible block with compute:** `eligible`, or `degraded` whenever the
  note carries a disclosure (tangency cusps, dormant settings, the 4D slab
  clamp), with the kind carrying the dimension. The WGSL route and its session
  door are recorded in `docs/sphere-inversion-gpu.md`'s "Routing as shipped".

### Combination policy

| Feature                        | Policy                   | Reason                                                                                                                                                                                                  | Lift's shape                                                                                                                                                       |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Space tiling                   | REFUSED (document)       | No tiling wrapper certifies this estimator; the lattice arm's authority radius is not wired.                                                                                                            | Resolve the tiling against the DE's origin-centred `boundingRadius`; fold the query into the canonical cell before the inversion fold.                             |
| Kaleidoscope (order > 1)       | DORMANT, disclosed       | The arrangement carries its own symmetry; a sector sweep over the inversion group has no certificate, and a rotation outside the arrangement's group moves generators into overlap with their images.   | Admit exactly rotations in the arrangement's symmetry group (no-ops), or fold the query into a sector with a union-of-copies argument.                             |
| Final transform lens           | DORMANT, disclosed       | No lens wrapper certifies this estimator.                                                                                                                                                               | `descendLens`'s fold-final branch sweep around `estimateSphereInversionDistance` at cutoff 0 on the inner term.                                                    |
| Shape trap                     | REFUSED (document)       | The inversion fold has no trap accumulator.                                                                                                                                                             | Accumulate the trap SDF over the fold's `k` visited points, like the escape family's orbit runners (colour only).                                                  |
| Balloon                        | REFUSED (session)        | The echo would invert this estimator: sub-cutoff returns are decisions, so inner queries run at cutoff 0 (a full scan at 120 generators), and a ball seed reaching the ball centre swallows the camera. | `min(DE(p), (\|p−c\|/ρ)·DE(I(p)))` with the inner term at cutoff 0 and the origin ball at `boundingRadius`; measure the doubled 600-cell cost and the camera case. |
| 4D slice thickness             | REFUSED, clamped to zero | `d − h` is unsound for the slab's shadow (CPU core section).                                                                                                                                            | Transport the segment's enclosing ball per inversion with a two-branch enumeration where it straddles a generator sphere.                                          |
| Ground plane                   | COMPOSES                 | The floor reads only the session ball (`boundingRadius`, the full 4D radius in 4D), and its penumbra/AO probes need only a certified lower bound.                                                       | —                                                                                                                                                                  |
| Per-transform finishes         | DORMANT, disclosed       | Material lanes keyed on transform slots the subject does not have (its attribution is generator, word and seed member). They stay dormant on the preserved transforms instead of blocking entry.        | Map finishes onto `SphereInversionHit` attribution (the shader scoping's material question).                                                                       |
| Schedule, band, emitters, xaos | NOT READ                 | Structure of the replaced transform system.                                                                                                                                                             | —                                                                                                                                                                  |

The session half lives in `sphereInversionSessionRefusal` (Balloon) and
`SPHERE_INVERSION_SLAB_REFUSAL`, which the thickness row's refusal note
(`ui.ts`, reason `"sphereInversion"`) and the gate's note share; both are
wired into the Surface session door. The kaleidoscope and lens rows above
were refusals until the ownership amendment (`docs/sphere-inversion-gpu.md`):
state the block's subject replaces is kept but not read, and the reasons in
their rows describe what a lift would need to make it READ.

### Morph, mutation, random, flame, presets

- **Morph: pop at first push.** The block is not part of `MorphSystem` and
  never interpolates; a replace-load applies the target's block from the leg's
  first push, the scheduled-hybrid placement. Interpolation is not trivially
  sound even within one arrangement: a length moving between two admitted
  values can pass through a refused one (a shell sphere through a generator
  centre, a seed entering one generator ball), and the depth is an integer.
- **Mutation.** `mutateSphereInversionBlock` nudges only PRESENT continuous
  lengths (radius fraction ±0.01 capped at kissing; seed size, thickness and
  cut radius ±3%; cut offset ±0.02). It never moves the arrangement, kind,
  depth or cut direction, and never writes an absent field. Every candidate
  must resolve (8 attempts, then the block itself), and a refused block is
  returned by reference. The `MorphSystem` mutation grid cannot carry a block
  at all, so it can never materialize one.
- **Random.** `randomSystem` never rolls a block.
- **Flame.** No mapping exists (a seed orbit is neither an xform list nor a
  variation). Export writes the preserved transform system byte-identically
  and warns; import never produces a block.
- **Presets and Surprise Me** clear the block (absent means clear), because
  each names a new transform-system subject that a leftover block would
  replace in Surface. The exceptions are the family's own showcases, which
  install their block through `PRESET_SPHERE_INVERSIONS` under the same
  absent-means-clear rule (Presets, below).

## Points, Flame and Solid (2026-09-15, delegated)

The decision owed by the persistence work's interim seam: which of the
IFS-shaped renderers can draw a sphere-inversion scene, in both dimensions.
Delegated to the lead agent and recorded as such; it stands until the owner
ratifies or overturns it.

### Per-mode verdict

| Mode          | 3D                                        | Native 4D                                                         |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| Points        | SHIPS: exact boundary sample of `O_D`     | SHIPS: exact boundary sample on `xyzw`, then the live rotor/slice |
| Flame         | REFUSED, disclosed beside the mode switch | REFUSED, same note                                                |
| Sampled Solid | REFUSED, disclosed beside the mode switch | REFUSED, same note                                                |

**Points.** `src/fractal/sphere-inversion-sample.ts` draws points ON the
boundary of the depth-D seed orbit: uniform patch samples of `∂(K ∩ F)`
carried through random reduced words of length `<= D`. Every point lies on the
same set the Surface estimator certifies; only the density over it is a choice
(area-proportional through depth 1, geometrically lighter below). A generator
wall is emitted only where it is EXPOSED — at word length `D` with a first
letter other than its own generator — because every other wall point is an
internal membrane across a window whose points are all members, which no
distance test can see. The cloud worker (`cloud-worker-core.ts`) runs the
sampler instead of the chaos game whenever the document carries a block; a
refused block draws an empty cloud (the Surface note says why), an authored
tiling block is disclosed as refused, and Points follows the block's
dimension (`state.ts`'s `displayedIsNonFlat` now reads the scene in Points as
in Surface). "By Transform" colours by GENERATION over
`sphereInversionGenerationSlots(D) = D + 3` slots, the count the Surface route
will pack, so one generation wears one hue in both modes.

**Flame and Sampled Solid.** Neither has a representation that draws `O_D`.
The chaos game over the preserved transforms draws a different object, and a
density accumulation of the boundary sample would make its brightness a
property of the sampler's chosen density rather than of the scene. Both are
refused by `surface-eligibility.ts`'s `sphereInversionRenderModeRefusal` for
any present block, resolvable or not (a refused block is still the subject):
the buttons disable and name the note beside the mode switch
(`#sphereInversionModeNote`), `switchRenderMode` refuses every door with the
same text, and a block that arrives under a live Flame or Solid session exits
to Points with a toast. The lift's shape, if one is ever wanted: a Flame
histogram of the boundary sample needs an area-uniform density across
generations (an importance weight per sample from the walk's own
probabilities), and Solid a membership voxelization from
`sphereInversionContains`/`-4`, which is exact but priced per voxel at the
estimator's scan cost.

### Other point consumers

- **Morph.** Intermediates sample the block at the morph budget; the request
  reads the LIVE document, so a replace-load's target block pops at the first
  push (the schedule's rule).
- **Watch it build** refuses with a toast: a boundary sample has no generation
  order to replay.
- **Evolution Lab** refuses with a toast (it mutates the replaced transform
  system), and a lineage node carrying a block gets a blank thumbnail rather
  than its transforms' attractor.
- **Balloon.** The Points echo stays hidden over a landed sample (keyed on the
  landed cloud, like the lattice gate); the checkbox stays enabled with a note,
  because Surface's session refusal asks the user to turn Balloon off.
- **Guides.** Transform boxes, grid and axes rest, and canvas hit-testing
  selects nothing, while a block replaces the transforms.
- **Flame backdrop.** It draws the preserved transforms, so a flame backdrop
  holds its gradient placeholder while a block is present.

### Set-identity evidence (`sphere-inversion-sample.test.ts`)

- **On the orbit.** The oracle's true distance is `<= 1e-9` for every sample at
  D1–2: oct6 pearls, cube8 lace shell, ico12 vault, tess16 kissing ball, cell24
  shell and cell600 vault D1.
- **At production depth** the certified estimator reads every sample within
  1e-9 (f64) and 1e-6 (the f32 cloud): oct6 D8, ico12 shell D6, cell24 D5, and
  the cell600 vault and medallion at D5.
- **Boundary, not membrane.** Offsets of 1e-6 either side of each sample's
  patch, carried through its own word, are members on exactly one side (cube8
  D3, ico12 vault D4, cell24 D3, cell600 medallion D3; walls included, samples
  within 1e-4 of a patch edge skipped). Negative control: depth-0 wall samples
  are members on BOTH sides of the depth-1 orbit. A deliberate mutation letting
  walls expose below depth `D` fails all four membrane rows.
- **Coverage.** Every oracle-nearest boundary point of the depth-1 orbit has a
  sample within 0.05 (oct6, cube8 shell; 20k samples) or 0.12 (tess16; 40k).
- The 4D cell600 vault's samples spread across `w` (range > 1), and a fixed
  caller seed reproduces the cloud exactly; the patch weights depend only on
  the construction.

### Cost and budget

`scripts/sphere-inversion-sample.harness.ts` (figures in
`docs/harness-sheets.md`): 0.31 us per sample for the 3D pearls up to 4.2 us
for the cell600 vault at D5, against 0.10 us per chaos-game iteration, with no
point skipped on any row and depth barely moving the cost. Policy:
`SPHERE_INVERSION_POINTS_MAX` = 500,000 samples per cloud (about 2.1 s of
worker time at the worst subject on this machine), disclosed in the mode note,
and one cached sampler per block so colour and count edits skip the ~100 ms
pilot.

### Browser check

The built app under headless SwiftShader, loaded from injected `#v1=`
documents:

- **oct6 pearls D8 (3D).** 100,000 points; a red seed pearl, orange
  generation-1 pearls and yellow-to-blue deeper generations, no transform
  guides; Flame and Sampled Solid disabled with the note visible and named by
  `aria-describedby`; panel titled 3D; no error.
- **cell600 vault D5 (native 4D).** Panel titled 4D, 100,000 points, the w
  legend and 4D projection help, the same refusal, and the Surface note's slab
  disclosure. The full projection is a w-coloured ball of dust: the vault's
  pearl windows are a SLICE phenomenon (this document's native 4D search), so a
  projected Points cloud of the same set shows its extent and not its windows.
  That is a presentation limit of projection, not a different set.

## Cost and exhaustion (measured, 2026-09-15)

The public control ranges come from this sweep. Every range call below is
DELEGATED (lead agent, owner to ratify).

**Machine and conditions.** Mesa Intel Iris Xe Graphics (TGL GT2) on `:0`,
WebGPU adapter `intel gen-12lp` (software = false, as the session itself
reported). Playwright Chromium, headed, 1920×1080 viewport at DSF 1
(2,073,600 rays), the app's default 8 antialiasing passes, reduced motion
(identity rotor unless a pose is authored). The production bundle was built
from the branch's committed source before the preset work landed. All 234
measured cells were preceded by a per-process machine-quiet sample reading
`quiet=YES`. These are this Iris's numbers; they are not expectations for
another machine.

**Instrument.** `scripts/sphere-inversion-cost.probe.mjs`: one fresh context
per cell, a minted `#v1=` document, Surface entered with a trusted click.
Settle time is the click to the `?surfacestate` settled latch. Then comes a
3 s trusted orbit drag. The rung is the drag previews' raster width over the
settle raster. Preview exhaustion is read from the renderer's own preview
lines, and per-dispatch work and shade share from `?surfacetrace`. Raw rows
go to `scripts/out/sphere-inversion-cost*.json` (regenerate).

Seeds used as representatives: 3D ball .28, shell 1 ± .03, cut shell
1 ± .06; 4D ball .28, medallion shell 1.1 ± .03, vault cut shell .9 ± .04.
Every cut uses the default cut. 4D slices were set in world `w` through the
cloud's own bounds support, and the slider step quantizes them (recorded
`w0` .095–.158 for the .1 and `1/(4φ)` targets).

### Depth: not a cost lever

Settle seconds, compute, radius fraction .99, identity pose. `pruned` means
the probe's 60 s prune rule stopped the row.

| 3D    | seed     |  D3 |   D5 |  D8 | D12 | D20 | D32 | preview exh max % | max dispatch ms | shade share % |
| ----- | -------- | --: | ---: | --: | --: | --: | --: | ----------------: | --------------: | ------------: |
| oct6  | ball     | 8.0 | 10.3 | 9.0 | 8.9 | 9.0 | 8.9 |              2.68 |              41 |         43–50 |
| oct6  | shell    | 9.4 |  9.3 | 9.6 | 9.5 | 9.4 | 9.5 |              0.95 |              31 |         65–67 |
| oct6  | cutShell | 9.1 |  9.2 | 9.1 | 9.1 | 9.2 | 9.0 |              1.13 |              31 |         64–66 |
| cube8 | ball     | 9.2 |  9.3 | 9.3 | 9.4 | 9.4 | 9.3 |              3.12 |              58 |         35–41 |
| cube8 | shell    | 7.2 |  7.3 | 7.4 | 7.2 | 7.4 | 7.1 |              0.41 |              21 |         66–69 |
| cube8 | cutShell | 7.8 |  7.9 | 7.9 | 8.0 | 8.0 | 8.0 |              0.40 |              25 |         66–68 |
| ico12 | ball     | 8.5 |  9.2 | 9.1 | 9.0 | 9.1 | 9.5 |              3.90 |              47 |         40–50 |
| ico12 | shell    | 7.6 |  7.5 | 7.3 | 7.6 | 7.4 | 7.4 |              0.51 |              24 |         67–69 |
| ico12 | cutShell | 8.0 |  8.3 | 8.5 | 8.4 | 8.4 | 8.4 |              1.09 |              33 |         63–67 |

| 4D      | seed     |   D3 |    D5 |    D8 |    D12 |  D20 |  D32 | preview exh max % | max dispatch ms | shade share % |
| ------- | -------- | ---: | ----: | ----: | -----: | ---: | ---: | ----------------: | --------------: | ------------: |
| tess16  | ball     |  7.1 |   7.2 |   7.0 |    7.0 |      |      |              0.15 |              34 |         29–32 |
| tess16  | shell    | 13.3 |  13.4 |  13.6 |   13.7 | 13.9 | 13.9 |              1.00 |              35 |         79–80 |
| tess16  | cutShell | 12.3 |  12.3 |  12.4 |   12.5 |      |      |              0.49 |              38 |         75–76 |
| cross8  | ball     | 13.3 |  14.5 |  14.5 |   14.7 |      |      |             10.30 |              92 |         54–58 |
| cross8  | shell    | 13.0 |  13.0 |  13.1 |   13.3 |      |      |              1.22 |              51 |         70–73 |
| cross8  | cutShell | 12.7 |  13.1 |  13.0 |   13.2 |      |      |              4.34 |              58 |         64–66 |
| cell24  | ball     | 14.7 |  16.7 |  16.8 |   17.1 |      |      |              9.05 |             161 |         46–57 |
| cell24  | shell    | 14.5 |  14.8 |  14.9 |   14.5 |      |      |              0.80 |              58 |         74–75 |
| cell24  | cutShell | 16.4 |  17.7 |  17.8 |   18.6 |      |      |              3.67 |             118 |         71–75 |
| cell600 | ball     | 55.1 |  62.5 |  65.3 | pruned |      |      |              9.26 |             364 |         60–65 |
| cell600 | shell    | 28.1 |  28.2 |  27.7 |   27.8 | 29.1 | 29.1 |              0.77 |             122 |         85–86 |
| cell600 | cutShell | 76.6 | 102.7 | 101.3 | pruned |      |      |              5.28 |             305 |         79–80 |

Settle cost is flat in depth within the row's noise, from D3 to D32 in 3D
and from D3 to D12 in 4D (to D32 on the tess16 and 600-cell shells). The one step is the
600-cell's ball and vault from D3 to D5. That is consistent with pieces past a few generations falling below the hit-acceptance footprint (not measured directly). Coverage agrees: the oct6 pearls read 7.45 / 8.54 / 8.90 / 8.81 / 8.95 / 8.95% hit
from D3 to D32, so nothing changes on screen past D12.

### Radius fraction and pose: where preview exhaustion lives

Settle s / preview exhausted max %. 3D at D8, 4D at D5, identity pose.

| 3D D8 | seed     |     rf 0.6 |     rf 0.8 |     rf 0.9 |    rf 0.99 |
| ----- | -------- | ---------: | ---------: | ---------: | ---------: |
| oct6  | ball     | 5.1 / 0.03 | 6.1 / 0.11 | 6.4 / 0.43 | 9.0 / 2.59 |
| oct6  | shell    | 7.5 / 0.28 | 8.1 / 0.48 | 8.6 / 0.62 | 9.6 / 0.71 |
| oct6  | cutShell | 7.6 / 0.11 | 8.0 / 0.21 | 8.2 / 0.39 | 9.1 / 1.02 |
| cube8 | ball     | 6.6 / 0.07 | 7.2 / 0.19 | 7.7 / 0.60 | 9.3 / 3.05 |
| cube8 | shell    | 7.1 / 0.25 | 7.1 / 0.39 | 7.1 / 0.38 | 7.4 / 0.40 |
| cube8 | cutShell | 7.6 / 0.11 | 7.8 / 0.18 | 7.4 / 0.25 | 7.9 / 0.38 |
| ico12 | ball     | 5.7 / 0.03 | 6.3 / 0.23 | 7.4 / 0.71 | 9.1 / 3.60 |
| ico12 | shell    | 7.1 / 0.16 | 7.1 / 0.24 | 7.2 / 0.29 | 7.3 / 0.32 |
| ico12 | cutShell | 7.6 / 0.11 | 7.6 / 0.16 | 7.6 / 0.28 | 8.5 / 0.93 |

| 4D D5   | seed     |      rf 0.8 |      rf 0.9 |      rf 0.99 |
| ------- | -------- | ----------: | ----------: | -----------: |
| tess16  | ball     |  6.5 / 0.06 |  6.8 / 0.07 |   7.2 / 0.15 |
| tess16  | shell    | 13.1 / 0.71 | 13.6 / 0.76 |  13.4 / 1.00 |
| tess16  | cutShell | 12.3 / 0.25 | 12.7 / 0.43 |  12.3 / 0.45 |
| cross8  | ball     |  8.2 / 0.56 | 10.8 / 1.83 | 14.5 / 10.30 |
| cross8  | shell    | 13.2 / 0.62 | 13.4 / 0.73 |  13.0 / 0.88 |
| cross8  | cutShell | 12.9 / 1.03 | 13.0 / 1.58 |  13.1 / 3.26 |
| cell24  | ball     |  9.4 / 0.57 | 11.7 / 1.88 |  16.7 / 8.66 |
| cell24  | shell    | 13.7 / 0.75 | 14.5 / 0.86 |  14.8 / 0.71 |
| cell24  | cutShell | 13.8 / 0.84 | 15.7 / 1.25 |  17.7 / 3.52 |
| cell600 | ball     | 26.4 / 0.65 | 39.7 / 1.92 |  62.5 / 9.09 |
| cell600 | shell    | 22.5 / 0.74 | 25.7 / 0.72 |  28.2 / 0.72 |
| cell600 | cutShell | 49.0 / 0.94 | 62.5 / 1.62 | 102.7 / 5.19 |

4D poses at D5, rf .99 (settle s / preview exh max %):

| arrangement | seed     |     identity | `xw` .3, `w0` .1 | medallion (`xw` .4 `yw` .3 `zw` .2, `w0` 1/(4φ)) |
| ----------- | -------- | -----------: | ---------------: | -----------------------------------------------: |
| tess16      | ball     |   7.2 / 0.15 |       7.0 / 0.14 |                                       7.3 / 0.65 |
| tess16      | shell    |  13.4 / 1.00 |      13.5 / 0.83 |                                      13.5 / 0.79 |
| tess16      | cutShell |  12.3 / 0.45 |      12.2 / 0.59 |                                      11.8 / 0.61 |
| cross8      | ball     | 14.5 / 10.30 |      10.6 / 4.48 |                                      10.0 / 3.37 |
| cross8      | shell    |  13.0 / 0.88 |      12.7 / 0.73 |                                      12.5 / 0.86 |
| cross8      | cutShell |  13.1 / 3.26 |      12.7 / 1.97 |                                      12.6 / 1.42 |
| cell24      | ball     |  16.7 / 8.66 |      11.3 / 4.68 |                                      10.0 / 3.17 |
| cell24      | shell    |  14.8 / 0.71 |      14.2 / 0.65 |                                      14.2 / 0.71 |
| cell24      | cutShell |  17.7 / 3.52 |      14.9 / 1.78 |                                      14.4 / 1.49 |
| cell600     | ball     |  62.5 / 9.09 |      40.8 / 6.53 |                                      39.5 / 7.28 |
| cell600     | shell    |  28.2 / 0.72 |      26.4 / 0.75 |                                      25.8 / 0.58 |
| cell600     | cutShell | 102.7 / 5.19 |      60.4 / 3.79 |                                      57.4 / 4.32 |

Off-centre slices and rotor poses are never MORE expensive than the identity
slice. The identity slice holds the most generators, so the 600-cell vault
drops from 103 s to 57–60 s.

Exhaustion is a preview phenomenon only. Every settle in the sweep
resolved every ray (at most one exhausted ray in 2.07M). Preview exhaustion
above 1% concentrates on ball (pearl) seeds and the 4D vault near kissing.
There, grazing rays run out of the preview tier's march budget at the emergency rungs the drag drops to (0.07 on every 600-cell row and on many cell24 rows, 0.10 on most others). It falls steeply with the radius fraction: every 3D
row is at or under 0.71% by rf .9, and every 4D row at or under 1.03% by
rf .8.

### Seed geometry

One length moved off the representative seed. 3D oct6 / ico12 at D8, 4D
cell24 / cell600 at D5, all rf .99, identity. Settle s / preview exh max %.

| variant                  |        oct6 |      ico12 |      cell24 |     cell600 |
| ------------------------ | ----------: | ---------: | ----------: | ----------: |
| ball .15                 |  8.3 / 3.17 | 9.0 / 3.49 | 15.5 / 9.21 | 61.1 / 9.02 |
| ball .5                  |  9.2 / 1.56 | 9.4 / 2.18 | 19.6 / 5.65 | 68.4 / 8.75 |
| ball .8                  |  8.8 / 0.69 | 8.9 / 1.13 | 18.4 / 3.86 | 74.7 / 4.02 |
| shell size .7            | 10.1 / 0.85 | 9.2 / 1.35 |             |             |
| shell size 1.3           |  8.2 / 0.19 | 7.2 / 0.12 |             |             |
| shell half-thickness .01 | 10.0 / 0.80 | 7.7 / 0.37 | 14.8 / 0.84 | 29.4 / 0.71 |
| shell half-thickness .1  |  9.2 / 0.42 | 7.4 / 0.16 |     refused |     refused |
| cut radius 2             |  9.5 / 0.88 | 8.0 / 0.70 | 17.6 / 3.04 | 78.0 / 4.84 |
| cut radius 50            |  9.2 / 1.07 | 8.5 / 0.98 | 17.7 / 3.15 | 80.6 / 5.38 |
| cut offset −.5 (4D −.4)  |  8.2 / 1.73 | 9.0 / 2.21 | 19.5 / 6.53 | 81.6 / 7.68 |
| cut offset .8            |  9.5 / 0.80 | 7.5 / 0.43 | 17.2 / 2.68 | 62.2 / 3.23 |

The 4D shell `1.1 ± .1` is not a cost row. Its inner sphere has radius 1,
the generator-centre distance, so the resolver refuses it as a plane image
(checked against `resolveSphereInversion`). A refused block draws an empty
Points cloud, which the probe now records as `refused-document`. Seed
lengths move 3D cost by at most 25% and 4D cost by at most 40%. The 600-cell ball and vault stay between 61 and 103 s (the representative vault) wherever the lengths go, and its shell seed stays near 29 s.

### Engines, raster and bounds

- **WebGL fallback (`?surfacegl`, 3D).** oct6 / ico12 × ball / cut shell ×
  D5 / D8 / D12 settle in 3.9–7.9 s, with no ray exhausted and no strip
  measured over 500 ms. The WebGL arm publishes a census for settles alone,
  so its PREVIEW exhaustion was not observable and is not recorded.
- **Raster.** The 600-cell at rf .99, D5, identity, at 1280×720 (44% of the
  rays): ball 34.6 s (vs 62.5), shell 13.9 s (vs 28.2), vault 39.8 s (vs
  102.7). Cost tracks the ray count roughly linearly; on the vault it falls somewhat faster than the rays.
- **Watchdog and fence bounds were never approached.** The worst per-dispatch
  device work was 364 ms and the worst wall share 369 ms (600-cell ball D3
  settle). That is 5.4× under the ~2 s single-job cut recorded for the compute renderer on the AMD box; no Iris job-cut figure is on record, so the headroom on this machine is inferred, not measured. Every group
  measured on the GPU currency, no preview was truncated, and no settle
  failed to complete (the one 90 s timeout completed in 102.7 s given
  250 s).

### Public ranges (delegated)

- **Arrangements.** All seven stay public. No arrangement is refused on
  cost.
- **Depth.** Public slider `[0, 12]` in both dimensions, the same for every
  arrangement. Cost does not bound it: settle is flat to D32. The cap is
  where the image stops changing at a 1080p pane. The resolver's structural
  32 stays the document domain, so the public range NARROWS it for the
  control only; a document with a deeper depth still loads. This replaces
  the pre-gate candidate "6–12 (3D), 5–10 (4D)", whose lower ends had no
  cost reason.
- **Radius fraction.** Public `[0.6, 0.99]`. The lower end is the measured
  bottom (cost only falls below it). Kissing 1.0 was not measured and stays
  a document-only, degraded value. The suggested policy "preview never
  exhausts more than 1%" was NOT adopted. It would cap 3D at .9 and 4D at
  .8, excluding the gate's primary near-kissing pearl subjects, to fix a
  transient speckle that every settle clears. Coarse drag previews near
  kissing are disclosed as such instead.
- **Seed lengths (measured span, not narrowed on cost).** Ball size
  `[0.15, 0.8]`. Shell size `[0.7, 1.3]` in 3D; 4D was measured at .9 and
  1.1 only. Shell half-thickness `[0.01, 0.1]`. Cut radius `[2, 50]`. Cut
  offset `[−0.5, 0.8]` (3D) and `[−0.4, 0.8]` (4D). The resolver's own
  refusals stay inside these spans: a shell sphere through a generator
  centre (`size ± thickness` equal to the centre distance 1) is a plane
  image. A slider crossing that value hits a refusal point, which the
  controls must disclose rather than clamp.
- **Refused on cost: none.** The 600-cell with a ball or cut-shell seed
  settles in 26–103 s at 1080p on this Iris (39–103 s at rf .9 or .99). That
  is over a 30 s budget at every depth and every pose. It stays admitted
  under the no-automatic-give-up line: its settle always completes, its
  progress row discloses coverage, and nothing approaches a watchdog bound.
  Refusing it would remove the family's primary native 4D subject. The
  600-cell shell (medallion) settles in 22–29 s. Every other arrangement
  and seed settles in 20 s or less.

## Presets (2026-09-15, delegated)

Six Surface showcases sit in their own **Sphere inversion** menu group: four
3D, two native 4D. The group holds both dimensions, as Space tiling does, and
marks the 4D pair with `(4D)` in the label. The family is what a reader looks
for, so the pair is not split off into the 4D group. Every call in this
section is DELEGATED (lead agent, owner to ratify).

### Mechanism

- **`PRESET_SPHERE_INVERSIONS`** (`presets.ts`) holds the block a preset IS,
  under `PRESET_FINALS`' ABSENT-MEANS-CLEAR rule. A showcase installs its
  block, and every other preset clears one. Entries are factories, so a
  document never aliases the table. Each entry spells out every field its
  seed kind reads, because the block persists verbatim.
- **The transforms underneath are a placeholder**: the Sierpinski
  tetrahedron. The block replaces them as the subject, but a document still
  carries a transform system. The tetrahedron is the smallest contracting
  system every renderer and gate admits. It is FLAT, so the block's
  arrangement alone decides the scene's dimension (`scene-dimension.ts`).
  When the next preset clears the block, an ordinary valid scene remains.
- **`PRESET_RENDER_HINTS` is `surface`** for all six. In Points the 4D
  subjects draw as a dust ball, because their windows are a slice
  phenomenon.
- **`PRESET_VIEWS`** is a new side table: the saved view a preset is composed
  at. ABSENT MEANS AUTO-FIT, so every other preset keeps the arrival fit it
  always had.
  - It is authored as plain data in units a reader can check: eye, look-at
    point, vertical fov, an ordered list of 4D plane rotations, and a WORLD
    `w0`.
  - `load-hints.ts` carries it as a fourth hint. The hint is consumed on the
    preset's own replaced landing, in place of the fit, and the morph's
    camera chase stands down while it waits.
  - `preset-view.ts` converts it at that moment. When the eye is closer
    than `MIN_RADIUS` (the interior vaults), the orbit pivot is pushed out
    along the line of sight, so the eye and the view direction stay exact.
  - The world `w0` is normalized against the LANDED cloud's bounds, the same
    `wSupport` the tracer multiplies back out by, and the slice window is
    turned on.
- **The landed view reaches the `#v1=` hash only on the next save.** The
  view lands after the load's debounced save, the same way every preset's
  auto-fit always has. A copied link reads the live document, so it carries
  the view. The gate therefore reads the landed slice off the live controls.
- **Viewer preferences are untouched.** With Automatic motion on, the 4D
  showcases tumble away from their authored rotor, as any saved view does.

### The set

Settle is wall time from the menu click to the `?surfacestate` settle latch.
The render hint enters Surface; nothing clicks the mode button. Eight
antialiasing passes (the app default), a 1600×900 viewport at DSF 1, the
compute engine, and 0 exhausted rays in every settled frame. Machine: Mesa
Intel Iris Xe (TGL GT2), WebGPU `intel gen-12lp` (software = false),
`quiet=YES` before launch. These figures are that machine's. The build
includes the per-generation colour-slot fix (D + 3 hues in compute).

| Preset (menu label)                               | Construction                                                             | View                                                           |                                    Settle | Covered |
| ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------: | ------: |
| `inversionPearls` (Kissing Pearls)                | oct6, rf .99, ball .28, D8                                               | eye (.26, .34, 1.42) → origin, fov 62                          |                                    10.7 s |   22.0% |
| `inversionCubePearls` (Cube Pearls)               | cube8, rf .99, ball .42, D8                                              | eye (.39, 1.6, .52) → origin, fov 62                           |                                    10.1 s |   22.3% |
| `inversionVault` (Octahedral Vault)               | oct6, rf .99, cut shell 1 ± .06 (default cut), D8                        | eye (.15, .3, .1) → (−.6, −1, .1), fov 81                      |                                    21.3 s |   95.9% |
| `inversionLace` (Icosahedral Lace)                | ico12, rf .99, shell 1 ± .03, D6                                         | eye (1.2, .87, 1.42) → origin, fov 62                          |                                    12.6 s |   39.9% |
| `inversionVault4` (600-Cell Vault (4D))           | cell600, rf .99, cut shell .9 ± .04 (default cut, `cutDirectionW` 0), D5 | eye (1.9, 1.3, .2) → origin, fov 55; `xw` .3, `yw` .2, `w0` .1 | 42.2 s quiet; 53.7 s contended (see note) |   29.0% |
| `inversionMedallions4` (600-Cell Medallions (4D)) | cell600, rf .99, shell 1.1 ± .03, D5                                     | eye (1.32, .96, 1.56) → origin, fov 62; `xw` .3, `w0` .1       |                                    23.0 s |   40.5% |

Every parameter lies inside the public ranges above.

**4D nudges.** Nudging the slice slider by +.06 normalized re-settles to a
different arrangement, not a turned copy of the same one:

- **Vault.** Windows on the far inner wall regroup, rosettes change their
  pearl counts, and fragments move along the rim. Settles in 47.5 s
  (contended), with 24.0% of pixels differing.

**The vault's two settle figures.** 42.2 s is Surface click to settle on a
quiet machine (load1 0.66), measured when the pose was explored. 53.7 s is
the menu gate: a clean git worktree build at the preset commit, measured
while another agent's SwiftShader browser gate ran on the CPU (load1 3.6–4.3).
The GPU baseline read `quiet=YES` both times, but it cannot see CPU
contention. Treat 53.7 s as an upper bound, not the pose's cost.

- **Medallions.** Medallions change their pearl counts and centre rosettes.
  Settles in 20.5 s, with 16.1% of pixels differing.

The gate is `scripts/sphere-inversion-presets.verify.mjs`. It checks:

- menu entry, compute engine and the settle latch;
- coverage of at least 5% of the pane and no exhausted ray;
- the landed slice, and that a slice nudge changes the frame;
- that a following ordinary preset clears the block.

Its frames are `scripts/out/si-preset-<key>.png`, plus `-nudge.png` for the
4D presets (gitignored; regenerate them).

### Choices and rejected poses

Poses were explored on the same machine with minted `#v1=` documents before
being baked into the table.

- **Radius fraction .99 everywhere, never 1.** At exact tangency a ray
  reaching a cusp is estimated at distance 0 without being a member, and
  stalls. The gate sheets' r .70 (oct6) and r .52 (ico12) are .99 of their
  kissing radii to within .001.
- **Cube pearls at D8, not the sheet's D12.** D10 and D8 are visually
  identical at this pane. D8 settles in 9–10 s, and one D10 run took 34.5 s,
  which is within this Iris's run-to-run spread for the cell but buys nothing.
- **600-cell vault: an oblique EXTERIOR view over the cut, not an interior
  view (review verdict, delegated).** Every interior framing read as a flat
  red wall with circular medallions: no curvature, no enclosure, no depth
  cue. That covers the 4D search's close view B, the grazing view A from near
  the centre (identity rotor at the kiss slice, 53.0 s; rotated, 48.9–51.6 s),
  a camera just inside the rim looking down across the bowl (61.0 s), and a
  low wide view across the bowl (55.7 s). The lead's review rejected the
  interior preset on those grounds.

  The follow-up compared these candidates. All share the cut shell
  `.9 ± .04`, D5, `xw` .3 `yw` .2 `w0` .1, except cell24, which uses `xw` .3
  only. The contact sheet is `scripts/out/si-vault4-candidates.png`
  (gitignored); settle is Surface click to latch at 1600×900, 0 exhausted.

  | Candidate                                              | Settle | Reading                                                                                        |
  | ------------------------------------------------------ | -----: | ---------------------------------------------------------------------------------------------- |
  | 600-cell, oblique exterior, eye (1.9, 1.3, .2), fov 55 | 42.2 s | **Chosen.** Rim, bowl curvature, rosette windows on the far inner wall                         |
  | 600-cell, straight through the cut, fov 55             | 40.8 s | A bowl, but frontal and flatter; the rim reads as a ring                                       |
  | 600-cell, oblique, closer, fov 50                      | 64.8 s | The most striking detail, but 50% slower                                                       |
  | 600-cell, just inside the rim, fov 90                  | 61.0 s | A wall again                                                                                   |
  | 600-cell, across the bowl, fov 90                      | 55.7 s | Some horizon, still mostly wall                                                                |
  | cell24 cut shell, same oblique view                    | 11.9 s | A clear cut polyhedral bowl, genuinely 4D (the nudge regroups the central rosette), but sparse |
  | tess16 cut shell, same oblique view                    |  9.7 s | A plain bowl with a handful of windows                                                         |
  - **Why the 600-cell and not cell24.** Both read as 3D objects and both are
    genuinely 4D. They are not equals on the image: the 600-cell's far wall
    carries rows of rosettes, and cell24's carries a few. The 600-cell is
    also faster than every interior vault pose. cell24 remains the fast
    native 4D cut shell if a cheaper vault is ever wanted.
  - **Posed off the identity rotor.** The cost section records the identity
    slice as the costliest (it holds the most generators), so the preset
    keeps the double rotation, which also makes the rosettes asymmetric.
  - D4 is indistinguishable from D5 but saves only 4 s.
  - **The vault is still over the ~30 s preset target on this Iris.** It
    stays a preset under the no-automatic-give-up line. It is the family's
    primary native 4D subject, and its bowl is a different image from the
    medallion sphere, which settles in about 23 s.

- **Medallions at `xw` .3, `w0` .1, not the double rotation at the kiss
  slice.** Both are genuine slices at the same cost (21–23 s). The single
  `xw` turn gives fuller medallions, pearl rings round a central rosette,
  where the double rotation's medallions are sparser. The double rotation
  stays one Shift-drag away.
- **No palette, lighting or finish is authored.** The default "By Transform"
  source colours by generation, and under the default light the subjects
  read as lit geometry. `PRESET_SURFACE_PALETTES` stays trap-only.
- **Zoom floor.** Every view keeps its closest detail well inside the
  compute cores' f32 floor (about 10R magnification). No settled frame shows
  thickening at its nearest pearls or window rims.

## Controls (2026-09-15, delegated)

The panel's **Sphere inversion** section. Every call below is DELEGATED
(lead agent, owner to ratify). Modules: `src/app/sphere-inversion-controls.ts`
(ranges, write rule, per-row disclosures; pure and tested),
`control-spec.ts` (nine table-driven entries), `ui.ts` (painting). User-facing
account: `docs/controls.md`; placement record: `docs/panel-ia.md`.

### Placement and gesture

- **Home: Scene / Look**, as its own section directly after Transforms. The
  block is the scene's subject and replaces the transform system. That only
  Points and Surface draw it is a consumer fact, not a home.
- **Add/remove: one enable checkbox**, the Space tiling pattern, rather than
  a "Subject: Transforms / Sphere inversion" select. The two are equivalent for
  a single optional block; the checkbox matches the section beside it.
- **The seeded block is a showcase's own form**, read from
  `PRESET_SPHERE_INVERSIONS` so it cannot drift. A flat scene gets Kissing
  Pearls (oct6, rf .99, ball .28, D8). A 4D scene gets 600-Cell Medallions
  (cell600, shell 1.1 ± .03, D5), so adding a block does not silently turn a
  4D scene 3D. Removing clears the whole block; undo restores it.

### Controls and ranges

| Control              | Field(s)         | Public span                    | Notes                                                                                    |
| -------------------- | ---------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| Arrangement (select) | `arrangement`    | all seven ids, grouped 3D / 4D | decides the dimension; leaving 4D drops a present `cutDirectionW` (no control clears it) |
| Sphere radius        | `radiusFraction` | 0.6–0.99, step .01             | 1.0 stays document-only                                                                  |
| Seed (select)        | `seed.kind`      | ball / shell / cut shell       | crossing ball <-> shell removes a present `size` (its meaning and default change)        |
| Ball / Shell radius  | `seed.size`      | ball .15–.8; shell .7–1.3      | the 4D shell uses the 3D span (4D measured at .9 and 1.1 only)                           |
| Shell half-thickness | `seed.thickness` | .01–.1, step .005              | shell kinds only                                                                         |
| Cut radius           | `seed.cutRadius` | 2–50, step .5                  | cut shell only                                                                           |
| Cut offset           | `seed.cutOffset` | 3D −.5–.8; 4D −.4–.8           | cut shell only                                                                           |
| Depth                | `depth`          | 0–12, integer                  | both dimensions; documents keep up to 32                                                 |

The cut DIRECTION has no control: no public range was measured for it, so it
stays document-only.

### Edit behavior

- **Points** follows Auto-update, one regenerate per edit (latest wins).
- **Surface** restarts through the existing construction-change rule, which
  compares the block's authored JSON. It restarts without refitting the camera.
  The enable checkbox and both selects restart at once. A slider restarts on
  RELEASE (its `commit`), or on the numeric field's commit. A restart per
  drag tick would rebuild the construction's tables (472 KiB at the 600-cell)
  dozens of times.
- **Flame and Sampled Solid.** With a block present they are already refused
  beside the mode switch, and the app leaves them. With no block, every
  control in the section is disabled, with the reason beside it.

### Absent means default, refusals preserved

- **Writes.** A field is written only once its control moves. Moving it onto
  the resolver's default for the CURRENT seed kind removes the key, and an
  emptied seed object goes with it.
- **Out-of-span values.** A value outside a slider's span but admitted by the
  resolver widens the slider and its numeric field to itself; nothing is
  clamped. The row says `N is outside this slider's range A to B; kept as
authored.` While a slider is focused its span only widens, so the track
  never rescales under a drag.
- **Refused values.** A value the resolver refuses is kept verbatim. The
  resolver's reason lands beside the row it names, with a repair action:
  - `depth …`, `seed size …` and the other single-field reasons go to their
    own row.
  - An unknown id shows as the select's `Authored: "…"` option.
  - A seed-geometry refusal naming no single field sits below the seed
    lengths. The 4D shell `1.1 ± .1` plane image is one; so are an
    empty-orbit seed and a cut-direction fault.
  - Unknown keys go to the section note.
  - A non-number shows the default on the thumb, with the refusal naming the
    authored value.

### Dormant sections

The replaced system's editors stay EDITABLE rather than disabled. A
transform edit authors state for when the block is removed, and costs no
renderer work under a block (below). Each section discloses adjacently, in
both dimensions:

- The **Transforms, Xaos, Symmetry and Hybrid schedule** hints, which their
  controls already reference, read "Kept but not drawn while Sphere inversion
  is the subject; edits apply once it is turned off". The existing
  kaleidoscope note keeps its dormant wording.
- The **final-transform lens** gets its own note beside its toggle, shown
  while a lens is authored.
- **Per-transform finishes and patterns** key their dormant note on the
  block's PRESENCE, not only on the Surface route kind. A refused block
  previously fell through to "Surface render unavailable".
- **Background → Flame backdrop** discloses its plain-gradient fallback beside
  the select.

**Transform edits under a block** no longer regenerate Points or re-enter
Surface (`planTransformEdit`'s `sphereInversionSubject`, pinned in
`transform-edit-effects.test.ts`). Nothing on screen reads the transforms.
Eligibility still refreshes, because its note names the dormant settings.
