import { access, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyInstalledCommit, verifyResolvedPlugin } from './verifier.mjs';

const exec = promisify(execFile);

export function defaultPluginHome() {
  return process.env.DSH_PLUGIN_HOME || join(homedir(), '.dsh', 'plugins');
}

function safeId(id) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('unsafe plugin id: ' + id);
  return id;
}

async function git(args, cwd) {
  return exec('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

export async function installPlugin(plugin, options = {}) {
  const verification = verifyResolvedPlugin(plugin);
  if (!verification.ok) throw new Error('plugin verification failed: ' + verification.errors.join('; '));

  const root = resolve(options.root || defaultPluginHome());
  const target = join(root, safeId(plugin.id));
  const backup = target + '.backup';
  const plan = {
    id: plugin.id,
    version: plugin.version,
    channel: plugin.channel || 'stable',
    repo: plugin.repo,
    commit: plugin.commit,
    target,
    backup,
    restart_required: true,
  };
  if (options.dryRun) return plan;

  await mkdir(root, { recursive: true });
  const temp = target + '.tmp-' + process.pid + '-' + Date.now();
  await rm(temp, { recursive: true, force: true });

  try {
    await mkdir(temp, { recursive: true });
    await git(['init', '-q'], temp);
    await git(['remote', 'add', 'origin', options.repositoryUrl || 'https://github.com/' + plugin.repo + '.git'], temp);
    await git(['fetch', '--depth', '1', 'origin', plugin.commit], temp);
    await git(['checkout', '--detach', '-q', 'FETCH_HEAD'], temp);
    await verifyInstalledCommit(temp, plugin.commit);

    const lock = {
      registry_version: 3,
      runtime_registry_version: 2,
      id: plugin.id,
      version: plugin.version,
      channel: plugin.channel || 'stable',
      source: plugin.source,
      artifact: plugin.artifact,
      runtime: plugin.runtime,
      capabilities: plugin.capabilities,
      dependencies: plugin.dependencies || [],
      installed_at: new Date().toISOString(),
      restart_required: true,
    };
    await writeFile(join(temp, '.dsh-install.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8');

    if (options.force) {
      await rm(backup, { recursive: true, force: true });
      try {
        await rename(target, backup);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    } else {
      try {
        await access(target);
        throw new Error('plugin already installed: ' + target + ' (use --force to replace)');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    await mkdir(dirname(target), { recursive: true });
    await rename(temp, target);
    return { ...plan, backup: options.force ? backup : undefined };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    try {
      await access(backup);
      await rm(target, { recursive: true, force: true });
      await rename(backup, target);
    } catch {
      // No previous installation to restore.
    }
    throw error;
  }
}
