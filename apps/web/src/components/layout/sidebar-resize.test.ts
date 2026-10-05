import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { startEdgeDrag } from "./sidebar-resize";

function press(handle: HTMLElement, button = 0) {
  return {
    button,
    pointerId: 1,
    clientX: 200,
    currentTarget: handle,
    preventDefault: () => {},
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function pointer(type: string, init: { clientX?: number; buttons?: number } = {}) {
  const event = new MouseEvent(type, { clientX: init.clientX ?? 0, buttons: init.buttons ?? 0 });
  return event;
}

describe("startEdgeDrag", () => {
  it("follows moves while the button is held and stops on pointerup anywhere", () => {
    const handle = document.createElement("div");
    const onMove = vi.fn();
    const onEnd = vi.fn();
    expect(startEdgeDrag(press(handle), { onMove, onEnd })).toBe(true);
    window.dispatchEvent(pointer("pointermove", { clientX: 240, buttons: 1 }));
    expect(onMove).toHaveBeenCalledWith(240);
    window.dispatchEvent(pointer("pointerup"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    window.dispatchEvent(pointer("pointermove", { clientX: 300, buttons: 1 }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("ends when a move arrives with no button held — the release happened somewhere it was not seen", () => {
    const handle = document.createElement("div");
    const onMove = vi.fn();
    const onEnd = vi.fn();
    startEdgeDrag(press(handle), { onMove, onEnd });
    window.dispatchEvent(pointer("pointermove", { clientX: 260, buttons: 0 }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe("");
  });

  it("ends when the edge loses pointer capture or the window loses focus, once", () => {
    const handle = document.createElement("div");
    const onEnd = vi.fn();
    startEdgeDrag(press(handle), { onMove: vi.fn(), onEnd });
    handle.dispatchEvent(new Event("lostpointercapture"));
    window.dispatchEvent(new Event("blur"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores any button but the main one", () => {
    expect(startEdgeDrag(press(document.createElement("div"), 2), { onMove: vi.fn(), onEnd: vi.fn() })).toBe(false);
  });
});
