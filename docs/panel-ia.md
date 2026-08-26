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

Within Workflow, creation and composition entry points such as Presets come
before Collection and Timeline, which come before Capture and Share. The mode
selector and global/document status sit above the accordion rather than
pretending to be a fifth family. A section may be absent when it has no rows at
all, but switching modes must not reorder the families that remain.

## Placement examples

| Control or group               | Home                           | Consumers                                                                                                  | Lifetime                        | Edit behavior and placement consequence                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background**                 | Scene / Look                   | All four renderers; flat and non-flat                                                                      | Document                        | Live. One shared Look section, not a copy under each renderer. Background-specific detail hides when another source makes it meaningless.                                                                                                                                                                                                                                       |
| **Fog and fog tint**           | Scene / Look                   | Fog-bearing Points styles, Solid and Surface; not Flame (nor a projected Points path that has no fog term) | Document                        | Live for consumers. Keep the authored row visible but disabled in a non-consuming context, with a reason such as “This renderer has no depth-fog pass.”                                                                                                                                                                                                                         |
| **Balloon**                    | Scene / Look                   | Points, Flame, Solid and Surface IFS paths, in both dimensions; refused for Surface escape/bulb paths      | Document                        | Points/Solid changes are live; Flame changes that bake deposits restart accumulation; the Surface on/off variant re-enters while radius/tint are live. One shared section expresses those per-consumer costs. Unsupported Surface kinds disable it with the analyzer reason. Dependent size/tint rows hide while off; the explicitly pre-authorable palette may remain enabled. |
| **Surface Floor**              | Renderer                       | Surface only, in supported 3D and 4D session kinds                                                         | Document                        | Re-enter Surface because it changes the shader/kernel variant. Persistence does not move it to Scene / Look; place it in the contextual Surface inspector and disclose the re-entry.                                                                                                                                                                                            |
| **Flame quality**              | Renderer                       | Flame only                                                                                                 | Document render settings        | Restart or re-accumulate where the chosen parameter changes fixed buffers; otherwise live tone mapping. Keep it in the contextual Flame inspector and state the cost at the affected row.                                                                                                                                                                                       |
| **Auto-tumble / W slice**      | View / Device                  | Non-flat scene view in any renderer that exposes the 4D camera                                             | Session                         | Live. Place in View / Device. Dimension-specific rows may replace their 3D counterparts because they are view mechanisms, not dormant authored scene capabilities. If reduced motion refuses automatic movement, keep the switch disabled with the reason.                                                                                                                      |
| **Capture size**               | Workflow                       | Capture paths for all renderers; Flame also uses it for the active accumulation dimensions                 | Session/device preference       | Applies on the next capture in Points/Solid/Surface; changing it during Flame restarts accumulation. Place beside Capture and disclose the Flame restart. Its session lifetime does not make it a View / Device control.                                                                                                                                                        |
| **Preset load / Xaos editing** | Workflow entry / Scene editing | Preset load enters the document; every renderer consumes the resulting system/Xaos support as implemented  | Loaded result is document state | Put the load/add action with Workflow entry points. Once created, put the Xaos matrix and composition state in Scene / Look, available across renderer inspection.                                                                                                                                                                                                              |

When an example's implementation changes, update its consumer or behavior
cell; do not move it unless its user-facing concept changes. That stability is
the purpose of the architecture.
