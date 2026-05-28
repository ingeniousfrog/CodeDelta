import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchWithRetry, formatNetworkError } from './codex-http';

const REFRESH_URL = 'https://auth.openai.com/oauth/token';
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_SKEW_SECONDS = 30;

export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexAuthError';
  }
}

export interface CodexAuthStatus {
  configured: boolean;
  authMode?: string;
  codexHome: string;
  authPath: string;
  message: string;
  defaultModel?: string;
}

export interface CodexCredentials {
  accessToken: string;
  accountId?: string;
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

export function getCodexAuthPath(): string {
  return path.join(getCodexHome(), 'auth.json');
}

export function readCodexDefaultModel(): string | undefined {
  const configPath = path.join(getCodexHome(), 'config.toml');
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    const match = text.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function readCodexAuthStatus(): CodexAuthStatus {
  const codexHome = getCodexHome();
  const authPath = getCodexAuthPath();
  const defaultModel = readCodexDefaultModel();

  if (!fs.existsSync(authPath)) {
    return {
      configured: false,
      codexHome,
      authPath,
      defaultModel,
      message: `未找到 ${authPath}。请在本机运行 codex login 后再试。`,
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(authPath, 'utf8')) as {
      auth_mode?: string;
      tokens?: { access_token?: string; refresh_token?: string };
    };
    const authMode = data.auth_mode;
    if (authMode !== 'chatgpt') {
      return {
        configured: false,
        authMode,
        codexHome,
        authPath,
        defaultModel,
        message: `auth.json 的 auth_mode 为 "${authMode ?? 'unknown'}"，当前仅支持 ChatGPT 登录（chatgpt）。`,
      };
    }
    if (!data.tokens?.access_token) {
      return {
        configured: false,
        authMode,
        codexHome,
        authPath,
        defaultModel,
        message: 'auth.json 中缺少 access_token。请运行 codex login 重新登录。',
      };
    }
    return {
      configured: true,
      authMode,
      codexHome,
      authPath,
      defaultModel,
      message: '已检测到本机 Codex CLI 登录，可用于 Trace View。',
    };
  } catch (err) {
    return {
      configured: false,
      codexHome,
      authPath,
      defaultModel,
      message: `无法读取 auth.json：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function jwtExp(token: string): number | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

async function refreshCodexTokens(refreshToken: string): Promise<{
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
}> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      REFRESH_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CODEX_OAUTH_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      },
      { timeoutMs: 30_000, retries: 2 },
    );
  } catch (err) {
    throw new CodexAuthError(formatNetworkError(err, '刷新 Codex 登录令牌时网络失败'));
  }
  const bodyText = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try {
      code = (JSON.parse(bodyText) as { error?: string }).error;
    } catch {
      /* ignore */
    }
    if (code === 'refresh_token_expired' || code === 'refresh_token_reused' || code === 'refresh_token_invalidated') {
      throw new CodexAuthError(`刷新令牌已失效（${code}）。请运行 codex login 重新登录。`);
    }
    throw new CodexAuthError(`刷新 Codex 令牌失败：HTTP ${res.status}`);
  }
  return JSON.parse(bodyText) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
  };
}

function writeAuthFile(authPath: string, data: Record<string, unknown>): void {
  const tmp = `${authPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, authPath);
  fs.chmodSync(authPath, 0o600);
}

/** Borrow ChatGPT OAuth credentials from local Codex CLI cache (refreshes when near expiry). */
export async function borrowCodexCredentials(): Promise<CodexCredentials> {
  const status = readCodexAuthStatus();
  if (!status.configured) {
    throw new CodexAuthError(status.message);
  }

  const authPath = getCodexAuthPath();
  const data = JSON.parse(fs.readFileSync(authPath, 'utf8')) as {
    auth_mode?: string;
    tokens: {
      access_token: string;
      refresh_token?: string;
      account_id?: string;
      id_token?: string;
    };
    last_refresh?: string;
  };

  if (data.auth_mode !== 'chatgpt') {
    throw new CodexAuthError(`不支持的 auth_mode: ${data.auth_mode ?? 'unknown'}`);
  }

  const tokens = data.tokens;
  let accessToken = tokens.access_token;
  const accountId = tokens.account_id;
  const exp = jwtExp(accessToken);

  if (exp !== null && Date.now() / 1000 < exp - REFRESH_SKEW_SECONDS) {
    return { accessToken, accountId };
  }

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new CodexAuthError('access_token 已过期且无 refresh_token。请运行 codex login。');
  }

  const newTokens = await refreshCodexTokens(refreshToken);
  if (newTokens.access_token) tokens.access_token = newTokens.access_token;
  if (newTokens.id_token) tokens.id_token = newTokens.id_token;
  if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
  data.tokens = tokens;
  data.last_refresh = new Date().toISOString();
  writeAuthFile(authPath, data as Record<string, unknown>);
  accessToken = tokens.access_token;

  return { accessToken, accountId };
}
