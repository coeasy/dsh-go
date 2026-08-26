const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const LIFECYCLE = new Set(['install', 'update', 'status', 'health', 'doctor', 'rollback', 'enable', 'disable', 'repair', 'remove']);
const EXECUTION = Object.freeze({
  mcp: new Set(['start', 'stop', 'restart', 'probe', 'logs', 'invoke', 'process-status']),
  skill: new Set(['load', 'unload', 'inspect', 'invoke']),
});

export const RUNTIME_MCP_TOOLS = Object.freeze([
  'package.install', 'package.update', 'package.status', 'package.health', 'package.rollback', 'package.remove',
  'plugin.install', 'plugin.update', 'plugin.status', 'plugin.health', 'plugin.rollback', 'plugin.enable', 'plugin.disable', 'plugin.repair', 'plugin.remove',
  'mcp.install', 'mcp.update', 'mcp.status', 'mcp.health', 'mcp.rollback', 'mcp.enable', 'mcp.disable', 'mcp.repair', 'mcp.remove',
  'mcp.start', 'mcp.stop', 'mcp.restart', 'mcp.process-status', 'mcp.logs', 'mcp.probe', 'mcp.invoke',
  'skill.install', 'skill.update', 'skill.status', 'skill.health', 'skill.rollback', 'skill.enable', 'skill.disable', 'skill.repair', 'skill.remove',
  'skill.load', 'skill.unload', 'skill.inspect', 'skill.invoke',
  'agent.install', 'agent.update', 'agent.status', 'agent.health', 'agent.rollback', 'agent.enable', 'agent.disable', 'agent.repair', 'agent.remove',
]);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
  return String(value);
}

export function buildRuntimeToolCommand(name, args = {}) {
  if (!RUNTIME_MCP_TOOLS.includes(name)) throw new Error(`unsupported runtime MCP tool: ${name}`);
  const [namespace, action] = name.split('.');
  const type = namespace === 'package' ? String(args.type || 'plugin').toLowerCase() : namespace;
  if (!PACKAGE_TYPES.has(type)) throw new Error(`unsupported runtime package type: ${type}`);
  if (!LIFECYCLE.has(action) && !EXECUTION[type]?.has(action)) throw new Error(`unsupported ${type} action: ${action}`);

  const argv = ['node', 'bin/dsh.mjs', type, action];
  const needsId = !['health', 'doctor'].includes(action) || args.id;
  if (needsId) {
    const id = required(args.id, 'id');
    argv.push(action === 'install' && args.version ? `${id}@${args.version}` : id);
  }
  if (action === 'update' && args.version) argv.push(String(args.version));
  if (action === 'invoke' && type === 'mcp') argv.push(required(args.tool, 'tool'));
  if (action === 'invoke' && args.input !== undefined) argv.push('--input', JSON.stringify(args.input));
  if (args.channel) argv.push('--channel', String(args.channel));
  if (args.registry) argv.push('--registry', String(args.registry));
  if (args.cascade) argv.push('--cascade');
  if (args.approved) argv.push('--yes');
  if (args.dry_run) argv.push('--dry-run');

  return {
    tool: name,
    type,
    action,
    transport: 'local',
    requires_local_runtime: true,
    requires_approval: ['install', 'update', 'rollback', 'enable', 'disable', 'repair', 'remove', 'start', 'stop', 'restart', 'load', 'unload', 'invoke'].includes(action),
    requires_restart: ['install', 'update', 'rollback', 'enable', 'disable', 'repair', 'remove'].includes(action),
    argv,
  };
}

export async function executeRuntimeTool(name, args = {}, handlers = {}) {
  const plan = buildRuntimeToolCommand(name, args);
  const handler = handlers[name] || handlers[`${plan.type}.${plan.action}`] || handlers[plan.action];
  if (typeof handler !== 'function') return { executed: false, plan };
  return { executed: true, plan, result: await handler(args, plan) };
}
