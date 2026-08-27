# Panel information architecture

This is the accepted placement contract for the control panel. It describes
the target architecture; `docs/controls.md` remains the user-facing account of
the controls that are currently shipped. A control must be classified here
before its DOM location or mode gate is chosen.

## Four control families

| Family            | The question it answers                                                 | Typical controls                                                                                                      |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Scene / Look**  | What is the authored object, composition or appearance?                 | Transforms, Xaos, Hybrid schedule, Symmetry, Balloon, backdrop, fog, per-transform Finish and Pattern                 |
| **Renderer**      | How does the selected renderer produce this view of the scene?          | Points sampling, Flame tone/density/blur, Solid density/material/lighting/quality, Surface lighting/traps/sampling    |
| **View / Device** | How is this user inspecting the scene, and what can this device afford? | Camera and 3D/4D framing, W slice, orbit/tumble and motion, adaptive-resolution and other browser/session preferences |
| **Workflow**      | How does work enter, leave, get stored or get sequenced?                | Presets and composition entry points, Collection, Timeline, Capture and Share                                         |

The conceptual question chooses the family. Persistence does not. A persisted
Surface-only floor is still a Renderer control; a session-only capture size is
still Workflow; a look control does not become Renderer merely because only
one renderer consumes it today. Likewise, the command that starts composition
may be Workflow while the structure it creates is edited under Scene / Look:
**Add system as isolated block** is an entry point, but the resulting Xaos
matrix is part of the scene.

Scene / Look remains reachable while any renderer is being inspected. That
does not claim that every renderer consumes every row. Applicability and edit
timing are separate properties, recorded below, and determine whether a row is
enabled and what it tells the user.

## The four-property record

Every new control or inseparable control group records these four properties
next to its implementation. None may be inferred from another:

1. **Conceptual home** — exactly one of the four families above.
2. **Consumers** — the exact renderer modes, dimensions and session kinds that
   read it. State Points/Flame/Solid/Surface, flat/non-flat, and (where
   relevant) Surface IFS/escape/bulb independently. “Shared” is not a consumer
   specification.
3. **Lifetime** — document, session or browser. Document state rides share
   links and scene files; session state lasts for the current app session but
   is not shared; browser state survives locally across sessions and is not
   part of the scene document.
4. **Edit behavior** — **live**, **restart**, **next entry**, or **refused**.
   Record the behavior per consumer when it differs. Live applies to the
   active view; restart rebuilds or re-accumulates the active renderer; next
   entry safely authors the value but cannot change the current renderer;
   refused means the edit is unavailable and must include the reason.

The record belongs in the control-spec or owning component comment and should
link back to this page. If a control has several consumers with different edit
costs, list them; do not reduce them to the most convenient common label.

### Visible lifetime vocabulary

Authored Scene / Look and Renderer values are the panel's default: they belong
to the scene document and travel through links and scene files. Mark the
exceptions visibly at the control instead of moving them into a catch-all
Preferences section:

- **Saved view** is optional framing attached when the current document is
  captured: the 3D camera pose, or the 4D rotor and slice pose. It travels with
  Copy Link, scene files, Collection entries and Timeline keyframes, but it is
  not authored scene content. The live camera/FourDView object remains outside
  AppState, and undo keeps replacement framing out of band rather than in its
  document-deduplication bytes.
- **This session** resets with the current app session and is never carried to
  another viewer by a saved/shared scene.
- **This browser** is a local viewer preference that survives future sessions
  in this browser profile but never rides in the scene document.

Use those exact three labels. Placement and edit cost remain independent of
the label: for example, session-only Capture size stays under Workflow, and a
browser-owned motion switch still acts live.

## Placement procedure

For a new control, first name the user intent without reference to its current
DOM container. Assign its conceptual family, then enumerate its consumers,
lifetime and edit behavior. Place it in the section for the conceptual family
and use the consumer record to derive row applicability. Finally, put it in the
stable order below and add the timing disclosure required by its behavior.

This procedure deliberately prevents taste-based moves such as “it persists,
so put it with scene controls” or “only Surface reads it, so it must be under
Surface.” The first statement confuses lifetime with home; the second confuses
consumers with home.

## Accordion, applicability and disclosure

- Retain native top-level `<details name="panel-section">` sections. They are
  exclusive-open because mobile height is a hard constraint. This constrains
  open state, not conceptual placement: never use it to justify mixing
  families. A nested disclosure must not join an ancestor's group; omit its
  `name` when it is independent, or use a different name when sibling nested
  disclosures form their own exclusive group.
- A section owns whether it is applicable. Wrapper strips may provide layout,
  but must not mode-gate a section or become the only source of its visibility.
- When a renderer changes, keep an open shared section open if it still
  applies. Remember contextual Renderer sections independently; do not close a
  shared Scene / Look, View / Device or Workflow section merely because the
  renderer changed.
