import { useTranslation } from 'react-i18next';
import { Card, CardHeader, PageHeader } from '../components/ui';
import { setAppLocale, type AppLocale } from '../i18n';

export default function GeneralSettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const locale = (i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en') as AppLocale;

  async function selectLocale(next: AppLocale) {
    if (next === locale) return;
    await setAppLocale(next);
  }

  return (
    <div className="page">
      <PageHeader title={t('general.title')} description={t('general.description')} />

      <Card>
        <CardHeader title={t('general.language')} description={t('general.languageHint')} />
        <div className="locale-capsule" role="group" aria-label={t('general.language')}>
          <button
            type="button"
            className={locale === 'en' ? 'active' : ''}
            aria-pressed={locale === 'en'}
            onClick={() => void selectLocale('en')}
          >
            {t('general.en')}
          </button>
          <button
            type="button"
            className={locale === 'zh-Hans' ? 'active' : ''}
            aria-pressed={locale === 'zh-Hans'}
            onClick={() => void selectLocale('zh-Hans')}
          >
            {t('general.zh')}
          </button>
        </div>
      </Card>
    </div>
  );
}
