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

| Field            | Default                                             | Domain (outside it: REFUSED with a reason)                            |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `arrangement`    | none (required)                                     | a registry id (below)                                                 |
| `radiusFraction` | 0.99                                                | `(0, 1]` of the arrangement's tangent radius; 1 is kissing (degraded) |
| `depth`          | 8                                                   | integer `[0, 32]` (structural cap, not a public range)                |
| `seed.kind`      | `ball`                                              | `ball`, `shell`, `cutShell`                                           |
| `seed.size`      | ball .28, shells 1                                  | `> 0`; a ball may cross the generators (its seed is `K ∩ F`)          |
| `seed.thickness` | shell .03, cut shell .06                            | `(0, size)`                                                           |
| cut fields       | direction (.35, 1, .55), w 0, offset .25, radius 10 | direction nonzero; `w` nonzero only in 4D; radius `> 0`; `            | offset | < size + thickness` |

The registry ids are `tetra4`, `oct6`, `cube8`, `ico12`, `dodec20`,
`rhombicuboct24`, `icosidodec30` (3D) and `cross8`, `tess16`, `cell24`,
`cell600` (4D). The four 3D ids after the first seven are the authored-sets
look study's selection (its section below); `icosidodec30` is `ico12`'s edge
midpoints, derived at build time rather than listed. Every one is
vertex-transitive, so the shared kissing radius is each generator's own.

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
- **Admissible block, no compute adapter:** ineligible when this
  construction has no WebGL fallback, note `<subject> render on WebGPU
compute, which is unavailable here`. The subject is
  `sphereInversionComputeOnlySubject`'s, asked of the CONSTRUCTION and not
  of its dimension (2026-09-22; before that a fixed per-dimension answer,
  correct only while the fragment arm's generator cap happened to equal the
  largest 3D arrangement — `docs/sphere-inversion-gpu.md`'s last section).
  It is `native 4D sphere-inversion scenes`, or a named cap for a 3D
  construction the arm's block cannot hold; null — a plain fallback — for
  every 3D construction inside it. That is every 3D arrangement but
  `icosidodec30`, whose 30 generators are one past the block's ceiling of 29:
  the first construction that is compute-only by CAPACITY rather than by
  dimension, refused without an adapter as `sphere-inversion scenes with more
than 29 generators`.
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
  at all, so it can never materialize one. GENERATOR CENTRES ARE STRUCTURAL
  and never move, a verdict the look study's jitter sweep decided rather than
  one left to omission: perturbing a regular set measured as DECAY at every
  amplitude sampled — intact to ~5–10% of an edge, degraded by 20%, dust by
  35–50%, with the crossing itself draw-dependent — so a mutation that moved
  centres could only damage the arrangement it was handed, and
  irreproducibly. The registry growth changes none of this: the arrangement
  is still one string the mutation never touches.
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

- **Arrangements.** All eleven are public: 4–30 generators in 3D, 8–120 in
  4D. No arrangement is refused on cost. The generator count moves settle
  less than the seed does (section "Cost against generator count" below), so
  the four look-study ids ride the seven's radius, seed and depth spans
  unchanged.
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

Ten Surface showcases sit in their own **Sphere inversion** menu group: eight
3D, two native 4D. The first six are this section's; the four after
Icosahedral Lace are the look study's registry growth, recorded in "The look
study's four" below. The group holds both dimensions, as Space tiling does, and
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

### The look study's four (2026-09-22)

One preset per id the owner selected from the look study (its section below),
placed in the menu after Icosahedral Lace and before the 4D pair. The owner
chose all four to ship; the constructions and poses are delegated (lead
agent, owner to ratify). The mechanism is this section's, unchanged: a
`PRESET_SPHERE_INVERSIONS` block over the Sierpinski placeholder, render hint
`surface`, and a `PRESET_VIEWS` camera.

**Constructions.** Radius fraction .99. A ball seed is the study's own
sizing rule, 0.93 of the central void `1 − 0.99·tangentRadius`, rounded to
the panel's hundredths; that rule gives Kissing Pearls' .28 (0.279), so the
four are sized the way the shipped ball presets were. D8 for the balls, D6
for the shell, the shipped pearls' and lace's depths.

**Poses.** Auditioned as minted `#v1=` documents in the built app, 32
settled frames: three symmetry axes and one oblique per subject (two for the
tetrahedral shell), each at two radii, target the origin, fov 62. Every
candidate settled on compute with 0 exhausted rays in 5.7–14.4 s. The chosen
four were then re-rendered at their final radii before baking.

| Preset (menu label)                                 | Construction                | View                                      | Reading                                                                               |
| --------------------------------------------------- | --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `inversionTetraFrame` (Tetrahedral Frame)           | tetra4, ball .18, D8        | eye (.78, .78, .78), a vertex axis        | A triangular Sierpinski frame of lace round the seed; the registry's new silhouette   |
| `inversionDodecaWindows` (Dodecahedral Windows)     | dodec20, shell 1 ± .03, D6  | eye (1.4, 1.02, 1.66), oblique            | Pentagonal windows, each holding a three-fold rosette; six windows in view            |
| `inversionRhombiLace` (Rhombicuboctahedral Lace)    | rhombicuboct24, ball .6, D8 | eye (1.21, 1.21, 1.21), a three-fold axis | Four-fold lace crosses in the square windows round a large seed ball                  |
| `inversionIcosidodecaStar` (Icosidodecahedral Star) | icosidodec30, ball .64, D8  | eye (0, 1.1, 1.79), a five-fold axis      | A pentagonal lace frame; compute-only (30 generators, one past the fragment arm's 29) |

Choices and rejections:

- **The tetrahedron's BALL, not its shell.** The study named both: the ball
  as the one new silhouette, the shell as "a ball with three clean eyes".
  In the app the shell reads, from every audited direction, as a disc or a
  truncated cone with three recessed eyes: clean, but a simpler image than
  the Icosahedral Lace it resembles. One preset per id, so the ball.
- **The tetrahedral frame down a VERTEX axis.** The edge, face and oblique
  views lose the triangle: the three lace arms fan out from the red seed and
  overlap. Radius 1.35 frames it; 1.1 clips the top vertex and 1.8 leaves
  the frame small (5.9% covered).
- **The dodecahedral shell OBLIQUE, not down a face or vertex axis.** The
  axis views show the same windows in a symmetric ring; the oblique shows
  more of them at more angles, the way Icosahedral Lace was posed.
- **The rhombicuboctahedral and icosidodecahedral balls on an axis, at
  r 2.1.** At r 1.5 the large seed ball fills the centre and the lace is
  cropped; at 2.2 the whole cage is in frame. The rhombicuboctahedron's
  three-fold axis sets three four-fold crosses round the seed, its square
  axis only frames them at the edges. The icosidodecahedron's five-fold
  axis turns its thirty generators into a pentagonal frame; the three-fold
  view reads as a less ordered cage.
- **The seed balls are LARGE (.6 and .64).** Those voids are wide (the
  generators are small), and the sizing rule fills them. A smaller seed was
  not tried: the rule is what made the four comparable with the shipped
  pearls, and the lace, not the seed, is the subject.
- **No palette, lighting or finish**, as for the six.

Measured settles are in the qualification's 2026-09-22 rerun below: 5.9–9.0 s
on the AMD box, every one under the ~30 s preset target.

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
| Arrangement (select) | `arrangement`    | all eleven ids, 3D / 4D groups | decides the dimension; leaving 4D drops a present `cutDirectionW` (no control clears it) |
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

The replaced system's sections are DISABLED while a block is present,
refused blocks included, in both dimensions (lead review, overturning the
first delegated call that kept them editable). `docs/panel-ia.md` keeps a
dormant authored capability visible but disabled beside its reason, and
editing transforms nothing draws would silently queue an edit whose result
appears only when the block is removed.

- **Transforms, Xaos, Symmetry and Hybrid schedule** each show a note, "Sphere
  inversion replaces the transform system, so … not drawn. Turn off Sphere
  inversion to edit.", and every control inside the section is disabled and
  described by it (`aria-describedby`). That includes both halves of every
  slider pair, the transform list and editor, the final-lens toggle and the
  per-transform finish rows.
- **Auto-update is exempt.** It is a session preference, and it also governs
  whether a block edit regenerates Points.
- **The mechanism** is one pass in `ui.ts`. It runs after every owner (the end
  of `updateLabels`, and after each re-render of the list, the editor and
  Xaos) and MARKS what it disabled. The release pass runs at the START of
  `updateLabels`, before the owners re-sync, and re-enables only the marked
  controls, so an owner's own refusal (a one-transform Remove) survives the
  round trip.
- **The final-transform lens** keeps its own note beside the toggle while a
  lens is authored. **Per-transform finishes and patterns** key their note on
  the block's PRESENCE, not only on the Surface route kind; a refused block
  previously fell through to "Surface render unavailable".
- **Background** stays usable, but its Flame choice is disabled beside the
  reason. A document already on the Flame backdrop is told that the plain
  gradient shows instead.

**Transform edits under a block** still regenerate nothing and re-enter no
Surface (`planTransformEdit`'s `sphereInversionSubject`, pinned in
`transform-edit-effects.test.ts`), as defence in depth: an undo, an import or
a keyboard path could still reach the transforms. Eligibility still
refreshes, because its note names the dormant settings.

**The colour legend** keys "By Transform" by generation under a block:
`sphereInversionGenerationSlots(D)` chips from the same unauthored
`transformColors` spread Points and Surface use, captioned "seed", "gen 1" …
"gen N" (`legend-spec.ts`, pinned for 3D/4D Points and Surface). It is
hidden for a refused block, which draws nothing to key. Before this, it
showed the placeholder transforms' count (four chips for the presets'
Sierpinski tetrahedron).

### Verification

- **Numeric-control gate.** `scripts/panel-numeric-control.verify.mjs` now
  adds a block through its checkbox and walks the pearls, cut-shell and 4D
  cut-shell rows. A dedicated check requires all six sphere-inversion sliders
  to be paired and on screen. Both default 393×727 and 390×844 pass every
  verdict: 95 states, 125 distinct sliders paired, smallest companion 86×44 px,
  no overflow, no clipped domain value.
- **Geometry and shading move together** (real driver: Mesa Intel Iris Xe TGL
  GT2, WebGPU `intel gen-12lp`, compute, 1400×860, 8 antialiasing passes; not
  a cost measurement). From Kissing Pearls, each edit restarted Surface and
  settled with 0 exhausted rays:
  - ball radius .28 → .45 through the numeric field: larger seed balls and
    fatter pearl chains, covered 24% → 31%;
  - seed Ball → Shell: nested shell rosettes, 85%;
  - depth 8 → 2 by keyboard on the range: shallow windows, hues regrouped by
    generation.

  The document then held
  `{arrangement: "oct6", radiusFraction: 0.99, seed: {kind: "shell"}, depth: 2}`:
  the ball size was removed by the kind switch, and the depth written.
  Frames: `scripts/out/si-controls-{before,after-size,after-shell,after-depth2}.png`
  (gitignored).

## Qualification (2026-09-16, delegated)

The family's built-app gate is `scripts/sphere-inversion-family.verify.mjs`.
It shares its browser helpers with the presets gate
(`scripts/lib/sphere-inversion-gate.mjs`) and reads the preset table from
`presets.ts` itself (esbuild), so neither gate carries a copy of the
constructions. Every call in this section is DELEGATED (lead agent, owner to
ratify).

**Run.** `npm run build && npm run preview &`, then
`node scripts/sphere-inversion-family.verify.mjs --mode=x11::0`.
`--mode=sw` is the SwiftShader subset: menu entry, engine and document per
preset, plus the Flame/Solid and 4D refusal legs; no settle, frames or
exports. `--phases=presets,tiled,gl,toast,refusal` picks legs.

**Measured on** build `91cdc35` (the vault4 exterior re-pose, the panel
controls and the world-slice fix included), Mesa Intel Iris Xe (TGL GT2) on `:0`, WebGPU
`intel gen-12lp` (software = false), Playwright Chromium headed, 1600×900 at
DSF 1, 8 antialiasing passes, reduced motion. The machine-quiet baseline read
`quiet=YES` for the GPU at load1 1.1, so the settle seconds are this run's
and not a cost record (the cost section's are). Verdict: pass.

| Preset                 | Settle | Covered | Exhausted | Export 3200×1800 (bands) | Link reload | Second hop |
| ---------------------- | -----: | ------: | --------: | ------------------------ | ----------- | ---------- |
| `inversionPearls`      | 10.7 s |   22.0% |         0 | 34.8 s (2)               | byte-exact  | byte-exact |
| `inversionCubePearls`  | 11.1 s |   22.3% |         0 | 32.1 s (2)               | byte-exact  | byte-exact |
| `inversionVault`       | 20.9 s |   95.9% |         0 | 73.1 s (2)               | byte-exact  | byte-exact |
| `inversionLace`        | 12.8 s |   39.9% |         0 | 40.9 s (2)               | byte-exact  | byte-exact |
| `inversionVault4`      | 39.6 s |   29.0% |         0 | 133.1 s (2)              | byte-exact  | byte-exact |
| `inversionMedallions4` | 22.8 s |   40.5% |         0 | 79.8 s (2)               | byte-exact  | byte-exact |

What each leg established:

- **Menu, engine, census, document.** The live menu's Sphere inversion group
  is exactly the table. Every preset entered Surface from the menu on the
  compute engine and held the settle latch with no exhausted ray and no
  blank-frame toast. The `#v1=` document's block equals the table's, and so
  does the copied link's.
- **Distinct objects.** All 15 pairs of settled frames differ; the closest
  pair (the two pearl presets) differs on 27.5% of pixels.
- **Share links.** Every link reproduces the sender's frame byte for byte, in
  both dimensions, and the link is a fixed point: the reloaded session copies
  the same document and a second reload is byte-identical to the first. The
  gate tolerates no drift here. It did until this build: a 4D frame differed
  from its sender's (the vault on 0.64% of pixels, the medallions on 0.05%)
  because `FourDPose` stored the slice NORMALIZED against the landed cloud's
  4D half-extents while the cloud is seeded afresh per generation, so one
  document resolved to a slightly different world `w0` per run — two links
  differing in no field still rendered differently, and a session's own
  `sliceCenter` moved between runs (0.07378780 against 0.07382606). The pose
  now carries the slice as a WORLD hyperplane, preferred on decode, with the
  normalized value as the legacy fallback and the document left unrewritten.

- **Save PNG.** Every 2× export completed and has content (1,800–6,600
  coarse colours, luma standard deviation 24–45). The Iris's own ray ceiling
  already cuts a 2× export into 2 bands. Under `?surfacemaxrays=600000` the
  pearls (3D) and medallions (4D) exports traced in 10 bands, byte-identical
  to their 2-band exports. An export is centred where the pane is not (a
  capture zeroes the panel's right inset), so it is not compared with the
  pane.
- **WebGL arm (3D).** `?surfacegl` on the pearls and cube pearls: coverage IoU
  1.0000 against compute, mean colour difference 0.015 and 0.009/255 on
  jointly covered pixels. The WebGL and compute censuses agree (21.99% and
  22.27% covered). The mask is a per-row backdrop test at channel delta 16,
  which must agree with each engine's census before its IoU counts; delta 6
  read the backdrop's small along-row drift as 45.8% coverage. The WebGL
  arm's PREVIEW exhaustion is unreadable: `scene.ts` decodes a census from
  the settle target only. The GPU doc's 3.52/255 pearls row predates the
  colour-slot fix and used a minted document at 1024×640; these rows are the
  same construction at the preset's pose after the fix, not a rerun of it.
- **Flame/Solid refusal.** Two doors reach a block with Flame or Solid
  selected. Through the isolation handoff (a reload restoring the render
  mode onto a block document) the app stays in Points, shows the refusal
  toast and disables the button. Through undo the app is in Points with the
  button disabled and NO toast: `applyDecodedSnapshot` leaves for Points
  before the restored document refreshes the panel, so there is no session
  left to refuse. The same holds for redo, gallery loads and timeline legs.
  The gate's toast recorder is checked against Copy link's own toast, so a
  missing refusal toast is a real absence.
- **4D compute-only refusal.** Under `?surfacegl` both 4D presets stay in
  Points with the Surface button disabled and the note "native 4D
  sphere-inversion scenes render on WebGPU compute, which is unavailable
  here".
- **Teardown.** `scripts/surface-teardown.verify.mjs` gained
  `--document=<file.json>`. On the gate's share documents for
  `inversionVault` and `inversionVault4`, `--toggleId=__modeExit --toggles=20
--toggleGapMs=900` completed 20/20 mode exits in Firefox on the compute
  engine (dev server, same build), with no crash or page error.

**SwiftShader subset** (`--mode=sw`, same build): menu group, compute entry
and block match for all six presets, both Flame/Solid doors and both 4D
refusals pass.

Frames (gitignored, regenerate): `scripts/out/si-qual-<key>.png`, `-reload.png`,
`-reload2.png`, `-export.png`, `-export-tiled.png`, `-glsl.png`; the
contact sheet `scripts/out/si-qual-sheet.png`; raw figures
`scripts/out/si-qual-results.json`.

**Bench** (`:0`, `quiet=YES` before each run).

- `npm run bench:surface -- --display=:0 --surface-sphere-inversion-only=1`,
  rerun at `91cdc35`: every leg passed — eleven eval rows with 0 failures, 0
  one-sided failures and 0 generation or seed mismatches, the flat-4D
  reduction with 0 mismatches, both march rows with identical GPU and CPU hit
  counts, and the frame rows with 0 exhausted rays. Per query the kernels cost
  0.043–0.048 µs (3D) and 0.205–0.299 µs (600-cell) when measured at
  `4bedcff`. The verdict is `skipped` (exit 2), this mode's only passing
  verdict.
- `npm run bench:surface -- --display=:0` (full section), measured at
  `4bedcff` and not rerun since: `device-unreliable` (exit 2). The device was
  lost in the compute-frame leg `lens4SwirlPostOverFold`, after its march legs
  passed, the failure already on record for this Iris. The section's
  sphere-inversion legs come after that leg and did not run. The nonzero
  `fail=` rows before it are the `info`-level frontier-variant sweeps
  (`w4 s2=on`, `shared`), not gating rows. A full green section still needs a
  machine that holds the device through it (the AMD box), and its real-driver
  sphere-inversion rows stay owed.

### Rerun with the look study's four (2026-09-22, delegated)

The ten-preset table: the six above plus `inversionTetraFrame`,
`inversionDodecaWindows`, `inversionRhombiLace` and
`inversionIcosidodecaStar`. Measured on the preset branch's build (base
`a98072d`, the registry growth merged) on the AMD box: RX 7900 XTX on `:0`
(radeonsi, navi31), WebGPU `amd rdna-3` (software = false), Playwright
Chromium headed, 1600×900 at DSF 1, 8 antialiasing passes, reduced motion,
`quiet=YES` before every launch. The settle seconds are this machine's and
sit beside the Iris run above, not in place of it. Verdict: pass.

| Preset                     | Settle | Covered | Exhausted | Export 3200×1800 (bands) | Link reload | Second hop |
| -------------------------- | -----: | ------: | --------: | ------------------------ | ----------- | ---------- |
| `inversionPearls`          |  7.4 s |   22.0% |         0 | 21.6 s (2)               | byte-exact  | byte-exact |
| `inversionCubePearls`      |  7.2 s |   22.3% |         0 | 19.4 s (2)               | byte-exact  | byte-exact |
| `inversionVault`           | 14.5 s |   95.9% |         0 | 48.9 s (2)               | byte-exact  | byte-exact |
| `inversionLace`            |  9.7 s |   39.9% |         0 | 28.9 s (2)               | byte-exact  | byte-exact |
| `inversionTetraFrame`      |  5.9 s |   10.2% |         0 | 16.9 s (2)               | byte-exact  | byte-exact |
| `inversionDodecaWindows`   |  7.5 s |   27.2% |         0 | 22.8 s (2)               | byte-exact  | byte-exact |
| `inversionRhombiLace`      |  8.5 s |   24.8% |         0 | 25.9 s (2)               | byte-exact  | byte-exact |
| `inversionIcosidodecaStar` |  9.0 s |   25.7% |         0 | 26.7 s (2)               | byte-exact  | byte-exact |
| `inversionVault4`          | 15.0 s |   29.0% |         0 | 44.2 s (2)               | byte-exact  | byte-exact |
| `inversionMedallions4`     | 13.4 s |   40.5% |         0 | 42.2 s (2)               | byte-exact  | byte-exact |

- **Distinct objects.** All 45 pairs differ; the closest pair is Kissing
  Pearls against the Tetrahedral Frame, at 24.1% of pixels.
- **The six shipped presets are unmoved.** Their documents are unchanged, and
  the four 3D menu frames are byte-identical to an earlier same-day
  `presets,gl` run of this gate on the same box (the fragment-arm cap
  measurement's), made before any of the four existed. The 4D pair has no
  same-machine frame from before, so for them the evidence is the diff: this
  change touches the preset tables, the menu and the gates, and no renderer
  code.
- **Tiled export.** Pearls and medallions under `?surfacemaxrays=600000`
  traced in 10 bands, byte-identical to their untiled exports.
- **WebGL arm (3D).** `?surfacegl` against compute: the two pearl presets
  (the gate's default) and the three new presets that fit the arm. IoU
  1.0000 for all but the Tetrahedral Frame (0.9999), mean difference on
  jointly covered pixels 0.040–0.044/255, each engine's census agreeing with
  its mask.
- **Compute-only refusal, now per construction.** The leg no longer selects
  `dim === 4`: `loadSiPresets` asks the app's own
  `sphereInversionComputeOnlySubject` of each preset's resolved
  construction, and the leg runs on every preset that returns a subject,
  checking the Surface button's note names THAT subject. The Icosidodecahedral
  Star, 30 generators and one past the fragment arm's 29, stays in Points
  under `?surfacegl` with the Surface button disabled on "sphere-inversion
  scenes with more than 29 generators render on WebGPU compute, which is
  unavailable here". The 4D pair's note is unchanged. The leg fails if the
  table ever holds no 3D compute-only preset, so the capacity door cannot
  pass while gating nothing.
- **Flame/Solid refusal.** Both doors pass, after a gate fix: the toast regex
  still expected "Flame and Sampled Solid", and the app's copy has read
  "Flame and Solid" since the UI's Solid rename. The app was right and the
  gate was stale; the first run failed both handoff checks on wording alone,
  with the toast shown.
- **Teardown.** `scripts/surface-teardown.verify.mjs --document=` on the
  gate's share documents for the four new presets, `--toggleId=__modeExit
--toggles=20 --toggleGapMs=900`: 20/20 mode exits each in Firefox on the
  compute engine (dev server, same tree), no crash or page error.
- **Presets gate.** `scripts/sphere-inversion-presets.verify.mjs
--mode=x11::0` passes on all ten (menu entry, compute, coverage, the landed
  4D slice and its nudge, the clearing preset).
- **SwiftShader subset** (`--mode=sw`): passes on all ten.

**Bench** (`:0`, the same box, `quiet=YES` before each run).

- `npm run bench:surface -- --display=:0 --surface-sphere-inversion-only=1`:
  every leg passed, now twelve eval rows with the appended
  `siIcosidodec30Star3` (`docs/gpu-bench-surface.md` has its row).
- `npm run bench:surface -- --display=:0` (full section): **verdict
  `pass`**. This is the family's first full green section; the Iris lost the
  device before the sphere-inversion legs could run, and this box holds it
  through them. `escChainKaleido`, the known SwiftShader-only false failure,
  agrees here (`fail=0`).
- The brief's NON-UNIT or mixed-radius row is NOT added: no document can
  express a non-unit construction under the registry arm the look study
  chose, so the `uniformUnit` else-arm has no reachable consumer to pin.

## Authored generator sets: the look study (2026-09-22)

The gating study for authoring beyond the seven registry arrangements. The
document's AUTHORED form names an arrangement by id and gives every generator
one radius as a fraction of that arrangement's kissing radius; the RESOLVED
form underneath has always taken an arbitrary `{center, radius}` list. The
question is what the document should be allowed to say, and it is answered on
rendered panels rather than on expectation.

Nothing here reopens the construction, the certified bound, the cutoff
contract or the covering argument. Only the arrangements move.

**Run** (`scripts/sphere-inversion-authored-sets.harness.ts`; panels at
256 px, depth 6, generators at 0.99 × kissing throughout, so a row differs
from its neighbour by its CENTRES and by nothing else):

```bash
SIA_ROUND=r3d npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion-authored-sets.harness.ts
SIA_ROUND=par ...   SIA_ROUND=jit3 ...   SIA_ROUND=jit4 ...
```

It writes `scripts/out/sphere-inversion-authored-{r3d,par,jit3,jit4}.png`.
`SIA_FIELD=N` re-draws the jitter displacement field, which is how the
draw-dependence below was measured.

### Instruments

`de-preview.ts` renders every panel and `set-extent.ts` gives fill and reach
against the fold's MEMBERSHIP oracle, as everywhere else in this family. The
slice columns (`off`, `word0`, `vs3D`) are the native 4D search's, now shared
rather than copied: `scripts/sphere-inversion-slice.ts` holds the
sub-arrangement and the fold-word columns both sheets read, and the 4D
search's numbers are unchanged by the move.

One column is new. **`deep`** is the share of HIT pixels whose fold word is at
least TWO inversions long — a copy inside a copy, which is what NESTING means
at the pixel level. It exists because `copy` cannot answer the study's
question: a set whose generators have drifted apart still draws
first-generation copies long after the second generation has left the
picture, and `copy` reads those as structure. `word` (the mean word length
over hit pixels) is the same quantity read as an average rather than a
threshold.

Every panel of every round was **0.0% exhausted** at the 600-step budget, as
the 4D rounds were.

### The two radius rules

Validity needs pairwise-disjoint interiors, and the family refuses overlap
rather than clamping it, so an authoring gesture that can refuse mid-drag is
not acceptable. Both rules below are valid BY CONSTRUCTION at every fraction
in `(0, 1]`, so neither can refuse:

- **SHARED** (`SHR`), what the registry does today: one radius
  `f · d_min/2`, off the smallest centre-to-centre distance in the whole set.
- **OWN**, per generator: `r_i = f · d_i/2` off generator `i`'s OWN
  nearest-neighbour distance. Sound because `r_i + r_j = f(d_i + d_j)/2 <=
f |c_i − c_j|`, since `d_i` and `d_j` are both at most that distance. It
  costs the kernels' `uniformUnit` radial-reject fast path by definition.

The two coincide exactly on every vertex-transitive set, which is why only the
derived, parametric and jittered rows below carry both. No `OWN` panel in any
round was refused by `buildInversionScene`'s overlap check, which is that
inequality's executable check.

### 3D arrangements beyond the registry (`-r3d.png`)

Eleven centre sets, each with the pearls ball seed (93% of the central void,
which reproduces the shipped panels' hand-picked sizes to within a few
hundredths) and the unit lace shell. `n` is the generator count, `r` the
resolved radius, `copy`/`deep`/`word` the fold-word columns on the BALL panel.

| Set              |   n |     r | copy | deep | word | Reading                                                                                                                                                    |
| ---------------- | --: | ----: | ---: | ---: | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TETRA4`         |   4 | 0.808 | 0.97 | 0.71 | 2.94 | A triangular Sierpinski frame of lace with pearls inside it — the one NEW silhouette in the round, and the shell is a ball with three clean eyes           |
| `OCT6`           |   6 | 0.700 | 0.83 | 0.56 | 2.28 | Shipped bar                                                                                                                                                |
| `CUBE8`          |   8 | 0.572 | 0.83 | 0.47 | 1.77 | Shipped bar                                                                                                                                                |
| `CUBOCT12`       |  12 | 0.495 | 0.74 | 0.47 | 1.77 | Reads between `cube8` and `ico12`; nothing the two shipped ids do not already say                                                                          |
| `ICO12`          |  12 | 0.520 | 0.77 | 0.55 | 2.13 | Shipped bar                                                                                                                                                |
| `RHOMBDODEC14`   |  14 | 0.455 | 0.75 | 0.44 | 1.63 | `oct6 ∪ cube8`: an intermediate, weaker than either parent                                                                                                 |
| `DODEC20`        |  20 | 0.353 | 0.61 | 0.30 | 1.14 | Twelve pentagonal windows with rosettes in them — visibly denser than `ico12`'s and not a restatement of it                                                |
| `RHOMBICUBOCT24` |  24 | 0.354 | 0.70 | 0.43 | 1.55 | A strong four-fold lace cross; 24 windows in the shell. The densest set that still fits the fragment arm                                                   |
| `DISDYAK26`      |  26 | 0.300 | 0.53 | 0.24 | 0.92 | `oct6 ∪ cube8 ∪ cuboct12`: muddier than its parents, and its uneven neighbour distances already start the shared radius collapsing (`OWN` reads 0.59/0.33) |
| `ICOSIDODEC30`   |  30 | 0.306 | 0.64 | 0.38 | 1.37 | A four-pointed lace star; 30 windows. Past the fragment arm's 29-generator block capacity, so the first COMPUTE-ONLY 3D construction                       |
| `RHOMBTRIA32`    |  32 | 0.093 | 0.05 | 0.01 | 0.06 | COLLAPSED — a bare ball with a handful of dots                                                                                                             |

`RHOMBTRIA32` is the authoring hazard the epic predicted, measured on a
REGULAR set rather than a random one: `ico12 ∪ dodec20` puts two shells of
centres 0.19 apart, the shared kissing radius follows that one pair down to
0.093, and every generator shrinks with it. Fill reads 46% because what fills
the ball is the SEED, not its copies. The `OWN` rule recovers part of it
(`copy` 0.05 → 0.26, `deep` 0.01 → 0.06) and does not rescue it.

**Verdict.** 3D registry growth is worth having, and `TETRA4` is the clearest
case: the tetrahedron is the one arrangement here whose symmetry class is not
already in the registry, and it draws a silhouette the shipped three cannot.
`DODEC20`, `RHOMBICUBOCT24` and `ICOSIDODEC30` each buy a denser window
count that reads as its own object. The derived unions (`RHOMBDODEC14`,
`DISDYAK26`, `RHOMBTRIA32`) buy nothing: they read as intermediates at best
and as collapse at worst, and the derivation RULE that produced the good
dense sets — edge midpoints — is a build-time expression, not a document
field (`CUBOCT12` and `ICOSIDODEC30` are one function applied to `oct6` and
`ico12`).

### Parametric families (`-par.png`)

Rings, bipyramids, prisms, antiprisms with an authored aspect, and two
concentric shells — the tier that would buy freedom with a parameter schema
rather than a longer registry.

| Family                   |    n |        copy |        deep | Reading                                                                                                                                                                                                                                                        |
| ------------------------ | ---: | ----------: | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RING5` / `RING8`        |  5/8 | 0.58 / 0.36 | 0.23 / 0.12 | A bare seed ball with a necklace of pearls, thinning as `n` grows                                                                                                                                                                                              |
| `BIPYR6` / `BIPYR8`      | 8/10 | 0.56 / 0.40 | 0.22 / 0.13 | The same necklace with two poles added; `OWN` lifts `BIPYR6` to 0.74/0.45 by giving the poles their own radius, and it is still a necklace                                                                                                                     |
| `PRISM6 H.5`             |   12 |        0.60 |        0.27 | Reads well — and reads as a polyhedron, because at that aspect it nearly is one                                                                                                                                                                                |
| `ANTIPRISM6 H.5`         |   12 |        0.64 |        0.28 | Same                                                                                                                                                                                                                                                           |
| `ANTIPRISM8 H.35`        |   16 |        0.53 |        0.25 | Same, thinner                                                                                                                                                                                                                                                  |
| `SHELL2 O6+C8 D1.9/D2.6` |   14 | 0.91 / 0.84 | 0.79 / 0.57 | Genuinely unlike anything shipped — a sparse high-contrast constellation of clustered pearls — but at 0.16–0.37% fill and 11–17% hits it is scattered dust, and its centres are not at one distance, which costs the convention that seed lengths are absolute |

**Verdict: no.** Rings and bipyramids reproduce one dimension down exactly
what the native 4D search already read as "a bare seed ball with a few
pearls". Prisms and antiprisms read well only where their aspect makes them
approximately a regular polyhedron, which is to say they are worth exactly
the registry id they approximate. The two-shell sets are the only genuinely
new look in the round and they are sparse dust with a broken length
convention. A parameter schema and its refusal domain buy no object this
study would author.

### The jitter sweep (`-jit3.png`, `-jit4.png`)

The real form of the aesthetic question. Regular-versus-random is the two
ENDPOINTS of this sweep; the middle is what says whether explicit centres are
worth several KB of share link. Each base set gets ONE displacement field —
uniform directions, lengths uniform in `[0, 1]` — drawn once and SCALED, so
consecutive rows are the same perturbation seen harder rather than unrelated
draws. The amplitude `J` is a fraction of the base set's own edge.

3D, `deep` at 256 px (`oct6` with the pearls ball, `ico12` with the lace
shell), and the 4D 600-cell shell at its identity (passive) slice:

| J    | `oct6` SHR | `oct6` OWN | `ico12` SHR | `ico12` OWN | `cell600` SHR | `cell600` OWN |
| ---- | ---------: | ---------: | ----------: | ----------: | ------------: | ------------: |
| 0.00 |       0.56 |       0.56 |        0.39 |        0.39 |          0.29 |          0.29 |
| 0.05 |       0.42 |       0.48 |        0.28 |        0.35 |          0.16 |          0.23 |
| 0.10 |       0.32 |       0.42 |        0.20 |        0.31 |          0.09 |          0.18 |
| 0.20 |       0.20 |       0.33 |        0.10 |        0.24 |          0.02 |          0.11 |
| 0.35 |       0.10 |       0.25 |        0.03 |        0.17 |          0.00 |          0.04 |
| 0.50 |       0.08 |       0.19 |        0.01 |        0.11 |          0.00 |          0.00 |

What the panels show beside those numbers: at `J.05` the symmetry is visibly
broken but the object still reads as a nested cluster; at `J.10` about half
the lace is gone; at `J.20` the shared rule leaves a sphere with a few
satellites and the ico12 shell loses half its rosette windows; `J.35` and
`J.50` are a ball with dust. The 4D shell goes EARLIER — its windows are
empty dimples by `J.20` — and the reason is structural rather than
dimensional: the shared radius is a MINIMUM over pairs, the 600-cell has
~360 neighbour pairs to the octahedron's 12, and a minimum over more pairs
falls faster under the same per-centre displacement.

**THE AMPLITUDE BREAKPOINT IS DRAW-DEPENDENT, so it is quoted as a range.**
Three draws of the `oct6` field (`SIA_FIELD=0,1,2`, 64 px) put the shared
rule's `deep` at `J.50` at 0.12, 0.28 and 0.08 — a 3.5× spread at one
amplitude — because one unlucky pair sets the shared radius for the whole
set. The same three draws agree closely at `J.05` (0.52 / 0.59 / 0.55) and
`J.10` (0.43 / 0.57 / 0.48). Read the sweep as: **a regular set tolerates
about 5–10% of an edge with its structure essentially intact, is visibly
degraded by 20%, and is dust by 35–50%, with the exact crossing depending on
the draw.**

`OWN` is higher than `SHR` in every one of the 36 jitter rows measured, by
1.3× at small amplitudes and up to 2.7× at large ones, and the gap widens
exactly where the shared rule's radius collapses.

One 4D column is worth recording: `off` reads **1.00 at every jittered pose,
including the identity**. A jittered arrangement has no centre exactly in any
slice hyperplane, so it has no passive slices at all — 4D genuineness comes
free with perturbation, and comes with nothing else. (`word0` at the first
pose compares the reference with itself and is 1.00 by construction; it is
read on the later poses.)

### Verdict and the tiers

1. **More registry ids — YES, in 3D only.** Recommended: `tetra4` (a
   symmetry class the registry does not have), `dodec20` and
   `rhombicuboct24` (both inside the fragment arm's 29-generator block
   capacity), and `icosidodec30` as the first compute-only 3D construction if
   a densest id is wanted. Each is one entry in
   `SPHERE_INVERSION_ARRANGEMENTS`; the wire stays one string, validity is by
   construction, the dimension derivation is unchanged and `uniformUnit`
   holds. In 4D nothing is added: the native 4D beauty search already
   surveyed the plausible growth — 20 random S³ centres, the dual 24-cell at
   mixed radii, Hopf-linked necklaces, both Clifford-torus duoprisms and the
   96-centre snub 24-cell — and nothing beat the 600-cell.
2. **Parametric families — NO**, on the `par` round above.
3. **Explicit centres — NO.** The jitter sweep is the evidence: the
   interesting neighbourhood of a regular set is a few percent of an edge
   wide, so what explicit centres buy is either a set a registry id already
   names or dust. That is not worth several KB of `#v1=` hash per document,
   and it is the one tier whose cost is real.
4. **Per-generator radii — NOT NOW, and this is the rule to use IF tier 3 is
   ever reopened.** The DERIVED `OWN` rule beat the shared rule on every
   non-vertex-transitive set measured here, which is a different question
   from the 4D search's refusal of AUTHORED mixed radii (`.6/.4` on the dual
   24-cell) and does not contradict it. But it only bites on sets that are
   not vertex-transitive, which is exactly the sets tiers 2 and 3 would
   author and this study refuses. Every id in tier 1 is vertex-transitive, so
   the two rules are the same number there and nothing is owed.

So the epic's authoring vocabulary is **the registry arm alone**, which is the
outcome it was written to allow.

**Selected (owner, 2026-09-22): the registry arm with four ids** — `tetra4`,
`dodec20`, `rhombicuboct24` and `icosidodec30`. Tiers 2, 3 and 4 are refused
on the evidence above. `icosidodec30`'s 30 generators are past the 3D
fragment arm's block capacity, so it is the first shipped construction that
routes compute-only per CONSTRUCTION rather than per dimension, which is the
routing predicate that already landed; the other three fit the fragment arm.
The cost question the four ids leave open is the generator-count range, which
the epic measures separately — 30 is twice the largest 3D count shipped
today, and the covering tables are quadratic.

### What this study does not say

- Panels are CPU previews at depth 6 and one seed per family; a subject
  authored from a new id would be re-posed and re-seeded the way the shipped
  presets were.
- The jitter sweep reads ONE field per base set at each amplitude (three
  fields on `oct6` for the draw-dependence check above), not a distribution.
- `deep` is a PIXEL share at one camera, so it measures what the panel shows,
  not what the object contains — which is the point, and also its limit.

## Cost against generator count (2026-09-22, delegated)

The covering tables hold `n + s + n(s + n − 1)` generalized balls, QUADRATIC
in the generator count `n`: 21 at `tetra4`'s 4, 993 at `icosidodec30`'s 30,
14,763 at the 600-cell's 120. The look study's ids opened the 12-to-30 band
in 3D, which no earlier row had measured. This section asks whether cost
follows the tables. It does not: every measured cost is flat or close to
linear in `n`, because a query folds shallowly and its cover scan visits a
few candidates, not the whole table.

**Machine.** The AMD box: RX 7900 XTX on `:0` (radeonsi, navi31), WebGPU
`amd rdna-3` (software = false). `quiet=YES` before every GPU cell; the three
cells that first ran beside a desktop Firefox were rerun quiet by the probe
and moved by at most 0.1 s. Figures are this machine's, beside the Iris
record above rather than in place of it.

**Instruments.**

- CPU: `scripts/sphere-inversion-gencount.harness.ts`, one core, the median
  of three runs per figure.
- Compute and WebGL settle, preview exhaustion, per-dispatch work and shade
  share: `scripts/sphere-inversion-cost.probe.mjs --plans=gencount`, 1920×1080,
  8 antialiasing passes, identity pose, trusted click and 3 s drag, raw rows
  in `scripts/out/sphere-inversion-cost-gencount.json`.
- GPU µs per query: the bench's timing leg (`docs/gpu-bench-surface.md`).
- Export: the qualification rerun's Save-PNG times, one preset per id.

Every row uses the cost probe's representative seeds (3D ball .28, shell
1 ± .03, cut shell 1 ± .06; 4D ball .28, shell 1.1 ± .03, cut shell
.9 ± .04), radius fraction .99, D8 in 3D and D5 in 4D (settle is flat in
depth, "Depth: not a cost lever").

### Surface settle, preview exhaustion and dispatch (compute, WebGL in 3D)

| Arrangement      |   n | Seed     | Compute settle | Preview exh max % | Max dispatch ms | Shade % | WebGL settle |
| ---------------- | --: | -------- | -------------: | ----------------: | --------------: | ------: | -----------: |
| `tetra4`         |   4 | ball     |          6.9 s |              2.14 |             2.9 |      61 |        3.0 s |
| `tetra4`         |   4 | shell    |          6.4 s |              0.09 |             0.8 |      75 |        2.7 s |
| `tetra4`         |   4 | cutShell |          6.5 s |              0.33 |             0.9 |      75 |        2.8 s |
| `oct6`           |   6 | ball     |          6.9 s |              2.08 |             2.1 |      73 |        3.2 s |
| `oct6`           |   6 | shell    |          7.8 s |              0.49 |             2.4 |      81 |        3.0 s |
| `oct6`           |   6 | cutShell |          7.4 s |              1.02 |             1.7 |      85 |        3.1 s |
| `cube8`          |   8 | ball     |          6.7 s |              2.80 |             3.2 |      70 |        3.3 s |
| `cube8`          |   8 | shell    |          6.4 s |              0.16 |             0.8 |      82 |        2.8 s |
| `cube8`          |   8 | cutShell |          6.4 s |              0.19 |             1.2 |      87 |        3.1 s |
| `ico12`          |  12 | ball     |          6.8 s |              2.97 |             2.8 |      82 |        3.8 s |
| `ico12`          |  12 | shell    |          6.3 s |              0.18 |             0.9 |      87 |        3.0 s |
| `ico12`          |  12 | cutShell |          6.5 s |              0.75 |             1.6 |      89 |        3.4 s |
| `dodec20`        |  20 | ball     |          5.6 s |              0.73 |             2.2 |      81 |        3.9 s |
| `dodec20`        |  20 | shell    |          6.4 s |              0.04 |             1.0 |      91 |        3.4 s |
| `dodec20`        |  20 | cutShell |          6.9 s |              0.24 |             1.5 |      93 |        3.6 s |
| `rhombicuboct24` |  24 | ball     |          6.4 s |              1.74 |             3.3 |      88 |        4.2 s |
| `rhombicuboct24` |  24 | shell    |          6.5 s |              0.08 |             9.9 |      91 |        3.5 s |
| `rhombicuboct24` |  24 | cutShell |          7.0 s |              0.46 |             1.9 |      94 |        3.8 s |
| `icosidodec30`   |  30 | ball     |          5.7 s |              0.98 |             3.0 |      88 |            — |
| `icosidodec30`   |  30 | shell    |          6.9 s |              0.19 |             2.7 |      93 |            — |
| `icosidodec30`   |  30 | cutShell |          7.7 s |              0.50 |             2.2 |      94 |            — |
| `cross8`         |   8 | ball     |          9.6 s |              8.95 |             6.2 |      78 |            — |
| `cross8`         |   8 | shell    |         10.4 s |              0.63 |             2.8 |      82 |            — |
| `cross8`         |   8 | cutShell |          9.6 s |              3.12 |             5.0 |      85 |            — |
| `tess16`         |  16 | ball     |          5.5 s |              0.12 |             2.4 |      48 |            — |
| `tess16`         |  16 | shell    |         10.5 s |              0.67 |             1.8 |      87 |            — |
| `tess16`         |  16 | cutShell |          9.5 s |              0.44 |             2.2 |      88 |            — |
| `cell24`         |  24 | ball     |          9.5 s |              8.51 |             8.9 |      86 |            — |
| `cell24`         |  24 | shell    |         10.5 s |              0.48 |             3.5 |      93 |            — |
| `cell24`         |  24 | cutShell |         11.3 s |              2.91 |             5.9 |      94 |            — |
| `cell600`        | 120 | ball     |         16.9 s |              7.57 |            38.9 |      88 |            — |
| `cell600`        | 120 | shell    |         15.3 s |              0.64 |             8.0 |      95 |            — |
| `cell600`        | 120 | cutShell |         23.7 s |              4.87 |            30.6 |      93 |            — |

Every one of the 51 cells settled with 0 exhausted rays. WebGL stops at
`rhombicuboct24`: `icosidodec30` is past the fragment arm's 29 generators.

- **3D compute settle is flat in `n`**: 5.6–7.8 s from 4 generators to 30,
  the table growing 47×. The 30-generator cells sit inside the 6-generator
  ones' spread.
- **The WebGL arm grows, mildly**: 2.7–3.3 s at up to 8 generators,
  3.4–4.2 s at 20–24, about +30%, and still faster than compute here. The
  fragment path's per-eval scratch and cover scan are the growth the
  routing child predicted; at the block ceiling it is not a cliff.
- **Preview exhaustion follows the SEED, not `n`.** Balls exhaust most
  (0.7–3.0% in 3D); the four new ids sit at or below `ico12`'s ball.
- **Shade share rises with `n`** (61–75% at 4 generators, 88–94% at 30 in 3D): the shading taps grow with the generator count while the march does
  not. The dispatches stay far under any watchdog (≤ 10 ms in 3D, ≤ 39 ms on
  the 600-cell).
- **4D** is 5.5–11.3 s from 8 to 24 generators and 15–24 s at 120, the
  600-cell staying the family's costliest arrangement as on the Iris.

### Per-query cost: CPU and GPU

CPU, µs per query (`sphere-inversion-gencount.harness.ts`; uniform in the
bounding ball at the identity slice, and 0.005 off the set):

| Arrangement      |   n |         Balls | Uniform µs (ball / shell / cut) | Near µs (ball / shell / cut) |
| ---------------- | --: | ------------: | ------------------------------- | ---------------------------- |
| `tetra4`         |   4 |         21–31 | .45 / .33 / .32                 | .22 / .19 / .17              |
| `oct6`           |   6 |         43–57 | .40 / .44 / .32                 | .20 / .23 / .22              |
| `cube8`          |   8 |         73–91 | .50 / .33 / .37                 | .21 / .23 / .23              |
| `ico12`          |  12 |       157–183 | .66 / .51 / .54                 | .27 / .31 / .31              |
| `dodec20`        |  20 |       421–463 | .98 / .66 / .74                 | .33 / .38 / .37              |
| `rhombicuboct24` |  24 |       601–651 | 1.25 / .86 / .91                | .39 / .46 / .45              |
| `icosidodec30`   |  30 |       931–993 | 1.50 / 1.01 / 1.10              | .47 / .52 / .51              |
| `cross8` (4D)    |   8 |         73–91 | .71 / .37 / .46                 | .23 / .23 / .26              |
| `tess16` (4D)    |  16 |       273–307 | 1.01 / .50 / .60                | .29 / .32 / .32              |
| `cell24` (4D)    |  24 |       601–651 | 1.30 / .88 / 1.03               | .41 / .42 / .47              |
| `cell600` (4D)   | 120 | 14,521–14,763 | 7.31 / 5.42 / 4.99              | 1.62 / 1.81 / 1.87           |

The near-set cost, the queries a tracer spends its steps on, is close to
LINEAR in `n`: a line through the 3D rows (about 0.16 + 0.011·n µs) predicts 1.5 µs at 120, and the 600-cell measures 1.6–1.9 µs: close to linear, slightly above it at the far end, and nowhere near the tables' quadratic growth. Uniform queries grow
faster (3–4× across 3D), because a point far from the set scans more cover
candidates before it can bound, but they are not where a tracer is.

GPU, µs per query over each row's whole 700-query mix (the bench's timing
leg): 0.024–0.032 at 6, 8, 12 and 30 generators in 3D, 0.024 at 24 in 4D,
0.045–0.058 at 120. FLAT across the 3D band, and the 600-cell costs about 2× a 3D row, where its CPU near-set cost is 3.5–9× a 3D row's. Run to run the same row moves about 15%
(the pearls read 0.036 and 0.031 in two runs), so differences inside the 3D
band are noise.

**Points sampling** (the same sheet, 200k points, one core): prepare stays
under 1 ms for every ball seed and grows about linearly for shells, 3 ms at
4 generators to 20 ms at 30 and 120–126 ms on the 600-cell. The steady cost
is 330–2,240 ns per point in 3D with no clear trend in `n` (the seed kind moves it more: balls 330–530, cut shells 1,120–2,240), and 1.5–5.3 µs on the 600-cell. No row skipped a point.

**Export** (the qualification rerun, 3200×1800, 2 bands): the new ids'
presets exported in 16.9–26.7 s against the shipped 3D presets' 19.4–48.9 s.
The vault's interior view is the slowest export by pose, not by `n`.

### The uniformUnit-off penalty

Every registry arrangement is a UNIT arrangement, so the kernels take the
radial reject and nearest-centre pick. The linear first-containing scan is
correct for any construction and is what a non-unit or mixed-radius set
would take. The bench times each timing row a second time with the flag
cleared on the same tables and queries:

| Row                            |   n | Unit µs | Linear µs |
| ------------------------------ | --: | ------: | --------: |
| `siOct6Pearls3`                |   6 |   0.031 |     0.027 |
| `siOct6Kiss3`                  |   6 |   0.025 |     0.026 |
| `siCube8Shell3`                |   8 |   0.032 |     0.024 |
| `siIco12Vault3`                |  12 |   0.024 |     0.023 |
| `siIcosidodec30Star3`          |  30 |   0.026 |     0.029 |
| `siCell24Shell4`               |  24 |   0.024 |     0.023 |
| `si600Vault4@XW.3W.1`          | 120 |   0.045 |     0.048 |
| `si600Medallion4@XW.4YW.3ZW.2` | 120 |   0.058 |     0.057 |
| `si600Snowflake4@W.06`         | 120 |   0.056 |     0.061 |

The linear arm is within −25% to +12% of the unit arm on every row, inside
the timing's own run-to-run spread, and faster on five of nine. **Verdict:
cost is not what keeps non-unit and mixed-radius sets out.** On this card
the linear arm is a usable capability; those sets stay undocumented because
the look study refused the tiers that would author them, on how they look.
The unit arm's early exit is real work saved on the CPU (the radial reject
ends 12–74% of fold tests), but a GPU query here is so cheap that it does
not show in the timing.

