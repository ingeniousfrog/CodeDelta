import { useEffect, useState } from 'react';
import { api, type ModelProviderConfig, type ProviderKind } from '../api/client';

type CodexAuthStatus = Awaited<ReturnType<typeof api.getCodexAuthStatus>>;

const PROVIDERS: { kind: ProviderKind; label: string; description: string }[] = [
  { kind: 'none', label: 'No AI', description: 'Trace View 使用确定性候选与证据，不调用模型。' },
  {
    kind: 'codex-oauth',
    label: 'Codex OAuth',
    description: '复用本机 Codex CLI 登录（~/.codex/auth.json，需先运行 codex login）。',
  },
  { kind: 'openai', label: 'OpenAI API key', description: '使用 OpenAI API 密钥调用 chat/completions。' },
  {
    kind: 'openai-compatible',
    label: 'OpenAI-compatible',
    description: '自定义兼容端点 + API key。',
  },
  { kind: 'anthropic', label: 'Anthropic', description: '尚未实现。' },
  { kind: 'ollama', label: 'Ollama', description: '尚未实现。' },
];

const UNIMPLEMENTED: ProviderKind[] = ['anthropic', 'ollama'];

export default function ProviderSettingsPage() {
  const [config, setConfig] = useState<ModelProviderConfig>({ kind: 'none' });
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProvider().then(setConfig).catch(() => setError('无法加载设置'));
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
      setError('该提供商尚未实现，请选择 No AI、Codex OAuth 或 OpenAI。');
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
      setError(err instanceof Error ? err.message : '保存失败');
    }
  }

  const showOpenAiFields =
    config.kind === 'openai' || config.kind === 'openai-compatible';
  const showCodexFields = config.kind === 'codex-oauth';

  return (
    <div className="page">
      <h1>Provider Settings</h1>
      <p className="lead">
        配置 Trace View 可选的语言模型。无 AI 模式下仍可使用完整确定性分析与证据链；模型输出为非权威补充。
      </p>

      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success">设置已保存。</div>}

      <div className="provider-list">
        {PROVIDERS.map((p) => (
          <label key={p.kind} className={`provider-option ${config.kind === p.kind ? 'selected' : ''}`}>
            <input
              type="radio"
              name="provider"
              checked={config.kind === p.kind}
              onChange={() =>
                setConfig({
                  kind: p.kind,
                  model:
                    p.kind === 'codex-oauth' && codexStatus?.defaultModel
                      ? codexStatus.defaultModel
                      : config.model,
                })
              }
              disabled={UNIMPLEMENTED.includes(p.kind)}
            />
            <div>
              <strong>{p.label}</strong>
              <p className="hint">{p.description}</p>
            </div>
          </label>
        ))}
      </div>

      {showCodexFields && (
        <section className="card mt">
          <h2>Codex 登录状态</h2>
          {codexStatus ? (
            <p className={codexStatus.configured ? 'hint' : 'alert error'}>{codexStatus.message}</p>
          ) : (
            <p className="hint">正在检测本机 Codex 配置…</p>
          )}
          {codexStatus && (
            <p className="hint">
              配置目录：<code>{codexStatus.codexHome}</code>
            </p>
          )}
          <label>
            Model（留空则使用 config.toml 中的 model）
            <input
              type="text"
              value={config.model ?? codexStatus?.defaultModel ?? ''}
              placeholder={codexStatus?.defaultModel ?? 'gpt-4o-mini'}
              onChange={(e) => setConfig({ ...config, model: e.target.value || undefined })}
            />
          </label>
          <p className="hint">
            在终端执行 <code>codex login</code> 完成 ChatGPT 登录后，无需在此填写 API key。
          </p>
        </section>
      )}

      {showOpenAiFields && (
        <section className="card mt">
          <label>
            API key
            <input
              type="password"
              value={config.apiKey ?? ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              autoComplete="off"
            />
          </label>
          {config.kind === 'openai-compatible' && (
            <label>
              Base URL
              <input
                type="text"
                value={config.baseUrl ?? ''}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </label>
          )}
          <label>
            Model
            <input
              type="text"
              value={config.model ?? ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </label>
        </section>
      )}

      <button type="button" className="mt" onClick={save}>
        保存设置
      </button>
    </div>
  );
}
