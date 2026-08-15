"use client";

type VoiceControlsProps = {
  canGoBack: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  speechSynthesisAvailable: boolean;
  speechRecognitionAvailable: boolean;
  showTypeInput: boolean;
  onHearAgain: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onSkipVoiceAndType: () => void;
  onGoBack: () => void;
};

export function VoiceControls({
  canGoBack,
  isSpeaking,
  isListening,
  speechSynthesisAvailable,
  speechRecognitionAvailable,
  showTypeInput,
  onHearAgain,
  onStartListening,
  onStopListening,
  onSkipVoiceAndType,
  onGoBack,
}: VoiceControlsProps) {
  return (
    <div className="onboarding-controls" role="group" aria-label="Voice and navigation controls">
      <button
        type="button"
        className="onboarding-btn onboarding-btn-secondary"
        onClick={onHearAgain}
        disabled={!speechSynthesisAvailable || isListening}
        aria-pressed={isSpeaking}
      >
        {isSpeaking ? "Speaking…" : "Hear again"}
      </button>

      {speechRecognitionAvailable ? (
        <button
          type="button"
          className="onboarding-btn onboarding-btn-primary"
          onClick={isListening ? onStopListening : onStartListening}
          disabled={isSpeaking}
          aria-pressed={isListening}
        >
          {isListening ? "Stop listening" : "Start listening"}
        </button>
      ) : (
        <button
          type="button"
          className="onboarding-btn onboarding-btn-primary"
          disabled
          aria-label="Listening unavailable. Speech recognition is not available in this browser. Use Skip voice and type, or Continue."
          title="Speech recognition is not available in this browser"
        >
          Listening unavailable
        </button>
      )}

      <button
        type="button"
        className="onboarding-btn onboarding-btn-secondary"
        onClick={onSkipVoiceAndType}
        aria-pressed={showTypeInput}
      >
        {showTypeInput ? "Typing mode on" : "Skip voice and type"}
      </button>

      <button
        type="button"
        className="onboarding-btn onboarding-btn-ghost"
        onClick={onGoBack}
        disabled={!canGoBack}
      >
        Go back
      </button>
    </div>
  );
}