### Verdict and ranges

- **Public generator-count range: every registry arrangement**, 4–30 in 3D
  and 8–120 in 4D. The document domain is the same set of ids, so the control
  range is the whole domain, and nothing clamps. No id is refused or demoted
  on cost: the costliest 3D cell settles in 7.8 s, and 4D's costliest remain
  the 600-cell rows already public at 15–24 s.
- **What would move this.** A future id past 30 in 3D is compute-only, and
  past the kernel's 120-generator scratch (`SPHERE_INVERSION_GPU_MAX_GENERATORS`)
  needs its own cost argument. Nothing measured here predicts a cliff before
  either.

## Glass: the curved-solid look gate (2026-09-22)

The finite/simplicial glass solid is flat-faced by construction, so the
dielectric transport has never had a CURVED fractal to render. This family is
the cheapest curved candidate, and the look gate asked the only question that
decides whether to build one: does glass on the depth-D seed orbit read like
glass. `scripts/sphere-inversion-glass.harness.ts` is that gate — a prototype
signed field built entirely in the sheet from public calls, driven through
`surface-dielectric.ts` (the one transport oracle) over the closed-solid
boundary query's f64 twin, with matched opaque controls and a checkered
studio. No production module changed.

VERDICT: the look is real in both dimensions, and it is a curved-glass look
the cell constructions cannot produce at any level — refraction of the floor
through smooth pearls, with Fresnel rims and Beer tint.

