export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'zh-CN', 'ja', 'ko', 'es']);

const MESSAGES = Object.freeze({
  en: Object.freeze({
    native_package_manager: 'Native package manager',
    typed_package_commands: 'Typed package commands',
    runtime_controls: 'Runtime controls',
    profiles_bundles_transactions: 'Profiles, bundles and transactions',
    host_bridge: 'Host bridge',
    developer_package_workflow: 'Developer package workflow',
    rules: 'Rules',
    rule_versionless: 'A versionless install resolves the latest compatible package from the selected channel (stable by default).',
    rule_permission: 'Dangerous or unknown permissions require explicit --yes approval before any dependency is installed.',
    rule_dry_run: '--dry-run is always non-mutating and never requires approval.',
    rule_host_approval: 'Host/deep-link mutation never executes without explicit local approval.',
    rule_no_restart: 'Install/update/repair/rollback/enable/disable never restart the client automatically.',
    rule_pending_activation: "Installed packages that require activation remain pending until the desktop client calls 'dsh startup activate'.",
    rule_api: 'Canonical remote APIs remain under /api/v1.',
    install_verified_restart: 'Install verified. Restart the client manually to activate the runtime package.',
  }),
  'zh-CN': Object.freeze({
    native_package_manager: '原生包管理器',
    typed_package_commands: '按类型的包命令',
    runtime_controls: '运行时控制',
    profiles_bundles_transactions: 'Profile、Bundle 与事务',
    host_bridge: 'Host Bridge',
    developer_package_workflow: '开发者包工作流',
    rules: '规则',
    rule_versionless: '未指定版本时，从所选 channel 解析最新兼容版本（默认 stable）。',
    rule_permission: '危险或未知权限必须通过 --yes 显式确认，依赖安装前同样执行此门禁。',
    rule_dry_run: '--dry-run 永远不修改本地状态，也不要求权限确认。',
    rule_host_approval: 'Host / Deep Link 的变更操作必须经过本地显式确认，远程页面不能直接执行。',
    rule_no_restart: 'install/update/repair/rollback/enable/disable 永远不会自动重启客户端。',
    rule_pending_activation: "需要激活的已安装包保持 pending，直到桌面客户端执行 'dsh startup activate'。",
    rule_api: '远程机器接口继续稳定在 /api/v1。',
    install_verified_restart: '安装与校验已完成。请在需要时手动重启客户端以激活运行时包。',
  }),
  ja: Object.freeze({
    native_package_manager: 'ネイティブパッケージマネージャー',
    typed_package_commands: 'タイプ別パッケージコマンド',
    runtime_controls: 'ランタイム制御',
    profiles_bundles_transactions: 'Profile、Bundle、トランザクション',
    host_bridge: 'Host Bridge',
    developer_package_workflow: '開発者向けパッケージワークフロー',
    rules: 'ルール',
    rule_versionless: 'バージョン未指定の場合、選択した channel の最新互換版を解決します（既定は stable）。',
    rule_permission: '危険または未知の権限は、依存関係を導入する前に --yes による明示的な承認が必要です。',
    rule_dry_run: '--dry-run は常に非破壊で、承認を要求しません。',
    rule_host_approval: 'Host / Deep Link による変更は、ローカルの明示的承認なしには実行されません。',
    rule_no_restart: 'install/update/repair/rollback/enable/disable はクライアントを自動再起動しません。',
    rule_pending_activation: "有効化が必要なパッケージは、デスクトップが 'dsh startup activate' を実行するまで pending のままです。",
    rule_api: 'リモート API の正規パスは /api/v1 のままです。',
    install_verified_restart: 'インストールと検証が完了しました。必要に応じて手動でクライアントを再起動して有効化してください。',
  }),
  ko: Object.freeze({
    native_package_manager: '네이티브 패키지 관리자',
    typed_package_commands: '유형별 패키지 명령',
    runtime_controls: '런타임 제어',
    profiles_bundles_transactions: 'Profile, Bundle 및 트랜잭션',
    host_bridge: 'Host Bridge',
    developer_package_workflow: '개발자 패키지 워크플로',
    rules: '규칙',
    rule_versionless: '버전을 생략하면 선택한 channel에서 최신 호환 버전을 해석합니다(기본 stable).',
    rule_permission: '위험하거나 알 수 없는 권한은 종속성을 설치하기 전에 --yes로 명시적 승인이 필요합니다.',
    rule_dry_run: '--dry-run은 항상 비파괴이며 승인을 요구하지 않습니다.',
    rule_host_approval: 'Host / Deep Link 변경은 로컬의 명시적 승인 없이는 실행되지 않습니다.',
    rule_no_restart: 'install/update/repair/rollback/enable/disable은 클라이언트를 자동으로 재시작하지 않습니다.',
    rule_pending_activation: "활성화가 필요한 패키지는 데스크톱 클라이언트가 'dsh startup activate'를 실행할 때까지 pending 상태를 유지합니다.",
    rule_api: '정식 원격 API는 계속 /api/v1을 사용합니다.',
    install_verified_restart: '설치와 검증이 완료되었습니다. 필요할 때 클라이언트를 수동으로 재시작해 런타임 패키지를 활성화하세요.',
  }),
  es: Object.freeze({
    native_package_manager: 'Gestor de paquetes nativo',
    typed_package_commands: 'Comandos de paquetes por tipo',
    runtime_controls: 'Controles del runtime',
    profiles_bundles_transactions: 'Profiles, bundles y transacciones',
    host_bridge: 'Host Bridge',
    developer_package_workflow: 'Flujo de paquetes para desarrolladores',
    rules: 'Reglas',
    rule_versionless: 'Una instalación sin versión resuelve la versión compatible más reciente del channel seleccionado (stable por defecto).',
    rule_permission: 'Los permisos peligrosos o desconocidos requieren aprobación explícita con --yes antes de instalar dependencias.',
    rule_dry_run: '--dry-run nunca modifica el estado local y no requiere aprobación.',
    rule_host_approval: 'Las mutaciones de Host / Deep Link nunca se ejecutan sin aprobación local explícita.',
    rule_no_restart: 'install/update/repair/rollback/enable/disable nunca reinician el cliente automáticamente.',
    rule_pending_activation: "Los paquetes que requieren activación permanecen pending hasta que el cliente ejecute 'dsh startup activate'.",
    rule_api: 'Las API remotas canónicas permanecen bajo /api/v1.',
    install_verified_restart: 'La instalación y la verificación terminaron. Reinicia el cliente manualmente cuando quieras activar el paquete.',
  }),
});

