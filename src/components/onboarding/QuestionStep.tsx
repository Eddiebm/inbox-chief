"use client";

import { useId, type KeyboardEvent, type RefObject } from "react";
import type { OnboardingQuestion } from "./questions";

type QuestionStepProps = {
  question: OnboardingQuestion;
  stepIndex: number;
  totalSteps: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPrimaryAction?: () => void;
  primaryBusy?: boolean;
  inputRef: RefObject<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  >;
  headingRef: RefObject<HTMLHeadingElement | null>;
  errorMessage?: string;
};

export function QuestionStep({
  question,
  stepIndex,
  totalSteps,
  value,
  onChange,
  onSubmit,
  onPrimaryAction,
  primaryBusy = false,
  inputRef,
  headingRef,
  errorMessage,
}: QuestionStepProps) {
  const labelId = useId();
  const helpId = useId();
  const errorId = useId();
  const progressLabel = `Step ${stepIndex + 1} of ${totalSteps}`;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      question.inputKind !== "textarea"
    ) {
      event.preventDefault();
      if (question.inputKind === "gmail" && onPrimaryAction) {
        onPrimaryAction();
        return;
      }
      onSubmit();
    }
  };

  const primaryLabel =
    question.primaryLabel ??
    (question.inputKind === "consent" ? "Continue" : "Confirm and continue");

  return (
    <section className="onboarding-step" aria-labelledby={labelId}>
      <p className="onboarding-progress">
        <span className="onboarding-progress-text">{progressLabel}</span>
        <span
          className="onboarding-progress-bar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={stepIndex + 1}
          aria-label={progressLabel}
        >
          <span
            className="onboarding-progress-fill"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </span>
      </p>

      <h1
        id={labelId}
        ref={headingRef}
        className="onboarding-heading"
        tabIndex={-1}
      >
        {question.title}
      </h1>

      {question.help ? (
        <p id={helpId} className="onboarding-help">
          {question.help}
        </p>
      ) : null}

      {question.inputKind === "consent" ? (
        <div className="onboarding-info-panel" role="note">
          <p>
            Inbox Chief organizes and drafts email with your approval. Nothing
            is sent without you.
          </p>
        </div>
      ) : null}

      {question.inputKind === "gmail" ? (
        <div className="onboarding-info-panel" role="note">
          <p>
            You’ll approve access on Google’s secure screen. Inbox Chief never
            sends mail without your approval.
          </p>
        </div>
      ) : null}

      {question.inputKind === "tel" || question.inputKind === "text" ? (
        <div className="onboarding-field">
          <label className="sr-only" htmlFor={`${question.id}-input`}>
            {question.title}
          </label>
          <input
            id={`${question.id}-input`}
            ref={inputRef as RefObject<HTMLInputElement>}
            type={question.inputKind === "tel" ? "tel" : "text"}
            inputMode={question.inputKind === "tel" ? "tel" : undefined}
            autoComplete={question.inputKind === "tel" ? "tel" : "off"}
            className="onboarding-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={question.placeholder}
            aria-labelledby={labelId}
            aria-describedby={
              [question.help ? helpId : null, errorMessage ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
        </div>
      ) : null}

      {question.inputKind === "textarea" ? (
        <div className="onboarding-field">
          <label className="sr-only" htmlFor={`${question.id}-input`}>
            {question.title}
          </label>
          <textarea
            id={`${question.id}-input`}
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            className="onboarding-input onboarding-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder}
            aria-labelledby={labelId}
            aria-describedby={question.help ? helpId : undefined}
            rows={4}
          />
        </div>
      ) : null}

      {question.inputKind === "select" && question.options ? (
        <div className="onboarding-field">
          <label className="sr-only" htmlFor={`${question.id}-input`}>
            {question.title}
          </label>
          <select
            id={`${question.id}-input`}
            ref={inputRef as RefObject<HTMLSelectElement>}
            className="onboarding-input onboarding-select"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-labelledby={labelId}
            aria-describedby={question.help ? helpId : undefined}
          >
            <option value="">Choose an option</option>
            {question.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {question.inputKind === "choice" && question.options ? (
        <fieldset className="onboarding-choices" aria-labelledby={labelId}>
          <legend className="sr-only">{question.title}</legend>
          {question.options.map((opt) => {
            const optionId = `${question.id}-${opt.value}`;
            return (
              <label
                key={opt.value}
                htmlFor={optionId}
                className="onboarding-choice"
              >
                <input
                  id={optionId}
                  type="radio"
                  name={question.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => onChange(opt.value)}
                />
                <span className="onboarding-choice-label">{opt.label}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {errorMessage ? (
        <p id={errorId} className="onboarding-help" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="onboarding-continue-row">
        <button
          type="button"
          className="onboarding-btn onboarding-btn-primary onboarding-btn-wide"
          onClick={() => {
            if (question.inputKind === "gmail" && onPrimaryAction) {
              onPrimaryAction();
              return;
            }
            onSubmit();
          }}
          disabled={primaryBusy}
          aria-busy={primaryBusy}
        >
          {primaryBusy
            ? "Working…"
            : question.inputKind === "gmail"
              ? primaryLabel
              : primaryLabel}
        </button>
        {question.optional && question.inputKind === "gmail" ? (
          <button
            type="button"
            className="onboarding-btn onboarding-btn-ghost onboarding-btn-wide"
            onClick={onSubmit}
            disabled={primaryBusy}
          >
            Skip for now
          </button>
        ) : null}
        {question.optional && question.inputKind === "tel" ? (
          <button
            type="button"
            className="onboarding-btn onboarding-btn-ghost onboarding-btn-wide"
            onClick={() => {
              onChange("");
              onSubmit();
            }}
            disabled={primaryBusy}
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </section>
  );
}
