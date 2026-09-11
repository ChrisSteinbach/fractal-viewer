/** Scene / Look authoring for the shared displayed-space lighting rig.
 * Convenience ranges expand around imported values; only an explicit edit
 * changes the document. Every range uses the panel's exact-number companion. */
import { hexToRgb, rgbToHex } from "../fractal/palette";
import {
  cloneSurfaceLighting,
  DEFAULT_SURFACE_LIGHTING,
  type SurfaceLighting,
  type SurfaceLightingMedium,
} from "../fractal/surface-lighting";
import type { Vec3 } from "../fractal/types";
import { enhanceRangeWithNumber } from "./range-number-control";
import type { AppState } from "./state";

type Phase = "input" | "commit";
type RigEdit = (rig: SurfaceLighting, value: number) => void;

const DEFAULT_MEDIUM: SurfaceLightingMedium = {
  center: [0, 0, 0],
  radius: 3,
  density: 0.1,
  tint: [0.9, 0.95, 1],
  anisotropy: 0.4,
};

const colorToHex = (rgb: Vec3): string =>
  rgbToHex(
    rgb.map((v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2)) as Vec3,
  );
const colorFromHex = (hex: string): Vec3 => {
  const rgb = hexToRgb(hex) ?? [1, 1, 1];
  return [Math.pow(rgb[0], 2.2), Math.pow(rgb[1], 2.2), Math.pow(rgb[2], 2.2)];
};

function directionAngles(normal: Vec3): [number, number] {
  const length = Math.hypot(...normal);
  return length > 1e-10
    ? [
        (180 * Math.atan2(normal[0], normal[2])) / Math.PI,
        (180 * Math.asin(Math.max(-1, Math.min(1, normal[1] / length)))) /
          Math.PI,
      ]
    : [0, -90];
}

