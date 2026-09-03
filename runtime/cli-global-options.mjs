import { normalizeLanguage } from './i18n.mjs';

function parseLangAssignment(value) {
  const raw = String(value || '');
  if (!raw.startsWith('--lang=')) return null;
  return raw.slice('--lang='.length);
}

export function parseGlobalCliOptions(inputArgs = [], env = process.env) {
  const args = [];
  let json = env.DSH_OUTPUT_JSON === '1';
  let language = env.DSH_LANG || 'en';

  for (let index = 0; index < inputArgs.length; index += 1) {
    const value = inputArgs[index];
    if (value === '--json') {
      json = true;
      continue;
    }
    if (value === '--lang') {
      const requested = inputArgs[index + 1];
      if (!requested || String(requested).startsWith('--')) {
        const error = new Error('--lang requires one of: en, zh-CN, ja, ko, es');
        error.code = 'DSH_LANGUAGE_REQUIRED';
        throw error;
      }
      language = requested;
      index += 1;
      continue;
    }
    const assigned = parseLangAssignment(value);
    if (assigned != null) {
      if (!assigned) {
        const error = new Error('--lang requires one of: en, zh-CN, ja, ko, es');
        error.code = 'DSH_LANGUAGE_REQUIRED';
        throw error;
      }
      language = assigned;
      continue;
    }
    args.push(value);
  }

  return {
    args,
    json,
    language: normalizeLanguage(language),
  };
}

export function applyGlobalCliOptions(inputArgs = [], env = process.env) {
  const parsed = parseGlobalCliOptions(inputArgs, env);
  env.DSH_LANG = parsed.language;
  if (parsed.json) env.DSH_OUTPUT_JSON = '1';
  else if (env.DSH_OUTPUT_JSON !== '1') delete env.DSH_OUTPUT_JSON;
  return parsed;
}
