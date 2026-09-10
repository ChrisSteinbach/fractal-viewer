// @vitest-environment jsdom
import { SurfaceLightingControls } from "./surface-lighting-controls";
import { fromSnapshot } from "./persist";
import { initialState, setSurfaceLighting } from "./state";
import { createSurfaceLightingStarter } from "./surface-lighting-starters";

afterEach(async () => {
  document.body.replaceChildren();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

function mount() {
  const host = document.createElement("div");
  const note = document.createElement("p");
  note.id = "surfaceAuthoredLightingNote";
  document.body.append(note, host);
  const onEdit = vi.fn();
  const controls = new SurfaceLightingControls(host, note, onEdit);
  const state = fromSnapshot(
    createSurfaceLightingStarter("cathedral"),
    initialState(false),
  );
  state.renderMode = "surface";
  controls.sync(state);
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  return { controls, state, host, note, onEdit, input };
}

describe("Surface lighting authoring controls", () => {
  it("pairs every numeric slider and disables the complete dormant editor", () => {
    const { controls, state, host, note } = mount();
    const ranges = host.querySelectorAll<HTMLInputElement>(
      'input[type="range"]',
    );
    expect(ranges.length).toBeGreaterThan(15);
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(
      ranges.length,
    );
    for (const range of ranges) {
      const number = document.getElementById(
        `${range.id}Number`,
      ) as HTMLInputElement;
      expect(number.disabled).toBe(range.disabled);
      expect(number.getAttribute("aria-label")).toContain("exact value");
      expect(number.getAttribute("aria-describedby")).toContain(note.id);
    }
    controls.sync({ ...state, renderMode: "points" });
    expect(note.textContent).toContain("Enter Surface");
    for (const control of host.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input, select")) {
      expect(control.disabled).toBe(true);
    }
    controls.sync(state);
    // Nothing about the rig is sampled down during motion any more: the
    // medium's 8-vs-32 cells were the whole of that claim.
    expect(note.textContent).toContain("restart Surface convergence");
    expect(note.textContent).not.toContain("reduced sampling");
  });

  it("commits exact numeric values in fresh rigs without mutating the source", () => {
    const { state, onEdit, input } = mount();
    const before = structuredClone(state.surface.lighting);
    const numeric = input("surfaceRigKeyIntensityNumber");
    numeric.value = "12.345678901";
    numeric.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lights: expect.arrayContaining([
          expect.objectContaining({ intensity: 12.345678901 }),
        ]),
      }),
      "commit",
    );
    expect(state.surface.lighting).toEqual(before);
    const first = onEdit.mock.calls[0][0];
    const live = input("surfaceRigKeyIntensity");
    live.value = "15";
    live.dispatchEvent(new Event("input", { bubbles: true }));
    expect(first.lights[0].intensity).toBe(12.345678901);
  });

  it("refuses invalid typed values without sending a document edit", () => {
    const { onEdit, input } = mount();
    const numeric = input("surfaceRigRoughnessNumber");
    numeric.value = "-1";
    numeric.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(numeric.getAttribute("aria-invalid")).toBe("true");
    numeric.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(Number(numeric.value)).toBe(0.52);
  });

  it("reflects imported values and non-unit normals without rewriting them", () => {
    const { controls, state, onEdit, input } = mount();
    state.surface.lighting!.lights[0].position[0] = 42.123456789;
    state.surface.lighting!.lights[0].normal = [0, 3, 0];
    state.surface.lighting!.lights[0].color = [5, 0.2, 0.1];
    controls.sync(state);
    expect(onEdit).not.toHaveBeenCalled();
    expect(Number(input("surfaceRigKeyPositionXNumber").value)).toBe(
      42.123456789,
    );
    expect(Number(input("surfaceRigKeyElevationNumber").value)).toBe(90);
    input("surfaceRigRoughness").value = "0.5";
    input("surfaceRigRoughness").dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    expect(onEdit.mock.lastCall![0].lights[0].normal).toEqual([0, 3, 0]);
    expect(onEdit.mock.lastCall![0].lights[0].color).toEqual([5, 0.2, 0.1]);
  });

  it("authors an emitting-face direction and linear RGB color", () => {
    const { onEdit, input } = mount();
    input("surfaceRigKeyAzimuth").value = "90";
    input("surfaceRigKeyAzimuth").dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    const normal = onEdit.mock.lastCall![0].lights[0].normal as number[];
    expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    expect(normal[0]).toBeGreaterThan(0.9);
    expect(normal[2]).toBeCloseTo(0, 12);
    input("surfaceRigKeyColor").value = "#804020";
    input("surfaceRigKeyColor").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(onEdit.mock.lastCall![0].lights[0].color[0]).toBeCloseTo(
      (128 / 255) ** 2.2,
      12,
    );
  });

  it("shows millidegree aim values without changing the authored normal", () => {
    const { state, controls, onEdit, input } = mount();
    const normal = [...state.surface.lighting!.lights[0].normal];
    expect(input("surfaceRigKeyAzimuthNumber").value).toBe("2.617");
    expect(input("surfaceRigKeyElevationNumber").value).toBe("-9.718");
    controls.sync(state);
    expect(state.surface.lighting!.lights[0].normal).toEqual(normal);
    expect(onEdit).not.toHaveBeenCalled();
    input("surfaceRigKeyAzimuthNumber").value = "3.1234";
    input("surfaceRigKeyAzimuthNumber").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(
      input("surfaceRigKeyAzimuthNumber").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("removes the optional rig when the master control is switched off", () => {
    const { controls, state, onEdit, input, host } = mount();
    input("surfaceRigEnabled").checked = false;
    input("surfaceRigEnabled").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(onEdit).toHaveBeenLastCalledWith(undefined, "commit");
    controls.sync(setSurfaceLighting(state, undefined));
    expect(input("surfaceRigEnabled").checked).toBe(false);
    expect(
      host.querySelector('input[type="range"]')?.closest(".hidden"),
    ).not.toBeNull();
  });

  it("does not emit edits from dormant controls", () => {
    const { controls, state, onEdit, input } = mount();
    controls.sync({ ...state, renderMode: "flame" });
    input("surfaceRigKeyIntensity").value = "50";
    input("surfaceRigKeyIntensity").dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(state.surface.lighting!.lights[0].intensity).toBe(7);
  });
});
