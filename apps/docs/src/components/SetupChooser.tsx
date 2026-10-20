import { useState } from 'react';

const choices = [
  { id: 'local', label: 'Run a visual test', detail: 'Compare your app and inspect the evidence. No account, database or AI key required.', path: 'start/quickstart/' },
  { id: 'team', label: 'Set up a team dashboard', detail: 'Keep run history, share reviews and connect your own private runner.', path: 'dashboard/local/' },
  { id: 'source', label: 'Develop from source', detail: 'Clone VisualGuard and run the included production and staging demo.', path: 'contributing/local-setup/' },
];

export default function SetupChooser({ base }: { base: string }) {
  const [selected, setSelected] = useState('local');
  return (
    <section className="setup-chooser" aria-labelledby="choose-heading">
      <h2 id="choose-heading">What would you like to do?</h2>
      <div className="chooser-options">
        {choices.map((choice) => (
          <div key={choice.id} className={`setup-option ${selected === choice.id ? 'selected' : ''}`}>
            <button type="button" aria-pressed={selected === choice.id} onClick={() => setSelected(choice.id)}>{choice.label}</button>
            <p>{choice.detail}</p>
            <a href={`${base.replace(/\/$/, '')}/${choice.path}`}>Open the guide <span aria-hidden="true">↗</span></a>
          </div>
        ))}
      </div>
      <p className="chooser-note" aria-live="polite">{selected === 'local' ? 'Start small: one route, one viewport, deterministic analysis.' : selected === 'team' ? 'Start with SQLite locally, then choose shared storage when you need it.' : 'The local fixture demo gives you two ready-made applications to compare.'}</p>
    </section>
  );
}
