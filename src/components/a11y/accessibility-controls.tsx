"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";

export const A11Y_STORAGE_KEY = "inbox-chief-a11y";

export type ContrastMode = "default" | "high";
export type UiDensity = "default" | "comfortable" | "compact";
export type ReducedMotionMode = "system" | "reduce" | "no-preference";
export type TextScale = "100" | "112" | "125" | "150";

export type A11yPreferences = {
  contrast: ContrastMode;
  ui: UiDensity;
  reducedMotion: ReducedMotionMode;
  textScale: TextScale;
};

export const DEFAULT_A11Y: A11yPreferences = {
  contrast: "default",
  ui: "default",
  reducedMotion: "system",
  textScale: "100",
};

function parsePrefs(raw: string | null): A11yPreferences {
  if (!raw) return DEFAULT_A11Y;
  try {
    const parsed = JSON.parse(raw) as Partial<A11yPreferences>;
    return {
      contrast:
        parsed.contrast === "high" || parsed.contrast === "default"
          ? parsed.contrast
          : DEFAULT_A11Y.contrast,
      ui:
        parsed.ui === "comfortable" ||
        parsed.ui === "compact" ||
        parsed.ui === "default"
          ? parsed.ui
          : DEFAULT_A11Y.ui,
      reducedMotion:
        parsed.reducedMotion === "reduce" ||
        parsed.reducedMotion === "no-preference" ||
        parsed.reducedMotion === "system"
          ? parsed.reducedMotion
          : DEFAULT_A11Y.reducedMotion,
      textScale:
        parsed.textScale === "100" ||
        parsed.textScale === "112" ||
        parsed.textScale === "125" ||
        parsed.textScale === "150"
          ? parsed.textScale
          : DEFAULT_A11Y.textScale,
    };
  } catch {
    return DEFAULT_A11Y;
  }
}

function readStored(): A11yPreferences {
  if (typeof window === "undefined") return DEFAULT_A11Y;
  return parsePrefs(localStorage.getItem(A11Y_STORAGE_KEY));
}

function applyToDocument(prefs: A11yPreferences) {
  const root = document.documentElement;
  root.dataset.contrast = prefs.contrast;
  root.dataset.ui = prefs.ui;
  root.dataset.reducedMotion = prefs.reducedMotion;
  root.dataset.textScale = prefs.textScale;
  root.style.setProperty("--text-scale", `${Number(prefs.textScale) / 100}`);
}

function writePrefs(prefs: A11yPreferences) {
  localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
  applyToDocument(prefs);
  window.dispatchEvent(new Event("inbox-chief-a11y-change"));
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("inbox-chief-a11y-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("inbox-chief-a11y-change", handler);
  };
}

function getServerSnapshot(): A11yPreferences {
  return DEFAULT_A11Y;
}

type AccessibilityControlsProps = {
  /** Compact trigger for headers; expands into a disclosure panel */
  variant?: "panel" | "compact";
  className?: string;
};

export function AccessibilityControls({
  variant = "panel",
  className = "",
}: AccessibilityControlsProps) {
  const prefs = useSyncExternalStore(subscribe, readStored, getServerSnapshot);
  const [open, setOpen] = useState(variant === "panel");
  const panelId = useId();
  const headingId = useId();

  useEffect(() => {
    applyToDocument(readStored());
  }, []);

  const update = useCallback(
    <K extends keyof A11yPreferences>(key: K, value: A11yPreferences[K]) => {
      writePrefs({ ...readStored(), [key]: value });
    },
    [],
  );

  const reset = useCallback(() => {
    writePrefs(DEFAULT_A11Y);
  }, []);

  const form = (
    <div className="a11y-controls__fields">
      <div className="a11y-controls__field">
        <label htmlFor={`${panelId}-contrast`}>Contrast</label>
        <select
          id={`${panelId}-contrast`}
          value={prefs.contrast}
          onChange={(e) => update("contrast", e.target.value as ContrastMode)}
        >
          <option value="default">Default</option>
          <option value="high">High contrast</option>
        </select>
        <p className="a11y-controls__status" aria-live="polite">
          Contrast: {prefs.contrast === "high" ? "high" : "default"}
        </p>
      </div>

      <div className="a11y-controls__field">
        <label htmlFor={`${panelId}-ui`}>Interface density</label>
        <select
          id={`${panelId}-ui`}
          value={prefs.ui}
          onChange={(e) => update("ui", e.target.value as UiDensity)}
        >
          <option value="default">Default</option>
          <option value="comfortable">Comfortable (more space)</option>
          <option value="compact">Compact</option>
        </select>
        <p className="a11y-controls__status" aria-live="polite">
          Interface: {prefs.ui}
        </p>
      </div>

      <div className="a11y-controls__field">
        <label htmlFor={`${panelId}-motion`}>Motion</label>
        <select
          id={`${panelId}-motion`}
          value={prefs.reducedMotion}
          onChange={(e) =>
            update("reducedMotion", e.target.value as ReducedMotionMode)
          }
        >
          <option value="system">Follow system</option>
          <option value="reduce">Reduce motion</option>
          <option value="no-preference">Allow motion</option>
        </select>
        <p className="a11y-controls__status" aria-live="polite">
          Motion preference: {prefs.reducedMotion.replace("-", " ")}
        </p>
      </div>

      <div className="a11y-controls__field">
        <label htmlFor={`${panelId}-scale`}>Text size</label>
        <select
          id={`${panelId}-scale`}
          value={prefs.textScale}
          onChange={(e) => update("textScale", e.target.value as TextScale)}
        >
          <option value="100">100% (default)</option>
          <option value="112">112%</option>
          <option value="125">125%</option>
          <option value="150">150%</option>
        </select>
        <p className="a11y-controls__status" aria-live="polite">
          Text size: {prefs.textScale}%
        </p>
      </div>

      <button type="button" className="btn btn--ghost" onClick={reset}>
        Reset accessibility settings
      </button>
    </div>
  );

  if (variant === "compact") {
    return (
      <div className={`a11y-controls a11y-controls--compact ${className}`.trim()}>
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          Accessibility
        </button>
        {open ? (
          <div
            id={panelId}
            role="region"
            aria-labelledby={headingId}
            className="a11y-controls__popover"
          >
            <h2 id={headingId} className="a11y-controls__heading">
              Accessibility settings
            </h2>
            {form}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className={`a11y-controls ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="a11y-controls__heading">
        Accessibility settings
      </h2>
      <p className="a11y-controls__intro">
        Adjust contrast, spacing, motion, and text size. Choices are saved on
        this device.
      </p>
      {form}
    </section>
  );
}

/** Apply stored prefs early on the client (call from shell/layout clients). */
export function applyStoredA11yPreferences() {
  if (typeof window === "undefined") return;
  applyToDocument(readStored());
}
