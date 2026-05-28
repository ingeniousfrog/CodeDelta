import { useEffect, useState } from 'react';
import { api, type ModelProviderConfig, type ProviderKind } from '../api/client';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  FormField,
  PageHeader,
  SelectableCard,
  TextInput,
} from '../components/ui';

type CodexAuthStatus = Awaited<ReturnType<typeof api.getCodexAuthStatus>>;

const PROVIDERS: { kind: ProviderKind; label: string; description: string }[] = [
  {
    kind: 'none',
    label: 'No AI',
    description: 'Deterministic trace candidates and evidence only; no model calls.',
  },
  {
    kind: 'codex-oauth',
    label: 'Codex OAuth',
    description: 'Reuse local Codex CLI login (~/.codex/auth.json). Run codex login first.',
  },
  {
    kind: 'openai',
    label: 'OpenAI API key',
    description: 'Direct OpenAI chat/completions API.',
  },
  {
    kind: 'openai-compatible',
    label: 'OpenAI-compatible',
    description: 'Custom endpoint with an OpenAI-compatible API.',
  },
  { kind: 'anthropic', label: 'Anthropic', description: 'Not implemented yet.' },
  { kind: 'ollama', label: 'Ollama', description: 'Not implemented yet.' },
];

const UNIMPLEMENTED: ProviderKind[] = ['anthropic', 'ollama'];

export default function ProviderSettingsPage() {
  const [config, setConfig] = useState<ModelProviderConfig>({ kind: 'none' });
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProvider().then(setConfig).catch(() => setError('Failed to load settings'));
  }, []);

  useEffect(() => {
    api
      .getCodexAuthStatus()
      .then(setCodexStatus)
      .catch(() => setCodexStatus(null));
  }, [config.kind, saved]);

  async function save() {
    setError(null);
    setSaved(false);
    if (UNIMPLEMENTED.includes(config.kind)) {
      setError('This provider is not implemented yet. Choose No AI, Codex OAuth, or OpenAI.');
      return;
    }
    if (config.kind === 'codex-oauth' && codexStatus && !codexStatus.configured) {
      setError(codexStatus.message);
      return;
    }
    try {
      const updated = await api.setProvider(config);
      setConfig(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  const showOpenAiFields = config.kind === 'openai' || config.kind === 'openai-compatible';
  const showCodexFields = config.kind === 'codex-oauth';

  return (
    <div className="page">
      <PageHeader
        title="Provider Settings"
        description="Optional language model for Trace View. Deterministic analysis always runs; model output is non-authoritative."
      />

      {error && <Alert variant="error">{error}</Alert>}
      {saved && <Alert variant="success">Settings saved.</Alert>}

      <Card>
        <CardHeader title="Provider" description="Select how Trace View may call a model." />
        {PROVIDERS.map((p) => (
          <SelectableCard
            key={p.kind}
            selected={config.kind === p.kind}
            disabled={UNIMPLEMENTED.includes(p.kind)}
            title={p.label}
            description={p.description}
            onSelect={() =>
              setConfig({
                kind: p.kind,
                model:
                  p.kind === 'codex-oauth' && codexStatus?.defaultModel
                    ? codexStatus.defaultModel
                    : config.model,
              })
            }
          />
        ))}
      </Card>

      {showCodexFields && (
        <Card>
          <CardHeader title="Codex login status" />
          {codexStatus ? (
            <p className="form-hint" style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`status-dot ${codexStatus.configured ? 'status-dot-ok' : 'status-dot-off'}`} />
              {codexStatus.message}
            </p>
          ) : (
            <p className="form-hint">Checking local Codex configuration…</p>
          )}
          {codexStatus && (
            <p className="form-hint">
              Config directory: <code className="mono">{codexStatus.codexHome}</code>
            </p>
          )}
          <FormField label="Model" hint="Leave empty to use model from ~/.codex/config.toml">
            <TextInput
              value={config.model ?? codexStatus?.defaultModel ?? ''}
              placeholder={codexStatus?.defaultModel ?? 'gpt-4o-mini'}
              onChange={(e) => setConfig({ ...config, model: e.target.value || undefined })}
            />
          </FormField>
          <p className="form-hint">
            Run <code className="mono">codex login</code> in your terminal; no API key is stored in CodeDelta.
          </p>
        </Card>
      )}

      {showOpenAiFields && (
        <Card>
          <CardHeader title="API credentials" />
          <FormField label="API key">
            <TextInput
              type="password"
              value={config.apiKey ?? ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              autoComplete="off"
            />
          </FormField>
          {config.kind === 'openai-compatible' && (
            <FormField label="Base URL">
              <TextInput
                value={config.baseUrl ?? ''}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </FormField>
          )}
          <FormField label="Model">
            <TextInput
              value={config.model ?? ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </FormField>
        </Card>
      )}

      <Button variant="primary" onClick={save}>
        Save settings
      </Button>
    </div>
  );
}
