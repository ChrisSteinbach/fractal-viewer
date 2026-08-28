# Surface background layer: exact boundary and re-shading decision

The Surface tracers keep their legacy RGBA8 color and one RGBA8 sidecar:

```text
R = fractional surface coverage
G = fog amount
B = beta, the surviving direct-background weight
A = signed camera-space circle of confusion (focus = 128)
```

Presentation applies a background-only edit as

```text
changed = legacy + beta * (liveBackground - traceBackground)
```

and takes a literal RGB copy path when the two background specifications are
semantically equal. That copy path is the byte-identity contract: an unchanged
background never passes through a decode/re-encode, and presented alpha is
always 255. The sidecar remains the shipped architecture; this record defines
where its algebra is exact, where byte storage or shading makes it approximate,
and why exact retained re-shading is not adopted.

The alpha lane is also the optional Surface depth-of-field record. Covered hits
and analytic floor intersections store

```text
coc = clamp((cameraDepth - focusDepth) / enclosingBallRadius, -1, 1)
byte = 128 + 127 * coc
```

where `focusDepth` is the camera-forward projection of the active Surface
enclosing-ball centre. Uncovered, exhausted, and not-yet-traced pixels use the
far sentinel 255. The RGB contract and the trace-color terminal-status alpha
are unchanged. Metadata is written whether the saved checkbox is on or off, so
toggling the treatment or editing only the live background re-runs the bounded
presentation pass, never the distance estimator.

## Algebraic and byte-level boundaries

Before storage quantization, `beta` exactly describes the direct backdrop
contribution from a miss, the ground plane's fractional fade, and fog:

```text
beta = 1 - coverage + coverage * fog * (1 - fogTintStrength)
```

It does not describe every place the backdrop enters Surface shading:

- Environment light samples the two stops along the shading normal and
  normalizes the result by its maximum channel. This dependency is active in
  ordinary documents because `DEFAULT_SURFACE_ENV_LIGHT` is `0.35`.
- A reflective finish samples the stops along the reflected direction, decodes
  them with gamma 2.2, adds the reflected sun or floor, and includes that result
  inside the final gamma encode.
- A transmissive finish mixes the gamma-encoded surface toward the pixel's
  backdrop before fog. For a covered hit, the omitted direct-background term is
  `(1 - fog) * transmit * (1 - fresnel)`. Classic finishes have `reflect = 0`
  and `transmit = 0`, but authored finishes and shipped presets need not.

Consequently the sidecar is an exact replacement for the direct affine term of
one sample, not an exact re-evaluation of environment lighting or a non-classic
finish. It intentionally leaves those terms baked into legacy RGB.

That first claim is algebraic, not fresh-trace byte identity. Legacy RGB and
`beta` are quantized independently to RGBA8 before presentation applies its
delta. For example, a miss traced against `0.1` stores byte 26; changing the
background to `0.2` produces byte 52 through the delta compositor, while a
fresh trace quantizes `0.2` directly to byte 51. Only the semantically equal
background path promises literal byte identity. A focused unit test pins this
one-byte changed-background boundary.

## Supersampling is nonlinear

Both Surface engines quantize every sample to RGBA8, decode those bytes to
linear light, average, and gamma-encode the mean. If `C_i` is a sample's legacy
gamma-encoded color, `beta_i` its direct-background coefficient, and `dB` the
background delta, exact per-sample recomposition would be:

```text
encode(mean(decode(C_i + beta_i * dB)))
```

The retained frame instead has only the folded color and the arithmetic mean of
the sidecar RGB bytes, so presentation computes:

```text
encode(mean(decode(C_i))) + mean(beta_i) * dB
```

Those expressions are not equal in general: gamma decode is nonlinear and
`C_i` and `beta_i` vary together at sub-pixel edges, through fog, and across
fractional ground coverage. A group of identical miss samples has no additional
mean-beta error, but its changed-background byte can still encounter the
single-sample rounding boundary above. The focused unit test in
`surface-background-layer.test.ts` pins the nonlinear boundary against the
actual compositor.

Sidecar alpha is deliberately not averaged. Both engines retain the minimum
encoded CoC among covered sub-pixel samples, which is the frontmost camera
depth under the monotone encoding; an all-uncovered pixel remains 255. Averaging
signed CoC would let near and far samples cancel to a false focal edge and
produce a halo.

## Depth-of-field presentation

`BLIT_FRAGMENT` is the one postprocess for WebGL trace targets and uploaded
WebGPU frames. The disabled branch remains the legacy one-sample compositor.
When enabled, it performs one fixed nine-sample gather with a maximum radius of
1.2% of the smaller source dimension. Each candidate first applies its own
beta/background delta at its sampled UV, decodes the resulting color to linear
light, then a source-disc reach test and a depth gate reject far color behind
covered near geometry. Focal covered pixels take an exact crisp shortcut. This keeps work and blur radius bounded and makes
radial/image background edits participate in the same filter without a
retrace.

The effect is enabled only when blitting to the canvas. Preview-to-settle seeds
and supersample intermediates retain raw color and sidecar data, so the blur is
never baked or applied twice. Presented alpha remains forced to 255; the
tracer's status channels stay private.

## Exact retained alternatives

Two architectures were assessed.

### Compact terminal replay

Retain each sample's terminal hit distance/status, reconstruct its ray, and run
the existing shade half again under the live background. A packed float with
negative status sentinels can be 4 bytes per sample. WebGPU already separates
march and shade; WebGL would need its monolithic tracer split and an exact
hit-distance output. The retained frame would also need an immutable snapshot
of inverse projection/camera, every sample's jitter, lighting/fog/ground
uniforms, material tables, and the color LUT.

