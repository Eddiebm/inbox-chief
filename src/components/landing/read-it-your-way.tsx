"use client";

import { useState } from "react";

const SIZES = [
  { id: "1", label: "Standard" },
  { id: "1.25", label: "Large" },
  { id: "1.5", label: "Largest" },
] as const;

export function ReadItYourWay() {
  const [size, setSize] = useState<(typeof SIZES)[number]["id"]>("1");
  const [contrast, setContrast] = useState(false);

  return (
    <div className="ryw">
      <div className="ryw__controls">
        <div role="group" aria-label="Text size" className="ryw__group">
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={size === s.id}
              className="ryw__btn"
              onClick={() => setSize(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={contrast}
          className="ryw__btn ryw__btn--toggle"
          onClick={() => setContrast((c) => !c)}
        >
          High contrast
        </button>
      </div>

      <div
        className="ryw__preview"
        data-contrast={contrast}
        style={{ "--ryw-scale": size } as React.CSSProperties}
      >
        <p className="ryw__meta">Inbox · 3 need you today</p>
        <p className="ryw__row ryw__row--urgent">
          <strong>Dr. Okafor’s office</strong>
          <span>Confirm Tuesday’s appointment</span>
        </p>
        <p className="ryw__row">
          <strong>Alex Rivera</strong>
          <span>Project timeline</span>
        </p>
        <p className="ryw__row">
          <strong>City Water</strong>
          <span>Your statement is ready</span>
        </p>
      </div>
    </div>
  );
}
