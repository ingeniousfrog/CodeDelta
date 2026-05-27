import { useEffect, useState } from 'react';
import { api, type ModelProviderConfig, type ProviderKind } from '../api/client';

const PROVIDERS: { kind: ProviderKind; label: string; description: string }[] = [
  { kind: 'none', label: 'No AI', description: 'Timeline and Delta View without LLM calls.' },
  { kind: 'codex-oauth', label: 'Codex OAuth', description: 'ChatGPT-style login when available (Phase 3).' },
  { kind: 'openai', label: 'OpenAI API key', description: 'Direct OpenAI API access (Phase 3).' },
  { kind: 'openai-compatible', label: 'OpenAI-compatible', description: 'Custom endpoint (Phase 3).' },
  { kind: 'anthropic', label: 'Anthropic', description: 'Claude API (Phase 3).' },
  { kind: 'ollama', label: 'Ollama', description: 'Local models via Ollama (Phase 3).' },
];

export default function ProviderSettingsPage() {
  const [config, setConfig] = useState<ModelProviderConfig>({ kind: 'none' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProvider().then(setConfig).catch(() => setError('Failed to load settings'));
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const updated = await api.setProvider(config);
      setConfig(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="page">
      <h1>Provider Settings</h1>
      <p className="lead">
        Choose how CodeDelta calls language models for Trace View. No-AI mode keeps all
        deterministic structural analysis available.
      </p>

      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success">Settings saved.</div>}

      <div className="provider-list">
        {PROVIDERS.map((p) => (
          <label key={p.kind} className={`provider-option ${config.kind === p.kind ? 'selected' : ''}`}>
            <input
              type="radio"
              name="provider"
              checked={config.kind === p.kind}
              onChange={() => setConfig({ kind: p.kind })}
            />
            <div>
              <strong>{p.label}</strong>
              <p className="hint">{p.description}</p>
            </div>
          </label>
        ))}
      </div>

      {config.kind !== 'none' && (
        <section className="card mt">
          <p className="hint">
            Provider credentials will be configurable in Phase 3. Selection is saved for when
            Trace View is enabled.
          </p>
          <label>
            API key / token (optional placeholder)
            <input
              type="password"
              value={config.apiKey ?? ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              disabled={config.kind === 'codex-oauth'}
            />
          </label>
          <label>
            Base URL (OpenAI-compatible)
            <input
              type="text"
              value={config.baseUrl ?? ''}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={config.model ?? ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
          </label>
        </section>
      )}

      <button type="button" className="mt" onClick={save}>
        Save settings
      </button>
    </div>
  );
}