This is the smallest exact state, but it is not a cheap presentation. Replaying
shade repeats hit attribution, normals, shadows, and ambient occlusion. The
existing compute measurements put hit shading at 79.4-92.1% of two settles.
Those figures are evidence of render-scale cost, not a replay timing: a replay
could consolidate free pixels and avoid some dispatch overhead. It would still
repeat the expensive DE-backed hit shading rather than behave like a lightweight
presentation pass.

### Background-response G-buffer

Retain sufficient background-independent state to evaluate environment tint,
reflection, transmission, fog, and coverage in a fullscreen pass without
running the DE probes again. A practical exact record uses three four-lane
float32 attachments per sample: post-pattern base plus shadow, normal plus AO,
and hit distance/fog/coverage/material-or-terminal metadata.

That is 48 bytes per sample. On WebGL, legacy RGBA8 plus three integer
float-bit attachments would consume all four draw buffers WebGL2 guarantees;
mixed-integer MRT completeness and Three.js integration would need their own
real-driver proof. RGBA16F or normalized packing is smaller but no longer
exact. With eight retained samples, each background edit would read roughly
743 MiB of response data at the reference live raster before writing the
presented image, which is not a lightweight color-picker or crossfade path.

Both alternatives also change progressive presentation. The current settle
starts from a linearly upscaled preview, but interpolating hit distances,
normals, or material/terminal tags cannot produce a valid retained record.
Exact replay would need separate native-resolution sources plus a completion
mask, or seed unresolved pixels as uncovered background until native samples
land.

## Memory price

The reference pane is `1920 x 1057` = 2,029,440 rays. A 4x export is
`7680 x 4228` = 32,471,040 rays, exactly 16 times as many. Figures below are
derived resident storage and use MiB; the current compute export is tiled, so
its actual peak stays below the untiled stress figure.

| Storage                                        |   1920x1057 |       untiled 4x export |
| ---------------------------------------------- | ----------: | ----------------------: |
| Current color plus sidecar, 8 B/ray            |   15.48 MiB |              247.73 MiB |
| Current WebGPU frame buffers, 44 B/ray         |   85.16 MiB | 1,362.54 MiB (1.429 GB) |
| Current two float32 sample sums, 24 B/ray      |   46.45 MiB |              743.20 MiB |
| Eight packed 4-byte terminal records, 32 B/ray |  +61.93 MiB |             +990.94 MiB |
| Eight 12-float response records, 384 B/ray     | +743.20 MiB |          +11,891.30 MiB |

An export freezes its background and depth-of-field choice when capture starts.
For tiled WebGPU capture, each completed band consumes beta on the host and
temporarily carries its CoC byte in the assembled color alpha. Capture packing
reserves 255 for uncovered pixels and caps covered far geometry at 254, keeping
the coverage distinction needed by the depth gate. The full image therefore
needs only the existing RGBA output allocation, not another full-size RGBA
sidecar, and one final gather crosses band boundaries without seams. The canvas
blit discards that transport alpha after filtering.

## Image-backed backgrounds

The generated Flame backdrop extends the same final compositor; it does not add
an image sampler or bind-group entry to either expensive Surface tracer. An
image frame traces against one flat analytic reference (the image's mean color)
and retains the ordinary beta sidecar. Presentation then applies the same delta
equation per pixel, sampling the live image at the full-image coordinate:

```text
changed = legacy + beta * (liveImage(uv) - traceMean)
```

Automatic 3D orbit and 4D tumble refresh that image through a bounded pump,
not from every animation frame. It snapshots only while the existing
debounce/worker pipeline is idle, waits for the one-million-sample render to
settle, then observes a short cooldown before taking the latest pose. That
preserves latest-wins authored edits and the morph/capture holds while avoiding
the failure mode where continuous requests keep resetting the trailing-edge
debounce and no image ever finishes.

The image uses top-origin ImageData bytes. The host sampler converts Surface's
bottom-origin `v`, clamps to the edge, and bilinearly filters like the WebGL
texture. A compute export passes each band's `bgOffset`/`bgExtent`, so one image
continues across all bands instead of repeating inside each band. The export
freezes one immutable image revision before its first asynchronous trace; the
WebGL capture similarly binds a short-lived texture from the frozen bytes if a
new worker result repaints the live CanvasTexture during the drain.

Image equality is content-identity equality: width, height, revision, and the
exact immutable RGBA object must match. That preserves the literal copy path
for a frame presented against the same image while making every new generated
revision take the delta path. The existing approximation boundary remains: the
sidecar replaces direct background/fog contribution but does not re-evaluate
environment, reflection, or transmission lighting. Solid is the exception to
the compositor architecture because it shades straight to the canvas; its miss
branch samples the shared backdrop texture directly. Points and the full Flame
renderer already consume that same CanvasTexture.

## Verdict

Exact retained background re-shading is not adopted under the current
cross-backend architecture. The shipped beta compositor remains unchanged: it
gives immediate no-retrace edits, preserves unchanged-background bytes, keeps
capture bands coherent, and forces opaque presentation, while environment
lighting, reflective/transmissive finishes, and changed-background supersample
folds retain the documented approximation.

Revisit only with an explicit new render boundary and capability/memory policy:
either accept shade replay as a substantial render job, or require a richer
G-buffer on a narrower class of devices. A larger sidecar alone cannot make the
nonlinear terms exact.
