import { useState } from 'react';
import Session, { type SetResult, type Source } from './ui/Session';
import Setup, { type Settings } from './ui/Setup';
import Summary from './ui/Summary';

const DEFAULTS: Settings = { exercise: 'squat', barbell: false, voice: true, heightCm: 175, model: 'lite' };

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('spotter.settings') ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

type Screen = { name: 'setup' } | { name: 'session'; source: Source } | { name: 'summary'; result: SetResult; source: Source };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>({ name: 'setup' });
  const save = (s: Settings) => {
    setSettings(s);
    localStorage.setItem('spotter.settings', JSON.stringify(s));
  };

  if (screen.name === 'session') {
    return (
      <Session
        key={JSON.stringify(screen.source)}
        settings={settings}
        source={screen.source}
        onCancel={() => setScreen({ name: 'setup' })}
        onDone={(result) => setScreen({ name: 'summary', result, source: screen.source })}
      />
    );
  }
  if (screen.name === 'summary') {
    return (
      <Summary
        result={screen.result}
        onAgain={() => setScreen({ name: 'session', source: { ...screen.source } })}
        onHome={() => setScreen({ name: 'setup' })}
      />
    );
  }
  return <Setup settings={settings} onChange={save} onStart={(source) => setScreen({ name: 'session', source })} />;
}
