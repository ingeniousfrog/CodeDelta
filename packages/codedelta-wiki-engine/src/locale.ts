/** UI / wiki content locales supported by CodeDelta Wiki. */
export type WikiLocale = 'en' | 'zh-Hans';

export const DEFAULT_WIKI_LOCALE: WikiLocale = 'en';

export function normalizeWikiLocale(value: string | null | undefined): WikiLocale {
  if (value === 'zh-Hans' || value === 'zh' || value === 'zh-CN' || value === 'zh-cn') {
    return 'zh-Hans';
  }
  return 'en';
}

interface WikiCopy {
  overview: string;
  architecture: string;
  otherAreas: string;
  rootArea: string;
  generatedFrom: string;
  fromReadme: string;
  moduleDependencies: string;
  callFlow: string;
  keySymbols: string;
  files: string;
  moreFiles: string;
  noSymbols: string;
  symbolTableHeader: string;
  moduleKind: string;
  languageInstruction: string;
  askOverviewTitle: string;
  askOverviewDetail: string;
  askNoMatch: string;
  askTopSymbols: string;
  askCallRelationships: string;
  askConfigureProvider: string;
  askValidationFailed: string;
}

const EN: WikiCopy = {
  overview: 'Overview',
  architecture: 'Architecture',
  otherAreas: 'Other areas',
  rootArea: '(root)',
  generatedFrom:
    'Generated from the structural graph at commit `{{hash}}` — {{files}} files, {{symbols}} symbols indexed.',
  fromReadme: 'From the README',
  moduleDependencies: 'Module dependencies',
  callFlow: 'Call flow',
  keySymbols: 'Key symbols',
  files: 'Files',
  moreFiles: '_…and {{count}} more files._',
  noSymbols: '_No documentable symbols in this area._',
  symbolTableHeader: '| Symbol | Kind | File | Lines |\n|---|---|---|---|',
  moduleKind: 'Module',
  languageInstruction:
    'Write the narrative / answer in English. Keep symbol names, file paths, and code identifiers in their original form.',
  askOverviewTitle: 'Repository overview (no direct symbol match for this question)',
  askOverviewDetail:
    'Use the entry-point symbols below as starting points for vague or high-level questions.',
  askNoMatch:
    'No symbols in the structural graph matched this question. Try mentioning a concrete symbol, file, or directory name.',
  askTopSymbols: 'Top matching symbols from the structural graph:',
  askCallRelationships: 'Related call relationships:',
  askConfigureProvider:
    'Configure a Provider in Settings for a narrated answer grounded in this evidence.',
  askValidationFailed:
    'The model returned a response that could not be validated against the evidence whitelist. Try rephrasing with a concrete symbol, file, or module name.',
};

const ZH: WikiCopy = {
  overview: '概览',
  architecture: '架构',
  otherAreas: '其他区域',
  rootArea: '(根目录)',
  generatedFrom:
    '基于提交 `{{hash}}` 的结构图生成 — {{files}} 个文件，已索引 {{symbols}} 个符号。',
  fromReadme: '来自 README',
  moduleDependencies: '模块依赖',
  callFlow: '调用流',
  keySymbols: '关键符号',
  files: '文件',
  moreFiles: '_…以及另外 {{count}} 个文件。_',
  noSymbols: '_此区域没有可文档化的符号。_',
  symbolTableHeader: '| 符号 | 类型 | 文件 | 行号 |\n|---|---|---|---|',
  moduleKind: '模块',
  languageInstruction:
    '请用简体中文撰写 narrative / answer。符号名、文件路径与代码标识符保持原文，不要翻译。',
  askOverviewTitle: '仓库概览（本题未直接匹配到符号）',
  askOverviewDetail: '对于笼统或高层问题，可将下列入口符号作为起点继续追问。',
  askNoMatch: '结构图中没有与该问题匹配的符号。请尝试提及具体的符号、文件或目录名。',
  askTopSymbols: '结构图中匹配度最高的符号：',
  askCallRelationships: '相关调用关系：',
  askConfigureProvider: '请在设置中配置模型提供方，以获得基于上述证据的叙述性回答。',
  askValidationFailed:
    '模型返回的内容未能通过证据白名单校验。请换用更具体的符号、文件或模块名重新提问。',
};

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function wikiCopy(locale: WikiLocale = DEFAULT_WIKI_LOCALE): WikiCopy {
  return locale === 'zh-Hans' ? ZH : EN;
}

export function formatWikiGeneratedFrom(
  locale: WikiLocale,
  hash: string,
  files: number,
  symbols: number,
): string {
  return `> ${interpolate(wikiCopy(locale).generatedFrom, { hash, files, symbols })}`;
}

export function formatWikiMoreFiles(locale: WikiLocale, count: number): string {
  return interpolate(wikiCopy(locale).moreFiles, { count });
}
