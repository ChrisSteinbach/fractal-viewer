/**
 * Keeps Chrome's native color-picker popup inside the window.
 *
 * Chrome hangs the popup from the bottom-left corner of the
 * `<input type="color">`, and on Linux it was seen not to pull it back on
 * screen, so a swatch near the panel's right edge opened a mostly invisible
 * picker. The popup cannot be positioned, only its anchor can: when it would
 * not fit, an invisible stand-in input placed far enough inside the window
 * opens it and relays what is picked to the real swatch.
 */

/** The popup's footprint in CSS px, rounded up from Chrome on Linux. */
export const PICKER_WIDTH = 240;
export const PICKER_HEIGHT = 260;

export function installColorPickerAnchor(doc: Document): void {
  let standIn: HTMLInputElement | null = null;

  const onClick = (event: Event): void => {
    const view = doc.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.HTMLInputElement)) return;
    if (target.type !== "color" || target === standIn) return;
    if (target.disabled || typeof target.showPicker !== "function") return;

    const rect = target.getBoundingClientRect();
    const left = Math.max(
      0,
      Math.min(rect.left, view.innerWidth - PICKER_WIDTH),
    );
    const top = Math.max(
      0,
      Math.min(rect.top, view.innerHeight - PICKER_HEIGHT - rect.height),
    );
    if (left === rect.left && top === rect.top) return;

    // Kept until the next open: removing it would close its picker.
    standIn?.remove();
    const proxy = doc.createElement("input");
    standIn = proxy;
    proxy.type = "color";
    proxy.value = target.value;
    proxy.tabIndex = -1;
    proxy.setAttribute("aria-hidden", "true");
    Object.assign(proxy.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      opacity: "0",
      pointerEvents: "none",
    });
    for (const type of ["input", "change"]) {
      proxy.addEventListener(type, (relayed) => {
        relayed.stopPropagation();
        target.value = proxy.value;
        target.dispatchEvent(new view.Event(type, { bubbles: true }));
      });
    }
    doc.body.appendChild(proxy);

    try {
      proxy.showPicker();
    } catch {
      return; // refused: let the swatch open its own picker
    }
    event.preventDefault();
  };

  doc.addEventListener("click", onClick, true);
}
