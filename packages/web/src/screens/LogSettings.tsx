import type { OperatorSettings } from '@amberchest/core';
import { ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsPatch } from '../api/client.js';
import { Card, Field, Select, Toggle } from '../components/ui.js';

type Logging = OperatorSettings['logging'];
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** How much the program says, and whether it also keeps a file. */
export function LogSettings({
  logging,
  onChange,
}: {
  logging: Logging;
  onChange: (part: SettingsPatch) => void;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <ScrollText size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-medium">{t('logSettings.title')}</span>
      </div>

      <Field label={t('logSettings.level')} hint={t('logSettings.levelHint')}>
        <Select
          value={logging.level ?? ''}
          onChange={(event) =>
            onChange({ logging: { ...logging, level: (event.target.value || null) as Logging['level'] } })
          }
        >
          <option value="">{t('logSettings.levelDefault')}</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`logSettings.levels.${level}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Toggle
        checked={logging.toFile}
        onChange={(toFile) => onChange({ logging: { ...logging, toFile } })}
        label={t('logSettings.toFile')}
        hint={t('logSettings.toFileHint')}
      />
    </Card>
  );
}