The field needed no new arithmetic. Membership was already exact here (`<= 0`
is the folded seed SDF), the folded interior clearance is the closed form
`-sdfIntersection`, and carrying it back out through the fold is the SAME map
`inversionDistanceLowerBound` already applies to the empty-ball bound: for a
folded clearance `rho` at distance `s` from the inversion centre, the
clearance at the unfolded point is `R²·rho / (s·(s + rho))`, which is
`r²·rho / (R² + r·rho)` — that function term for term. Measured sound in all
three senses the march needs: zero membership disagreements against
`sphereInversionContains` over 200k samples at depths 2/4/6/8, zero clearance
overshoot against the explicit orbit, and zero oversteps in 8k interior
samples.

What the gate found is a RESOLUTION question, not an estimator one. The
crossing band fires where the certified lower bound is merely loose — a
near-kissing arrangement puts a near-cusp at every tangency — and the
caller-carried medium then drifts, so a path marked inside sits in empty
space, marches out of the domain and fails the whole trace `inside-miss`. Two
remedies were measured. A MEMBERSHIP GATE on the crossing (real only if
`sphereInversionContains` actually flips across it — a test this family can
afford and the closed-solid backend cannot) takes 65-98% unresolved down to
23-36%. Refining the declared optical resolution does the rest:
`inside-miss` falls 3671 → 2162 → 475 → 10 at R/512 → R/2048 → R/8192 →
R/32768, at 2.3x CPU cost, and what remains is the path budget rather than a
defect. At R/8192 with a 2048-path budget the depth-6 subjects resolve 92-93%
of pixels; the 4D posed slices resolve 85-88%. Re-deriving the medium from
exact membership at every query does NOT help and is kept as a refuted row:
the flip has to be judged along the child's direction, not the incident one.

