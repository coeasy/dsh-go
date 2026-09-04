#!/usr/bin/env node
import { runDsh } from '../runtime/dsh.mjs';

runDsh(process.argv.slice(2)).catch((error) => {
  console.error(`[dsh] ${error.code ? `${error.code}: ` : ''}${error.message}`);
  if (process.env.DSH_DEBUG === '1' && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
