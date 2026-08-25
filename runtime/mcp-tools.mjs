export const RUNTIME_MCP_TOOLS = Object.freeze([
  'plugin.install',
  'plugin.update',
  'plugin.status',
  'plugin.health',
  'plugin.rollback',
  'plugin.enable',
  'plugin.disable',
  'plugin.repair',
]);

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return String(value);
}

export function buildRuntimeToolCommand(name, args = {}) {
  if (!RUNTIME_MCP_TOOLS.includes(name)) throw new Error(`unsupported runtime MCP tool: ${name}`);
  const action = name.split('.')[1];
  const argv = ['node', 'runtime/cli.mjs', 'plugin', action];
  if (action !== 'health' || args.id) argv.push(required(args.id, 'id'));
  if (action === 'install' && args.version) argv[4] = `${argv[4]}@${args.version}`;
  if (action === 'update' && args.version) argv.push(String(args.version));
  if (args.channel) argv.push('--channel', String(args.channel));
  if (args.registry) argv.push('--registry', String(args.registry));
  return {
    tool: name,
    transport: 'local',
    requires_local_runtime: true,
    requires_restart: ['install', 'update', 'rollback', 'enable', 'disable', 'repair'].includes(action),
    argv,
  };
}

export async function executeRuntimeTool(name, args = {}, handlers = {}) {
  const plan = buildRuntimeToolCommand(name, args);
  const handler = handlers[name];
  if (typeof handler !== 'function') return { executed: false, plan };
  return { executed: true, plan, result: await handler(args, plan) };
}
