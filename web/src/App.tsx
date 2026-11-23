import { useCallback, useMemo, useRef, useState } from 'react';
import { History, toSavedSet } from './core/history';
import HistoryView from './ui/HistoryView';
import Session, { type SessionCommands, type SetResult, type Source } from './ui/Session';
import Setup, { DEFAULT_SETTINGS, PREVIEW, usesBarWeight, type Settings } from './ui/Setup';
import Summary from './ui/Summary';
import { useVoiceCommands, voiceCommandsSupported, type Command } from './ui/voiceCommands';

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('spotter.settings') ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type Screen =
  | { name: 'setup' }
  | { name: 'session'; source: Source }
  | { name: 'summary'; result: SetResult; source: Source }
  | { name: 'history'; back: Screen };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>({ name: 'setup' });
  const history = useMemo(() => new History(), []);
  const commands = useRef<SessionCommands | null>(null);
  const save = (s: Settings) => {
    setSettings(s);
    try {
      localStorage.setItem('spotter.settings', JSON.stringify(s));
    } catch {
      /* storage blocked */
    }
  };

  const onCommand = useCallback((c: Command) => {
    setScreen((cur) => {
      if (c === 'end' && cur.name === 'session') commands.current?.end();
      if ((c === 'mute' || c === 'unmute') && cur.name === 'session') commands.current?.setMuted(c === 'mute');
      if ((c === 'next' || c === 'start') && cur.name === 'summary') return { name: 'session', source: { ...cur.source } };
      if (c === 'start' && cur.name === 'setup' && !PREVIEW) return { name: 'session', source: { kind: 'camera', facing: 'user' } };
      if (c === 'history' && cur.name !== 'session' && cur.name !== 'history') return { name: 'history', back: cur };
      return cur;
    });
  }, []);
  const listening = useVoiceCommands(settings.voiceCommands && !PREVIEW, onCommand);

  if (screen.name === 'session') {
    return (
      <Session
        key={JSON.stringify(screen.source)}
        settings={settings}
        source={screen.source}
        commands={commands}
        onCancel={() => setScreen({ name: 'setup' })}
        onDone={(result) => {
          if (result.exercise) {
            history.add(toSavedSet(result.exercise, result.reps, result.hold, usesBarWeight(settings) ? settings.weightKg : 0, result.endedAt));
          }
          setScreen({ name: 'summary', result, source: screen.source });
        }}
      />
    );
  }
  if (screen.name === 'summary') {
    return (
      <Summary
        result={screen.result}
        onAgain={() => setScreen({ name: 'session', source: { ...screen.source } })}
        onHome={() => setScreen({ name: 'setup' })}
        onHistory={() => setScreen({ name: 'history', back: screen })}
      />
    );
  }
  if (screen.name === 'history') {
    return <HistoryView history={history} onBack={() => setScreen(screen.back)} />;
  }
  return (
    <Setup
      settings={settings}
      onChange={save}
      onStart={(source) => setScreen({ name: 'session', source })}
      onHistory={() => setScreen({ name: 'history', back: { name: 'setup' } })}
      voiceSupported={voiceCommandsSupported()}
      listening={listening}
    />
  );
}