The depth sweep is the one a later look decision is spent against: depth 1-3
render as clean, convincing glass, depth 4 speckles, and 6-8 read as lace —
so the best glass sits at the CHEAP end of this family's cost curve, the
opposite of where the estimator's cost concentrates. The 4D arm uses the
sheet's own cheap arrangements because `cell600` — both shipped 4D presets —
costs about 20x per evaluation and no glass panel of one finished on the CPU;
that is a cost finding about the arrangement, not about the dimension.

### The signed field lands (2026-09-22)

`sphereInversionSignedDistance` and `sphereInversionSignedDistance4` are the
gate's field, shipped: the existing estimator outside, and inside a certified
interior clearance — a lower bound on a member's distance to the complement of
`O_D`. Both dimensions landed together; every existing path is untouched
(pure additions, no existing line changed), and the sheet now calls the
shipped entries instead of keeping its own copy, re-rendering its 3D panel
BYTE-IDENTICALLY.

THE INTERIOR VALUE IS EXACT IN FOLDED COORDINATES AND EXACTLY TRANSPORTED OUT.
`K ∩ F` is an intersection of generalized balls with exact member SDFs, so the
clearance there is `−max_i(sdf_i)` — the value the estimator already computed —
and carrying it out is `transportSphereInversionBound` unchanged, because the
full-ball law IS the empty-ball law (the identity recorded above). It is
deliberately conservative at the seams: the clearance is the containing
PIECE's, and the union may reach further past a generator sphere where the
next copy continues, so a march understeps there and never oversteps.

