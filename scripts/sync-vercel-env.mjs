#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const envFile = process.argv[2] ?? '.env';
const targetArg = process.argv[3] ?? 'production,preview';
const targets = targetArg
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

if (!fs.existsSync(envFile)) {
  console.error(`[sync-vercel-env] env file not found: ${envFile}`);
  process.exit(1);
}
if (targets.length === 0) {
  console.error('[sync-vercel-env] target list is empty');
  process.exit(1);
}

function runVercel(args) {
  try {
    return execFileSync('pnpm', ['-s', 'dlx', 'vercel', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    const stdout = error?.stdout?.toString?.() ?? '';
    console.error(`[sync-vercel-env] command failed: pnpm -s dlx vercel ${args.join(' ')}`);
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
    process.exit(1);
  }
}

function parseEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    const value = line.slice(eq + 1);
    if (!key) continue;
    rows.push({ key, value });
  }
  return rows;
}

function getProjectId() {
  if (process.env.VERCEL_PROJECT_ID) return process.env.VERCEL_PROJECT_ID;
  const projectPath = path.resolve('.vercel/project.json');
  if (!fs.existsSync(projectPath)) {
    console.error(
      '[sync-vercel-env] .vercel/project.json not found. Run "pnpm -s dlx vercel link" first.'
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  if (!data.projectId) {
    console.error('[sync-vercel-env] projectId missing in .vercel/project.json');
    process.exit(1);
  }
  return data.projectId;
}

const projectId = getProjectId();
const envRows = parseEnvFile(envFile);

if (envRows.length === 0) {
  console.error(`[sync-vercel-env] no variables found in ${envFile}`);
  process.exit(1);
}

console.log(`[sync-vercel-env] project=${projectId}`);
console.log(`[sync-vercel-env] file=${envFile}, vars=${envRows.length}, targets=${targets.join(',')}`);

const existingRaw = runVercel(['api', `/v10/projects/${projectId}/env`, '--raw']);
const existingJson = JSON.parse(existingRaw);
const existing = Array.isArray(existingJson.envs) ? existingJson.envs : [];

const existingByKey = new Map();
for (const item of existing) {
  if (!existingByKey.has(item.key)) existingByKey.set(item.key, []);
  existingByKey.get(item.key).push(item);
}

for (const { key, value } of envRows) {
  const oldItems = existingByKey.get(key) ?? [];
  for (const oldItem of oldItems) {
    process.stdout.write(`[sync-vercel-env] delete ${key} (${oldItem.id}) ... `);
    runVercel([
      'api',
      `/v9/projects/${projectId}/env/${oldItem.id}`,
      '-X',
      'DELETE',
      '--dangerously-skip-permissions',
      '--raw',
    ]);
    console.log('ok');
  }

  const payloadPath = path.join(
    os.tmpdir(),
    `vercel-env-${key.replace(/[^A-Za-z0-9_]/g, '_')}-${Date.now()}.json`
  );
  fs.writeFileSync(
    payloadPath,
    JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: targets,
    })
  );

  process.stdout.write(`[sync-vercel-env] create ${key} -> ${targets.join(',')} ... `);
  runVercel(['api', `/v10/projects/${projectId}/env`, '-X', 'POST', '--input', payloadPath, '--raw']);
  fs.rmSync(payloadPath, { force: true });
  console.log('ok');
}

console.log('[sync-vercel-env] done');