export function normalizeLanguage(value = 'en') {
  const raw = String(value || 'en').trim();
  const lower = raw.toLowerCase();
  const aliases = {
    en: 'en',
    'en-us': 'en',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    ja: 'ja',
    'ja-jp': 'ja',
    ko: 'ko',
    'ko-kr': 'ko',
    es: 'es',
    'es-es': 'es',
  };
  const locale = aliases[lower];
  if (!locale) {
    const error = new Error(`unsupported CLI language: ${raw || '<empty>'}`);
    error.code = 'DSH_UNSUPPORTED_LANGUAGE';
    error.supported_languages = [...SUPPORTED_LANGUAGES];
    throw error;
  }
  return locale;
}

export function cliLanguage(env = process.env) {
  return normalizeLanguage(env.DSH_LANG || 'en');
}

export function translate(key, locale = cliLanguage(), variables = {}) {
  const language = normalizeLanguage(locale);
  const template = MESSAGES[language]?.[key];
  if (template == null) {
    const error = new Error(`missing CLI translation: ${language}.${key}`);
    error.code = 'DSH_I18N_MISSING_KEY';
    throw error;
  }
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) => String(variables[name] ?? `{${name}}`));
}

export function i18nCatalogStatus() {
  const referenceKeys = Object.keys(MESSAGES.en).sort();
  const languages = {};
  const missing = [];
  const extra = [];
  for (const language of SUPPORTED_LANGUAGES) {
    const keys = Object.keys(MESSAGES[language] || {}).sort();
    const absent = referenceKeys.filter((key) => !keys.includes(key));
    const unexpected = keys.filter((key) => !referenceKeys.includes(key));
    languages[language] = { keys: keys.length, missing: absent, extra: unexpected };
    missing.push(...absent.map((key) => `${language}.${key}`));
    extra.push(...unexpected.map((key) => `${language}.${key}`));
  }
  return { ok: missing.length === 0 && extra.length === 0, reference_keys: referenceKeys, languages, missing, extra };
}

export function assertI18nCatalogComplete() {
  const status = i18nCatalogStatus();
  if (!status.ok) {
    const error = new Error(`CLI i18n catalog mismatch: missing=${status.missing.join(',') || 'none'} extra=${status.extra.join(',') || 'none'}`);
    error.code = 'DSH_I18N_CATALOG_INVALID';
    error.status = status;
    throw error;
  }
  return status;
}