THE SIGN AGREES WITH `sphereInversionContains` BY CONSTRUCTION, not by
measurement, and the argument is the fold's: at DOMAIN the folded point lies
outside every generator ball (the fold inverts through any ball but the
parent, and inversion through the parent put the point outside it), so every
copy and gap term — each contained in its own ball — is positive, and the only
term that can be non-positive is the domain seed, which is exactly what
membership tests. At EXHAUSTED the point sits inside some non-parent ball,
which the seed's `ext(B_i)` members make positive, and that ball's own copy
term is skipped for want of budget. A POLE returns 0.

THE SIGN IS ALSO CUTOFF-INDEPENDENT, which is worth stating because the
obvious worry is that it is not: a cutoff exit returns a small POSITIVE
decision value, so an exit taken before a negative term was reached would
invert the sign. It cannot happen — a member's negative term is the domain
seed, the FIRST term evaluated, and it short-circuits ahead of every cutoff
test. A member returns the same value at every cutoff, pinned in the tests.
The signed entries still take no cutoff, because one would buy nothing: the
interior branch is a single table scan, and the exterior branch IS the
unsigned estimator.

Pinned per fixture across the shipped arrangements, seed kinds and depths, in
both dimensions: bit-identical to the unsigned estimator outside; sign ≡
membership; interior clearance never above `explicitOrbitClearance` (the
oracle's new interior reference — the largest inscribed radius among
containing pieces, a sound lower bound on the union's own clearance); and the
interior value is a STEPPING bound, a step of `|f|` in any direction staying
inside. The 4D arm adds the flat reduction (bit-identical to 3D at `w = 0`)
and the posed-slice arm at zero slab thickness, where a step of `|f|` taken
WITHIN the slice keeps the displayed point a member — the in-slice reading the
module doc's inequality licenses. The degenerate Möbius case (a clearance ball
that swallows an inversion centre) has its own fixture.