- Hide a dependent detail row when its parent is off and the detail has no
  independent authoring meaning. For example, Balloon size and tint detail may
  disappear while Balloon is off. A deliberately pre-authorable value is an
  explicit exception: Balloon palette can remain editable while off because
  preparing that look is useful and specified behavior.
- Keep a dormant authored capability visible but disabled when the document
  retains it and the current renderer, dimension or session kind cannot use
  it. Put a concise reason next to the control and associate it in the DOM
  (for example with `aria-describedby`); a hover-only tooltip is insufficient
  for touch and keyboard users. The reason should name the condition and, when
  possible, the action that makes the control available.
- Put document-level status in an always-applicable status area or beside the
  shared section that owns the affected concept. It must not exist only inside
  a Points/Flame/Solid/Surface wrapper: switching renderers must not hide a
  warning about the document itself.
- Every visible editable control discloses its timing. Live controls need no
  repeated warning when the response is immediate and obvious. Restart
  controls warn before discarding accumulated work; next-entry controls say
  which renderer must be re-entered; refused controls remain disabled with the
  adjacent reason. Never silently queue an edit whose result appears later.

Hiding and disabling therefore mean different things. Hidden detail has no
meaning in the parent's current state. Disabled authored state still has
meaning, but the current consumer cannot apply or safely accept it.

Renderer, dimension and active Surface-session applicability is matched by the
pure registry in `src/app/panel-applicability.ts`. Its clauses are alternatives
(OR); fields within a clause must all match (AND); omitted axes mean any value,
while an explicit `null` Surface kind means pre-routing rather than a wildcard.
The registry supplies only that three-axis answer. Feature owners still combine
it with document and runtime predicates such as emitter weight, trap presence
and conformal-fold restrictions, leaving one final owner for each row's hidden
or disabled state.

## Stable order

Keep active editing ahead of output and library operations. At the top level,
the stable family order is:

1. Scene / Look.
2. The contextual Renderer inspector for the selected render mode.
3. View / Device.
4. Workflow.

Within Workflow, creation and composition entry points such as Systems come
before Collection and Timeline, which come before Capture and Share. The mode
selector and global/document status sit above the accordion rather than
pretending to be a fifth family. A section may be absent when it has no rows at
all, but switching modes must not reorder the families that remain.

Sharing a source vocabulary does not make three system gestures one mode.
**Replace with preset** discards A and applies immediately; **Add isolated
block** preserves A, has a balance option and an explicit confirmation; Hybrid
**System B** edits a persistent affine-only snapshot and applies on selection.
Name those verbs and source lifetimes explicitly. Put replacement and block
construction under Workflow → Systems, while the resulting Xaos graph and
Hybrid schedule state remain Scene / Look editors.

## Placement examples

