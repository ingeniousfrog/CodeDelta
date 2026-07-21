import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const PROVIDER_KINDS: ProviderKind[] = [
  'none',
  'codex-oauth',
  'openai',
  'openai-compatible',
  'anthropic',
  'ollama',
];

const UNIMPLEMENTED: ProviderKind[] = ['anthropic', 'ollama'];

export default function ProviderSettingsPage() {
  const { t } = useTranslation(['settings', 'common']);
  const [config, setConfig] = useState<ModelProviderConfig>({ kind: 'none' });
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProvider().then(setConfig).catch(() => setError(t('common:errors.loadSettingsFailed')));
  }, [t]);

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
      setError(t('provider.unimplemented'));
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
      setError(err instanceof Error ? err.message : t('common:errors.saveFailed'));
    }
  }

  const showOpenAiFields = config.kind === 'openai' || config.kind === 'openai-compatible';
  const showCodexFields = config.kind === 'codex-oauth';

  return (
    <div className="page">
      <PageHeader title={t('provider.title')} description={t('provider.description')} />

      {error && <Alert variant="error">{error}</Alert>}
      {saved && <Alert variant="success">{t('provider.saved')}</Alert>}

      <Card>
        <CardHeader title={t('provider.providerCardTitle')} description={t('provider.providerCardDesc')} />
        {PROVIDER_KINDS.map((kind) => (
          <SelectableCard
            key={kind}
            selected={config.kind === kind}
            disabled={UNIMPLEMENTED.includes(kind)}
            title={t(`provider.kinds.${kind}.label`)}
            description={t(`provider.kinds.${kind}.description`)}
            onSelect={() =>
              setConfig({
                kind,
                model:
                  kind === 'codex-oauth' && codexStatus?.defaultModel
                    ? codexStatus.defaultModel
                    : config.model,
              })
            }
          />
        ))}
      </Card>

      {showCodexFields && (
        <Card>
          <CardHeader title={t('provider.codexLoginStatus')} />
          {codexStatus ? (
            <p className="form-hint" style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`status-dot ${codexStatus.configured ? 'status-dot-ok' : 'status-dot-off'}`} />
              {codexStatus.message}
            </p>
          ) : (
            <p className="form-hint">{t('provider.checkingCodex')}</p>
          )}
          {codexStatus && (
            <p className="form-hint">
              {t('provider.configDirectory')} <code className="mono">{codexStatus.codexHome}</code>
            </p>
          )}
          <FormField label={t('provider.model')} hint={t('provider.modelHint')}>
            <TextInput
              value={config.model ?? codexStatus?.defaultModel ?? ''}
              placeholder={codexStatus?.defaultModel ?? 'gpt-4o-mini'}
              onChange={(e) => setConfig({ ...config, model: e.target.value || undefined })}
            />
          </FormField>
          <p className="form-hint">
            {t('provider.codexLoginHint')}
          </p>
        </Card>
      )}

      {showOpenAiFields && (
        <Card>
          <CardHeader title={t('provider.apiCredentials')} />
          <FormField label={t('provider.apiKey')}>
            <TextInput
              type="password"
              value={config.apiKey ?? ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              autoComplete="off"
            />
          </FormField>
          {config.kind === 'openai-compatible' && (
            <FormField label={t('provider.baseUrl')}>
              <TextInput
                value={config.baseUrl ?? ''}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </FormField>
          )}
          <FormField label={t('provider.model')}>
            <TextInput
              value={config.model ?? ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </FormField>
        </Card>
      )}

      <Button variant="primary" onClick={save}>
        {t('provider.save')}
      </Button>
    </div>
  );
}