### The f64 transport twin (2026-09-22)

The twin's boundary query, medium cross-check and shadow visibility read the
signed field in both dimensions, through ONE addition to
`surface-transport-fixture.ts` rather than a second copy of either march:
`TransportFixtureSystem.contains`, the family's exact membership predicate.
Absent — every closed-solid and estimator caller — both marches run their
existing path, and the twenty pre-existing transport tests are unchanged.

THE MEMBERSHIP GATE is what the predicate buys, and it is the look gate's
finding made production. A band test `|f| < eps` is a boundary test for a
signed DISTANCE; for a certified BOUND it fires wherever the bound is merely
loose, and a near-kissing arrangement puts a near-cusp at every tangency where
the bound reaches ~0 with no surface there. So a crossing is accepted only
where membership actually FLIPS across the landing; a phantom costs steps on
the same budget, never a crossing. The medium cross-check asks the predicate
too, rather than the sign of a loose bound, and the shadow march's
stride-crossed-the-band branch likewise.

THE BAND'S WIDTH IN SPACE IS THE MEASURED FIGURE the sub-step guard is
qualified against, and it is a different regime from the closed-solid field's.
That field is SAFETY-scaled, so its gradient at a face is 0.9 and its declared
band is 1.11·eps wide — comfortably inside four 2·eps sub-steps. This field's
gradient falls where the transport compresses: measured over 400 band samples
on `oct6` at radius fraction 0.99, seed 0.28, depth 6, the band is **3.10·eps
wide on average and 42.63·eps at worst** — five times the guard's whole reach
at the mean-worst end, and thirty-eight times the closed-solid width. Raising
the count is not the fix and the constant stays at four: what ends the advance
honestly is the exact-membership exit beside it, and the march's own budget
behind that. `TRANSPORT_SHADOW_BAND_SUBSTEPS` carries the reasoning.