function aimedNormal(azimuth: number, elevation: number): Vec3 {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

export class SurfaceLightingControls {
  private readonly doc: Document;
  private draft = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
  private mediumDraft = DEFAULT_MEDIUM;
  private enabled = false;
  private active = false;
  private readonly enable: HTMLInputElement;
  private readonly body: HTMLElement;
  private readonly syncers: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly note: HTMLElement,
    private readonly onEdit: (
      value: SurfaceLighting | undefined,
      phase: Phase,
    ) => void,
  ) {
    this.doc = host.ownerDocument;
    this.enable = this.checkbox(host, "surfaceRigEnabled", "Authored lights");
    this.enable.addEventListener("change", () => {
      if (!this.active) return;
      this.enabled = this.enable.checked;
      this.emit("commit");
      this.refresh();
    });
    this.body = this.doc.createElement("div");
    host.appendChild(this.body);

    const lightCountLabel = this.doc.createElement("label");
    lightCountLabel.className = "select-label";
    lightCountLabel.textContent = "Light sources";
    const lightCount = this.doc.createElement("select");
    lightCount.id = "surfaceRigLightCount";
    for (const [value, label] of [
      [0, "Ambient only"],
      [1, "Key"],
      [2, "Key and rim"],
    ] as const) {
      const option = this.doc.createElement("option");
      option.value = String(value);
      option.textContent = label;
      lightCount.appendChild(option);
    }
    lightCountLabel.appendChild(lightCount);
    this.body.appendChild(lightCountLabel);
    lightCount.addEventListener("change", () => {
      if (!this.canEdit()) return;
      const count = Number(lightCount.value);
      const defaults = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
      this.draft.lights = Array.from(
        { length: count },
        (_, i) => this.draft.lights[i] ?? defaults.lights[i],
      );
      this.emit("commit");
      this.refresh();
    });
    this.syncers.push(() => {
      lightCount.value = String(this.draft.lights.length);
      lightCount.disabled = !this.canEdit();
    });

    for (const [index, name] of ["Key", "Rim"].entries()) {
      const detail = this.detail(this.body, `${name} light`);
      detail.open = index === 0;
      const read = () =>
        this.draft.lights[index] ?? DEFAULT_SURFACE_LIGHTING.lights[index];
      this.syncers.push(() => {
        detail.classList.toggle("hidden", index >= this.draft.lights.length);
      });
      for (const [axis, label] of ["X", "Y", "Z"].entries()) {
        this.numeric(
          detail,
          `surfaceRig${name}Position${label}`,
          `${name} position ${label}`,
          [-10, 10, 0.01],
          () => read().position[axis],
          (rig, value) => {
            rig.lights[index].position[axis] = value;
          },
        );
      }
      for (const [axis, label] of ["Azimuth", "Elevation"].entries()) {
        this.numeric(
          detail,
          `surfaceRig${name}${label}`,
          `${name} aim ${label.toLowerCase()} (°)`,
          axis === 0 ? [-180, 180, 1] : [-90, 90, 1],
          // Angles are a derived editor coordinate, not authored normal
          // components. Millidegrees stay useful and legible on a phone;
          // synchronizing this view never rewrites the stored normal.
          () => Number(directionAngles(read().normal)[axis].toFixed(3)),
          (rig, value) => {
            const angles = directionAngles(rig.lights[index].normal);
            angles[axis] = value;
            rig.lights[index].normal = aimedNormal(angles[0], angles[1]);
          },
          3,
        );
      }
      this.color(
        detail,
        `surfaceRig${name}Color`,
        `${name} color`,
        () => read().color,
        (rig, value) => {
          rig.lights[index].color = value;
        },
      );
      this.numeric(
        detail,
        `surfaceRig${name}Radius`,
        `${name} disk radius`,
        [0.001, 2, 0.001],
        () => read().radius,
        (rig, value) => {
          rig.lights[index].radius = value;
        },
      );
      this.numeric(
        detail,
        `surfaceRig${name}Intensity`,
        `${name} flux`,
        [0, 200, 0.1],
        () => read().intensity,
        (rig, value) => {
          rig.lights[index].intensity = value;
        },
      );
      this.hint(
        detail,
        "Aim points out of the emitting face. A larger disk softens shadows while keeping total flux fixed. Positions and radii use scene world units.",
      );
    }

    const material = this.detail(this.body, "Ambient fill and material");
    for (const [axis, label] of ["Red", "Green", "Blue"].entries()) {
      this.numeric(
        material,
        `surfaceRigAmbient${label}`,
        `Ambient ${label.toLowerCase()}`,
        [0, 1, 0.005],
        () => this.draft.ambient[axis],
        (rig, value) => {
          rig.ambient[axis] = value;
        },
      );
    }
    this.numeric(
      material,
      "surfaceRigSpecular",
      "Classic specular",
      [0, 1, 0.01],
      () => this.draft.specular,
      (rig, value) => {
        rig.specular = value;
      },
    );
    this.numeric(
      material,
      "surfaceRigRoughness",
      "Classic roughness",
      [0.03, 1, 0.01],
      () => this.draft.roughness,
      (rig, value) => {
        rig.roughness = value;
      },
    );
    this.hint(
      material,
      "These material defaults affect Classic finishes. Authored per-transform finishes keep their own appearance.",
    );

    const medium = this.detail(this.body, "Bounded mist");
    const mediumEnable = this.checkbox(
      medium,
      "surfaceRigMediumEnabled",
      "Add mist",
    );
    const mediumBody = this.doc.createElement("div");
    medium.appendChild(mediumBody);
    mediumEnable.addEventListener("change", () => {
      if (!this.canEdit()) return;
      if (mediumEnable.checked) {
        this.draft.medium = {
          ...this.mediumDraft,
          center: [...this.mediumDraft.center],
          tint: [...this.mediumDraft.tint],
        };
      } else {
        this.mediumDraft = this.draft.medium ?? this.mediumDraft;
        delete this.draft.medium;
      }
      this.emit("commit");
      this.refresh();
    });
    this.syncers.push(() => {
      mediumEnable.checked = this.draft.medium !== undefined;
      mediumEnable.disabled = !this.canEdit();
      mediumBody.classList.toggle("hidden", this.draft.medium === undefined);
    });
    const mediumRead = () => this.draft.medium ?? DEFAULT_MEDIUM;
    for (const [axis, label] of ["X", "Y", "Z"].entries()) {
      this.numeric(
        mediumBody,
        `surfaceRigMediumCenter${label}`,
        `Mist center ${label}`,
        [-10, 10, 0.01],
        () => mediumRead().center[axis],
        (rig, value) => {
          if (rig.medium) rig.medium.center[axis] = value;
        },
      );
    }
    this.numeric(
      mediumBody,
      "surfaceRigMediumRadius",
      "Mist radius",
      [0.01, 10, 0.01],
      () => mediumRead().radius,
      (rig, value) => {
        if (rig.medium) rig.medium.radius = value;
      },
    );
    this.numeric(
      mediumBody,
      "surfaceRigMediumDensity",
      "Mist density",
      [0, 2, 0.005],
      () => mediumRead().density,
      (rig, value) => {
        if (rig.medium) rig.medium.density = value;
      },
    );
    this.color(
      mediumBody,
      "surfaceRigMediumTint",
      "Mist tint",
      () => mediumRead().tint,
      (rig, value) => {
        if (rig.medium) rig.medium.tint = value;
      },
    );
    this.numeric(
      mediumBody,
      "surfaceRigMediumAnisotropy",
      "Forward scattering",
      [-0.95, 0.95, 0.01],
      () => mediumRead().anisotropy,
      (rig, value) => {
        if (rig.medium) rig.medium.anisotropy = value;
      },
    );
    this.hint(
      mediumBody,
      "Mist fills a sphere around its center. Density 0 removes scattering and attenuation. Positive forward scattering emphasizes light arriving toward the camera.",
    );
    this.refresh();
  }

  sync(state: AppState): void {
    this.active = state.renderMode === "surface";
    this.enabled = state.surface.lighting !== undefined;
    if (state.surface.lighting) {
      this.draft = cloneSurfaceLighting(state.surface.lighting);
      this.mediumDraft = this.draft.medium ?? this.mediumDraft;
    }
    this.note.textContent = this.active
      ? "Lights and mist update live and restart Surface convergence. Motion uses reduced sampling; Renderer controls the parked-view samples."
      : "Surface lighting is retained in this render mode. Enter Surface to edit the lights and mist.";
    this.refresh();
  }

  private canEdit(): boolean {
    return this.active && this.enabled;
  }

  private refresh(): void {
    this.enable.checked = this.enabled;
    this.enable.disabled = !this.active;
    this.body.classList.toggle("hidden", !this.enabled);
    for (const sync of this.syncers) sync();
  }

  private emit(phase: Phase): void {
    this.onEdit(
      this.enabled ? cloneSurfaceLighting(this.draft) : undefined,
      phase,
    );
  }

  private detail(parent: HTMLElement, title: string): HTMLDetailsElement {
    const detail = this.doc.createElement("details");
    detail.className = "editor-group";
    const summary = this.doc.createElement("summary");
    summary.className = "editor-group-title";
    summary.textContent = title;
    detail.appendChild(summary);
    parent.appendChild(detail);
    return detail;
  }

  private hint(parent: HTMLElement, text: string): void {
    const hint = this.doc.createElement("p");
    hint.className = "flame-hint";
    hint.textContent = text;
    parent.appendChild(hint);
  }

  private checkbox(
    parent: HTMLElement,
    id: string,
    text: string,
  ): HTMLInputElement {
    const label = this.doc.createElement("label");
    label.className = "checkbox-label";
    const input = this.doc.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.setAttribute("aria-describedby", this.note.id);
    label.append(input, this.doc.createTextNode(text));
    parent.appendChild(label);
    return input;
  }

  private numeric(
    parent: HTMLElement,
    id: string,
    title: string,
    bounds: [number, number, number],
    read: () => number,
    edit: RigEdit,
    precision = 12,
  ): void {
    const row = this.doc.createElement("div");
    row.className = "select-label";
    const label = this.doc.createElement("label");
    label.htmlFor = id;
    label.textContent = title;
    const range = this.doc.createElement("input");
    range.type = "range";
    range.id = id;
    range.min = String(Math.min(bounds[0], read()));
    range.max = String(Math.max(bounds[1], read()));
    range.step = String(bounds[2]);
    range.value = String(read());
    range.setAttribute("aria-describedby", this.note.id);
    row.append(label, range);
    parent.appendChild(row);
    const update = (value: number, phase: Phase): void => {
      if (!this.canEdit()) return;
      edit(this.draft, value);
      this.emit(phase);
    };
    const numeric = enhanceRangeWithNumber(range, {
      min: Number(range.min),
      max: Number(range.max),
      step: bounds[2],
      precision,
      ariaLabel: `${title} exact value`,
      formatValue: String,
      onInput: (value) => {
        update(value, "input");
      },
      onCommit: (value) => {
        update(value, "commit");
      },
    });
    range.addEventListener("change", () => {
      update(Number(range.value), "commit");
    });
    this.syncers.push(() => {
      const value = read();
      numeric.setBounds({
        min: Math.min(bounds[0], value),
        max: Math.max(bounds[1], value),
        step: bounds[2],
      });
      numeric.setValue(value);
      numeric.setDisabled(!this.canEdit());
      // Keep direct authored values exact. Longer imported/typed values
      // receive a full-width field instead of scrolling inside an 88px slot.
      const decimals = (String(value).split(".")[1] ?? "").length;
      const widest = [
        String(value),
        Math.min(bounds[0], value).toFixed(decimals),
        Math.max(bounds[1], value).toFixed(decimals),
      ];
      numeric.pair.classList.toggle(
        "surface-lighting-number-wide",
        widest.some((text) => text.length > 8),
      );
    });
  }

  private color(
    parent: HTMLElement,
    id: string,
    title: string,
    read: () => Vec3,
    edit: (rig: SurfaceLighting, value: Vec3) => void,
  ): void {
    const label = this.doc.createElement("label");
    label.className = "select-label";
    label.textContent = title;
    const color = this.doc.createElement("input");
    color.type = "color";
    color.id = id;
    color.setAttribute("aria-label", title);
    color.setAttribute("aria-describedby", this.note.id);
    label.appendChild(color);
    parent.appendChild(label);
    for (const event of ["input", "change"] as const) {
      color.addEventListener(event, () => {
        if (!this.canEdit()) return;
        edit(this.draft, colorFromHex(color.value));
        this.emit(event === "input" ? "input" : "commit");
      });
    }
    this.syncers.push(() => {
      color.value = colorToHex(read());
      color.disabled = !this.canEdit();
    });
  }
}