| Control or group                                 | Home                           | Consumers                                                                                                                                                                                  | Lifetime                                                                                                                       | Edit behavior and placement consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background**                                   | Scene / Look                   | All four renderers; flat and non-flat                                                                                                                                                      | Document                                                                                                                       | Live. One shared Look section, not a copy under each renderer. Background-specific detail hides when another source makes it meaningless.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Flat / non-flat Scene color and Depth**        | Scene / Look                   | Flat and non-flat Points; Scene color also feeds applicable Flame/Solid paths, while Surface has its own sources                                                                           | Document                                                                                                                       | Keep active non-flat Color/Depth enabled and stored flat selectors visible-disabled with adjacent reasons. The shared section is named **Scene color** so the pair with Surface's contextual **Surface color** reads as families rather than duplicates; Surface Height/Radius keeps the shared ramp and Contrast live. Aerial colored haze and EDL conflict with additive/single-depth assumptions; Glow/DOF and missing color modes remain disclosed unfinished lifts. Surface Height/Radius keeps Contrast live.                                                                                                                                                          |
| **Fog and fog tint**                             | Scene / Look                   | Fog-bearing flat Points styles, Solid and every Surface tracer; Fog density also reaches the Points Balloon horizon, but Tint does not; neither reaches Flame or the non-flat Points cloud | Document                                                                                                                       | Live for consumers. Keep both authored controls visible but disabled beside an accessible reason in a non-consuming context. When Balloon is the only Points consumer, keep Fog enabled, disable Tint, and disclose that partial scope. Non-flat Points use their separate brightness-only Depth fade; this contract does not add a 4D fog shader.                                                                                                                                                                                                                                                                                                                           |
| **Balloon**                                      | Scene / Look                   | Points, Flame, Solid and Surface IFS paths, in both dimensions; refused for Surface escape/bulb paths                                                                                      | Document                                                                                                                       | Points/Solid changes are live; Flame changes that bake deposits restart accumulation; the Surface on/off variant re-enters while radius/tint are live. One shared section expresses those per-consumer costs. Unsupported Surface kinds disable it with the analyzer reason. Dependent size/tint rows hide while off; the explicitly pre-authorable palette may remain enabled.                                                                                                                                                                                                                                                                                              |
| **Transforms**                                   | Scene / Look                   | Geometry reaches every renderer; Index reaches matching color sources; Speed reaches structural-palette Flame/Solid; Finish/Pattern reach applicable Surface slots                         | Document                                                                                                                       | Keep one editor reachable across renderers. Points geometry follows Auto-update and matching Index recolors live. Flat Balloon-off Flame/Solid geometry and consumed color restart once after settlement; 4D/Balloon geometry is next-entry. Surface geometry and consumed color/material re-enter once while preserving the inspection camera; refusal disables inapplicable material rows with the analyzer reason.                                                                                                                                                                                                                                                        |
| **Shape catalog roles**                          | Scene / Look / Renderer        | Emitter shapes reach every renderer through a selected transform; trap shapes reach applicable forward-orbit Surface sessions                                                              | Document                                                                                                                       | One bundled catalog may have role-specific doors. Keep Emitter shape in shared Transforms because it authors scene geometry; keep Trap shape in the contextual Surface inspector because it configures that renderer's orbit trap. Use reciprocal hints and the same catalog labels rather than merging unlike roles.                                                                                                                                                                                                                                                                                                                                                        |
| **Symmetry · 4D route**                          | Scene / Look                   | Every renderer; an order above 1 plus a W plane or nonzero Twist makes the document non-flat                                                                                               | Document                                                                                                                       | Keep the guided 4D entry in shared Symmetry because it authors the current scene without an arbitrary toggle or replacement. Points follows Auto-update; same-dimension Flame/Solid edits restart; a dimension crossing is next-entry; Surface eligibility updates immediately. Keep contextual tumble/slice under View.                                                                                                                                                                                                                                                                                                                                                     |
| **Surface Floor**                                | Renderer                       | Surface only, in supported 3D and 4D session kinds                                                                                                                                         | Document                                                                                                                       | Re-enter Surface because it changes the shader/kernel variant. Persistence does not move it to Scene / Look; place it in the contextual Surface inspector and disclose the re-entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Renderer quality**                             | Renderer                       | One contextual group for Points, Flame, Solid or Surface, selected by the active renderer                                                                                                  | Document render settings, except Surface Quick previews (**This browser**)                                                     | Keep one stable **Quality** section and swap only its four contextual groups. Points exposes count/regeneration; Flame exposes iterations/supersample; Solid exposes iterations/resolution; Surface exposes Quick previews/antialiasing. Count budgets use 1-2-5 detents while preserving an exact non-detent saved value until the thumb moves. Surface antialiasing restarts refinement; its diagnostic query override must resolve identically for WebGPU and WebGL.                                                                                                                                                                                                      |
| **Performance**                                  | View / Device                  | Morph Detail in every renderer; Adaptive resolution in Points and Solid only                                                                                                               | This session                                                                                                                   | Keep one stable **Performance** section. Adaptive resolution is hidden where the governor has no consumer rather than copied or left unreachable; Morph Detail remains available because it controls the next system morph regardless of the current renderer.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Automatic motion / orbit or tumble / W slice** | View / Device                  | Flat camera orbit or non-flat rotor tumble; Saved-view framing follows the active dimension                                                                                                | This browser for the one auto-motion choice; This session for each contextual speed; Saved view for camera/rotor/slice framing | Keep one stable View section and one Automatic motion checkbox. Show Orbit speed or Tumble speed contextually without creating another preference. 4D tumble replaces automatic camera orbit because it exposes the hidden axis; manual camera orbit remains available. With no explicit choice, reduced motion supplies the paused default. Flat Solid keeps the turntable live. Non-flat Flame/Solid keep manual rotor/slice controls visible, park automatic tumble, and restart active accumulation once on release or after 150 ms of wheel/keyboard quiet. Surface keeps manual view controls live per frame while visibly parking continuous motion so it can settle. |
| **Capture size**                                 | Workflow                       | Capture paths for all renderers; Flame also uses it for the active accumulation dimensions                                                                                                 | This session                                                                                                                   | Applies on the next capture in Points/Solid/Surface; changing it during Flame restarts accumulation. Place beside Capture and disclose the Flame restart. Its session lifetime does not make it a View / Device control.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Systems construction / Xaos editing**          | Workflow entry / Scene editing | Preset replacement and isolated-block construction enter the document; every renderer consumes the resulting system/Xaos support as implemented                                            | Loaded/copied result is document state                                                                                         | Put replace/add actions under Systems. Once created, put the Xaos matrix and composition state in Scene / Look, available across renderer inspection. Preserve apply-on-select for replacement, configured confirmation for block Add, and immediate persistent editing for Hybrid System B.                                                                                                                                                                                                                                                                                                                                                                                 |

When an example's implementation changes, update its consumer or behavior
cell; do not move it unless its user-facing concept changes. That stability is
the purpose of the architecture.