THE ANALYTIC CONTROL is independent of both the twin and the field: a depth-0
construction on `oct6` whose generators reach in to 0.3 and never touch a seed
of radius 0.28, so `K ∩ F` is the seed ball alone and a normal-incidence
shadow ray pays exactly `(1 − F0)²` and Beer over the diameter. The three
singular outcomes have a test each — a ray at a generator centre, a kissing
tangency cusp, an exhausted fold — and each asserts the same thing: whatever
the query returns, it never invents a crossing membership does not agree with.
The 4D arm runs the same query over the 4D field through the app's own posed
lift at zero slab thickness, and checks the flip on the DISPLAYED point.

### The WGSL half (2026-09-23)

The optical transport's fourth boundary backend, `opticsBackend:
"sphereInversion"`, in both sphere-inversion cores. It RIDES the closed-solid
query rather than restating it: the signed-field march, the tetrahedron taps,
the medium cross-check and the floor corridor's straight shadow visibility are
the closed-solid backend's text, over this family's field, and the membership
gate the f64 twin carries is spliced into four places under this backend
alone: the boundary landing, the anchored medium cross-check, the shadow band
fire with its band advance, and the shadow march's stride-crossed branch.
Nothing above the seam changed for any other backend.

THE FIELD. `sphereInversionWgslSource(dim, signed)` adds one `SiResult.clear`
member and one transport of the folded clearance when `signed` is set; the
kernel's `transportSolidField` reads `-clear` for a member and the shipped
`d` otherwise, and `transportSolidContains` reads `clear >= 0`, the membership
bit off the SAME evaluation. `d` keeps its unsigned meaning, so the primary
march and the hit-info read exactly what an opaque session reads. The 4D field
lifts the displayed point through `liftSphereInv4`, the core's own view lift,
at zero slab thickness (the core refuses a slab). Its f32 twin is
`sphereInversionSignedF32`.

THE f32 ARGUMENT, and a correction to the premise it was filed under. The
worry was the Möbius ball factor `R²/(|c|² − r²)`, which cancels where a ball
nearly swallows the inversion centre. NEITHER half emits that form: the
transport is `inversionDistanceLowerBound`'s distance form, whose one division
is by `R²/qr + v`, a sum of positives, so no ratio of clearance to fold radius
cancels, including a clearance ball that swallows the centre. The one small
divisor is `qr` inside `R²/qr`, and the POLE floor (`qr² <= 2^-40·R²` refuses
to invert) already bounds it. So the guard the interior half needed exists
already and is inherited, and the disclosed threshold is the slack itself: a
member whose transported clearance is at most `1e-6` world units reads field
0, inside the crossing band and never on the wrong side of it. The per-step
rounding sits under the transport's `1 + 2^-20` margin, and the folded
decision value's error comes back unamplified at its own step's scale. That is
the argument that made the exterior's excess flat in depth, and nothing in it
reads the sign, so the same absolute slack comes off the interior magnitude.

MEASURED on the f32 twin, before the slack, against the f64
`sphereInversionSignedDistance`/`-4`, over up to 3000 interior samples per
fixture:

| Fixture                                    | Worst f32 clearance excess |
| ------------------------------------------ | -------------------------- |
| oct6 ball .28, depth 3                     | 9.06e-8                    |
| oct6 kissing, depth 6                      | 9.99e-8                    |
| oct6 kissing, depth 12                     | 9.99e-8                    |
| ico12 near-kissing ball .47, depth 4       | 5.63e-8                    |
| oct6 generator-crossing ball 1.15, depth 2 | 1.39e-7                    |
| cube8 shell, depth 7                       | 1.25e-7                    |
| cell24 ball .3, depth 3 (4D)               | 4.16e-8                    |
| cell24 near-kissing ball .5, depth 6 (4D)  | 9.34e-8                    |

Flat in depth (kissing oct6 reads the same at 6 and 12), and the worst case is
the centre-swallowing fixture, 7× under the slack. Without the slack the twin
overshoots f64 on every fixture, so the slack is needed and sufficient, not
decorative. The real-driver figure is owed. The exterior's measured pre-slack
peak was `5.35e-7` on Iris against the CPU emulation's `3.3e-7`, so a driver
may widen the interior's margin too.

THE WIRE. No params offset moved and nothing was appended: the interior reads
the same tables, the same `siRadii.w` slack and the same pole floor. Absent the
backend, every generated kernel is byte-identical to the pre-change module:
checked over eleven cores × three modes × twelve option sets (closed-solid and
finite-solid backends included) before the commit, and pinned per dimension in
the tests. The only differences are the reworded optics refusal for the
sphere-inversion cores. Optics on those cores without this backend still
refuses, and the backend on any other core refuses: the displayed set IS the
optical solid.

COMPILED on Chrome/Dawn (SwiftShader adapter, 2026-09-23): the 3D and 4D glass
kernels, with and without the floor and finishes, build both the shade and the
transport pipelines; a deliberately broken control is rejected, so the check
sees errors. That is a WGSL validity check, not a real-driver measurement.
Agreement with the twin on a device and the real-driver timing are the bench
work that follows.

COMPUTE-ONLY in both dimensions by decision: no GLSL twin exists, and the 3D
fragment arm keeps rendering the family opaque, byte-identical. A glass session
must therefore exit with the disclosed toast on a compute loss rather than fall
back, which is a routing rule and lands with the routing admission, since
nothing routes this backend yet.

### Routing admission and the authoring home (2026-09-23)

THE AUTHORING HOME IS THE HIT ATTRIBUTION. The block gains an optional
`materials` list (`SphereInversionAuthored.materials`). Entry `g` shades
generation `g`, the word length the kernels report as the hit's slot, and the
last entry covers every deeper generation, which is the shade entry's own slot
clamp; a one-entry list is one material for the whole set. Each entry carries
the transform system's `finish` and `optics` vocabulary with the same absent
meanings and resolve-time domains, so a material means one thing on either
subject. It was chosen over a single block-level field for three reasons.
The transform system's materials are keyed on the slot a hit reports, and
this family's slot IS its generation, so one rule decides which material
shades a hit on either subject. It lifts the dormant-finish question together
with the glass one. And per-generation glass costs no new wire later. A
per-seed-member material would be a sibling field, not a reinterpretation.

THE WIRE. Persistence already keeps the block verbatim, so no decoder changed;
the resolver is the validator. Absent is byte-identical for every document
predating the field. The list must hold 1 to
`sphereInversionGenerationSlots(32)` = 35 entries. Unknown keys refuse by
name at every level (entry, finish, optics), an optics `model` must be a
`SURFACE_OPTICS_MODELS` id, and every numeric leaf must be finite. Ranges are
not refused: they belong to the material resolvers, as they do for a
transform's material. A refused list routes to the panel's Material row with
its repair.

THE ADMISSION (`surface-optics-backend.ts`'s `sphereInversionGlassAdmission`,
read by the session door once per start and by the panel's note, so the two
cannot disagree):

- Seed kinds `ball` and `shell`, the ones the look gate rendered (pearls and
  lace). The field's soundness never reads the seed kind, but no cut-shell
  glass panel was ever reviewed, so the cut-shell vaults render opaque with the
  reason disclosed.
- Depth up to 8, the band the look gate swept. Deeper is unreviewed and
  costlier.
- Up to 30 generators, BY MEASUREMENT. The arrangement is not restricted for
  the look: the soundness argument never reads it, the signed tests span 3D
  oct6/cube8/ico12 and 4D cell24/cross8/tess16, and the look is set by seed
  and depth rather than by which polytope places the mirrors. Its generator
  count is restricted for the watchdog. On the RX 7900 XTX a single WORKGROUP
  of 600-cell glass trace (120 generators, shell, depth 2) ran 2.06 s and
  lost the device at the box's ~2.0 s job cut, and the transport lane cannot
  dispatch less than one workgroup. Every arrangement up to icosidodec30 (30)
  kept its worst dispatch under 1.5 s. So the shipped 600-cell presets render
  opaque with the reason disclosed, and lifting the cap needs a resumable
  trace for this backend (the finite backend's chunked continuation), not a
  larger number.
- Compute: the backend is compute-only in both dimensions, so glass the
  routing would admit is a compute-only SUBJECT (`sphereInversionComputeOnlySubject`
  names "sphere-inversion glass scenes"). Without compute the Surface gate
  refuses the session, and a mid-session loss exits with that phrase's toast.
  It never falls back to the fragment arm, which would draw the set opaque.
- The family's existing refusals (tiling, balloon, shape trap, slab) refuse the
  whole session upstream, and the dormant capabilities are not read by this
  subject, so neither needs a term here.

Refused glass renders opaque, and the Surface gate's degraded note and the
Material row both say why in the admission's own words.

4D NEEDS NO POSE ADMISSION, and that is a verdict, not an omission. The object
is intrinsically 4D and the slice cuts it. The field lifts the displayed point
through the live rotor/slice on every query exactly as the primary march does,
and a slice's clearance is at least the 4D clearance. So scrubbing the slice or
turning the rotor mid-session moves the displayed object and the field
together; nothing decouples, unlike the closed-solid backend's flat penalty.
Zero slab thickness is the one pose condition, and the family already holds it
for every session.

THE PANEL. A Material select (Classic, Glass) sits at the foot of the Sphere
inversion section. Classic removes `materials` outright, so the block is
byte-identical to one that never carried it. Glass writes one dielectric entry
at the resolver defaults. Any other list reads "Authored materials" and is
kept verbatim. The note beside the row states what glass does and where
(Surface, compute only, Points opaque) or why it renders opaque. A material
edit refreshes the gate and restarts a live Surface session, because the
backend is decided once per session and never re-routed mid-session. Points
does not regenerate, since it samples the boundary whatever the material.
Finish authoring on the panel is not offered yet: the wire carries it, and the
per-transform finishes stay disclosed as dormant.

THE OPTICAL RADIUS is the estimator's origin-centred bounding radius, the ball
the look gate's transport measured against. The declared crossing scale is
therefore `R/512`, the shipped relative constant. The look gate measured that
scale leaving `inside-miss` mass that `R/8192` resolves, so it is the envelope
work's first question, not a routing one.

### Agreement on the real driver, and the two defects it found (2026-09-23)

The WGSL half now has agreement legs in the transport runner, pinned against the
f64 twin on the RX 7900 XTX: an analytic ball and a near-kissing orbit in each
dimension, with named pole, cusp and graze probes. Their record is
`docs/gpu-bench-surface.md`'s glass section. Getting them green found two real
defects, and both were fixed in the kernel and the twin together.

THE PRIMARY SPLIT TAPPED THE WRONG FIELD (kernel only). `transportTrace`'s split
at the march's own hit took its normal from `transportOpticalNormal`, whose taps
read `surfaceDE`. For these cores that is the UNSIGNED estimator, whose interior
values are folded member signals at the wrong scale, so a split straddling the
surface drew a garbage normal. The twin taps the signed field. The closed-solid
backend never showed it because there the two fields coincide. On the orbit's
near-cusp probe the kernel traced straight through, returning the backdrop,
where the twin trapped the light. The glass backend now splits on
`transportSolidNormal`, and every other backend's text is unchanged.

THE QUERY COULD STEP PAST A REAL EXIT (both engines). Near a tangency cusp the
transported bound's gradient degenerates. The band landing's "is the zero
ahead" test then read backwards and stepped past the band, and the march
continued outside under the inside claim until the domain edge: inside-miss.
The twin replay showed the field going from −0.018 to +0.008 across a real exit
the query never reported.

The fix is a MEMBERSHIP-CROSSED branch. When a sample's field sign and exact
membership both contradict the claimed medium, beyond the anchor envelope, the
crossing lies between the previous sample and this one. The branch bisects
exact membership there (`SURFACE_GPU_TRANSPORT_MEMBERSHIP_BISECT_STEPS` = 12,
a stride/4096) and reports it. It is the shadow march's stride-crossed rule with
the crossing located rather than approximated, and it costs extra evaluations
only when it fires.

MEASURED on the f64 twin over 200 camera rays each on near-kissing oct6, at the
shipped R/512 crossing scale:

| Depth | Resolved before → after | Inside-miss before → after | CPU cost per ray |
| ----- | ----------------------- | -------------------------- | ---------------- |
| 3     | 180 → 187               | 12 → 0                     | 1.9 → 2.0 ms     |
| 6     | 109 → 179               | 81 → 0                     | 1.3 → 2.6 ms     |

The cost rises because traces now run to completion instead of failing early.
The remaining failures are the path cap and traversal refusals. This is the
look gate's "RESOLUTION question": the inside-miss mass it traced to R/512 was
this defect, and finer resolution had been hiding it rather than curing it. The
envelope work should re-measure the speckle before reaching for a finer
crossing scale.

The real-driver interior excess the f32 argument owed is 1.03e-7 at worst (the
4D orbit), about 10× under the slack.

### The curved-glass starters and their app gate (2026-09-23)

Two starters sit in the menu's Glass group beside the Menger pair, where a
user looking for glass looks: **Glass Pearls** (`glassPearls`, 3D) and
**Glass Cross Pearls (4D)** (`glassPearls4`). Each is a sphere-inversion
block carrying the Material row's one Glass entry (the dielectric at its
resolver defaults for every generation), so the row reads "Glass" on arrival
rather than "Authored materials", plus the Menger pair's checker-floor room
and studio backdrop.

THE CHOICES ARE THE LOOK GATE'S, NOT NEW ONES. Depth 3 is the gate's
verdict (depth 1-3 read as clean glass, 4 speckles, 6-8 read as lace), and
the 3D block is Kissing Pearls' own construction at that depth, at its own
camera. The 4D block is the gate's `cross8` ball (0.42, depth 3) at its pose,
one `xw` turn of 0.3 off the kiss slice, `w0 = 0.1`, zero slab thickness;
the camera is the gate's direction pulled in to 0.7 of its distance, because
at the gate's square panel distance the object filled a small corner of a
16:9 pane. Both shipped 4D showcases are `cell600`, past the glass
admission's 30-generator cap, so neither could be the 4D starter. The studio
is not decoration: against the plain dark backdrop this glass is nearly
invisible, and the checker bent and inverted through the pearls is what
makes the curvature the subject.

THE GATE is `scripts/sphere-inversion-glass.verify.mjs`, the family gate's
sibling over the shared browser vocabulary. It reads the starters from
`presets.ts` (`loadSiPresets({ glass: true })`; the family gate now takes
only the classic showcases, so each gate's menu check compares one group).
Per starter, FROM THE MENU: compute settle on a real adapter with
`opticsBackend` "sphereInversion"; a covered, unexhausted census; every
antialias sample's transport tally complete, with the resolved share
recorded against a 90% bar; the `#v1=` block field for field; the Copy link
string reproducing the settled frame byte for byte, and the reloaded
session copying the same document; the whole-image export; a Classic
control at the same pose, which the glass frame must differ from; and, in
4D, the slab slider unavailable with its reason and a slice scrub that
keeps the backend. Then the tiled export under `?surfacemaxrays`, which must
cut finer than the whole export and match it byte for byte.

