// Hands-free commands with the browser's speech recognition ("end set", "next set", "mute", "unmute").

import { useEffect, useRef, useState } from 'react';

export type Command = 'end' | 'next' | 'start' | 'mute' | 'unmute' | 'history';

/** Maps what was heard to a command. Exported for tests. */
export function parseCommand(heard: string): Command | null {
  const t = heard.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(unmute|voice on|sound on)\b/.test(t)) return 'unmute';
  if (/\b(mute|voice off|sound off|be quiet)\b/.test(t)) return 'mute';
  if (/\b(end|stop|finish|done with)( the| my)? set\b/.test(t) || /^(stop|done|finish|finished|end)$/.test(t)) return 'end';
  if (/\b(next|another|new)( set)?\b/.test(t) && /\bset\b|^next$|^another$/.test(t)) return 'next';
  if (/\b(start|begin|go)( the| a)?( set| camera)?\b/.test(t) && t.split(' ').length <= 4) return 'start';
  if (/\b(show )?history\b/.test(t)) return 'history';
  return null;
}

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

function recognitionClass(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export const voiceCommandsSupported = () => typeof window !== 'undefined' && recognitionClass() !== null;

/** Listens while `enabled`, restarting after the browser's silence timeouts, and calls `onCommand`. */
export function useVoiceCommands(enabled: boolean, onCommand: (c: Command) => void) {
  const [listening, setListening] = useState(false);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useEffect(() => {
    const Rec = recognitionClass();
    if (!enabled || !Rec) return;
    let stopped = false;
    let rec: Recognition | null = null;
    const begin = () => {
      if (stopped) return;
      rec = new Rec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const c = parseCommand(e.results[i][0].transcript);
          if (c) handler.current(c);
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true;
      };
      rec.onend = () => {
        setListening(false);
        if (!stopped) setTimeout(begin, 300); // browsers stop after silence; keep listening
      };
      try {
        rec.start();
        setListening(true);
      } catch {
        setTimeout(begin, 1000);
      }
    };
    begin();
    return () => {
      stopped = true;
      rec?.stop();
      setListening(false);
    };
  }, [enabled]);

  return listening;
}
