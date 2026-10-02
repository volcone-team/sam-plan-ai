'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech-to-text via the browser's built-in Web Speech API.
 *
 * NO SERVER, NO API KEY, NO COST. Recognition runs through the browser's own
 * speech service, so audio never passes through our servers and there is no
 * per-minute charge. The alternative (streaming audio to a transcription API)
 * would mean handling recordings of customers talking about their business,
 * which is a privacy and billing burden this feature does not justify.
 *
 * SUPPORT IS PARTIAL AND THAT IS HANDLED, NOT IGNORED. Chrome, Edge and Safari
 * implement `SpeechRecognition` (Chrome 25+, Edge 87+, Safari 14.1+ on macOS /
 * 14.5+ on iOS); Firefox does not ship it enabled. `supported` is therefore
 * exposed so callers can hide the control entirely rather than render a button
 * that silently does nothing.
 *
 * Browser support per
 * [LambdaTest's Speech Recognition compatibility table](https://www.lambdatest.com/web-technologies/speech-recognition-ie)
 * and [MDN's SpeechRecognition reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
 * Content was rephrased for compliance with licensing restrictions.
 */

// Minimal structural types. The API is not in TypeScript's DOM lib because it
// is not a finished standard, and `any` would lose the shape entirely.
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionErrorEventLike { readonly error: string }

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  // Chrome and Safari both expose it only under the webkit prefix.
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseDictationResult {
  /** False when the browser cannot do this — hide the control entirely. */
  supported: boolean;
  listening: boolean;
  /** Human-readable problem, or null. */
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * @param onTranscript Called with each finalised phrase, to be appended by the
 *   caller. Only final results are delivered: interim text changes as the
 *   engine revises its guess, and writing that into a form field makes the
 *   value jitter while the user is still speaking.
 */
export function useDictation(
  onTranscript: (text: string) => void
): UseDictationResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Held in a ref so the recognition instance always calls the LATEST callback
  // without being torn down and recreated on every parent render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Detect support after mount: `window` does not exist during SSR, and
  // checking in render would make the server and client markup disagree.
  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  // Stop the microphone if the component unmounts mid-dictation. Without this
  // the browser keeps listening — and keeps the recording indicator lit — after
  // the user has navigated away.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.abort(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* already stopped */ }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('This browser does not support voice input.');
      return;
    }

    // Already running: starting twice throws InvalidStateError.
    if (recognitionRef.current) return;

    setError(null);

    const rec = new Ctor();
    // continuous so a pause for breath does not end the session; the user
    // decides when they are finished.
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

    rec.onresult = (event) => {
      let finalText = '';
      // Only from resultIndex onward: earlier entries were already delivered,
      // and re-reading them duplicates text into the field.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      const trimmed = finalText.trim();
      if (trimmed) onTranscriptRef.current(trimmed);
    };

    rec.onerror = (event) => {
      // 'aborted' and 'no-speech' are routine (user stopped, or said nothing)
      // and must not be reported as failures.
      if (event.error === 'aborted' || event.error === 'no-speech') return;

      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings to use voice input.'
          : event.error === 'network'
            ? 'Voice input needs a network connection.'
            : 'Voice input stopped unexpectedly. Please try again.'
      );
      setListening(false);
      recognitionRef.current = null;
    };

    // Fires when the engine ends the session on its own (timeout, silence) as
    // well as after stop(), so the button state cannot be left stuck on.
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setError('Could not start voice input.');
      recognitionRef.current = null;
      setListening(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
