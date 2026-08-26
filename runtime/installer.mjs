import { access, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPackageType, safePackageId } from './package-model.mjs';
import { packageRoot, pluginRoot } from './registry.mjs';
import { verifyInstalledCommit, verifyResolvedPackage } from './verifier.mjs';

const exec = promisify(execFile);

export function defaultPluginHome() {
  return pluginRoot();
}

export function defaultPackageHome(type) {
  return packageRoot(assertPackageType(type));
}

async function git(args, cwd) {
  return exec('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

export async function installPackage(pkg, options = {}) {
  const type = assertPackageType(pkg?.type || 'plugin');
  const verification = verifyResolvedPackage({ ...pkg, type });
  if (!verification.ok) throw new Error('runtime package verification failed: ' + verification.errors.join('; '));

  const root = resolve(options.root || defaultPackageHome(type));
  const target = join(root, safePackageId(pkg.id));
  const backup = target + '.backup';
  const plan = {
    id: pkg.id,
    type,
    version: pkg.version,
    channel: pkg.channel || 'stable',
    repo: pkg.repo,
    commit: pkg.commit,
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
    await git(['remote', 'add', 'origin', options.repositoryUrl || 'https://github.com/' + pkg.repo + '.git'], temp);
    await git(['fetch', '--depth', '1', 'origin', pkg.commit], temp);
    await git(['checkout', '--detach', '-q', 'FETCH_HEAD'], temp);
    await verifyInstalledCommit(temp, pkg.commit);

    const lock = {
      registry_version: 3,
      runtime_registry_version: 3,
      id: pkg.id,
      type,
      package_type: type,
      version: pkg.version,
      channel: pkg.channel || 'stable',
      source: pkg.source,
      artifact: pkg.artifact,
      runtime: pkg.runtime,
      capabilities: pkg.capabilities || [],
      dependencies: pkg.dependencies || [],
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
        throw new Error(`runtime package already installed: ${type}:${pkg.id} (use --force to replace)`);
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

export async function installPlugin(plugin, options = {}) {
  return installPackage({ ...plugin, type: 'plugin' }, options);
}