It supplies `?surfacesamples=1` by default. A glass settle at the app's
default eight antialias passes costs minutes in 3D (the routing section's
~200-400 s at 900×600), and the identity legs compare like with like at any
count; `--samples=8` reproduces the shipped settle, and the cost itself is
the envelope work's to measure.

MEASURED, RX 7900 XTX (radeonsi renderer line checked, WebGPU adapter "amd
rdna-3", software=false), quiet baseline YES, 960×540, one antialias pass,
1x export, tiled leg at `surfacemaxrays=200000` (3 bands). All legs PASS:

| Starter      | Settle | Covered | Glass hits resolved / unresolved / invalid | vs Classic | Link reload | Whole export | Tiled (3 bands) |
| ------------ | ------ | ------- | ------------------------------------------ | ---------- | ----------- | ------------ | --------------- |
| glassPearls  | 86.3 s | 62.7%   | 91070 / 4105 / 0 (95.69%)                  | 22.3%      | max diff 0  | 82.6 s       | max diff 0      |
| glassPearls4 | 14.4 s | 75.9%   | 88597 / 4870 / 0 (94.79%)                  | 12.2%      | max diff 0  | 8.1 s        | max diff 0      |

The 4D slice scrub (0.11 → −0.3) kept the backend, resolved 95.77% and
moved 15.4% of the pane; the slab slider read unavailable with its reason.
WHICH POSES THE MATERIAL SURVIVES: every rotor and slice position, by the
admission's own verdict (the field lifts the displayed point through the
live pose on every query) and now observed across a slice scrub. The one
refusal is slab thickness, which the family refuses for every session, and
the gate asserts the disclosure. The unresolved ~5% is the transport's path
cap and traversal refusals, rendered as their seeded backdrop; its cost and
speckle are the envelope work's, as is the 3D starter's settle at the
shipped eight passes. An earlier 2x run of the 3D starter took 405.9 s to
export 1920×1080 at one pass, which is why the gate's default scale is 1.
