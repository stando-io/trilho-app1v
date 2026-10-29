import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSION_LEAVES } from '../src/services/permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(here, '..', 'src', 'routes');
const appPermissionsFile = path.join(here, '..', '..', 'app', 'src', 'permissions.ts');
const settingsPageFile = path.join(here, '..', '..', 'app', 'src', 'pages', 'Settings.tsx');

const SETTINGS_ROUTERS = ['profiles.ts', 'roles.ts', 'users.ts', 'settings.ts', 'apiKeys.ts'];

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function routeFiles(): string[] {
  return readdirSync(routesDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join(routesDir, file));
}

interface Mutation {
  file: string;
  method: string;
  routePath: string;
  chunk: string;
}

function mutationsOf(file: string): Mutation[] {
  const source = read(file);
  const found: Mutation[] = [];
  const pattern = /router\.(post|put|patch|delete)\(([^]*?)async/g;
  for (const match of source.matchAll(pattern)) {
    const method = match[1] ?? '';
    const chunk = match[2] ?? '';
    const pathMatch = chunk.match(/'([^']*)'/);
    found.push({
      file: path.basename(file),
      method: method.toUpperCase(),
      routePath: pathMatch?.[1] ?? '?',
      chunk,
    });
  }
  return found;
}

describe('Guard: toda funcionalidade de Configuracoes tem regra de niveis de acesso', () => {
  it('toda mutacao dos routers de Configuracoes declara requirePermission', () => {
    const offenders = SETTINGS_ROUTERS.flatMap((file) =>
      mutationsOf(path.join(routesDir, file)),
    ).filter((mutation) => !mutation.chunk.includes('requirePermission('));

    expect(
      offenders.map((item) => `${item.file} ${item.method} ${item.routePath}`),
    ).toEqual([]);
  });

  it('todo leaf settings.* de PERMISSION_LEAVES e usado em alguma rota', () => {
    const sources = routeFiles()
      .map((file) => read(file))
      .join('\n');
    const used = new Set<string>();
    for (const match of sources.matchAll(/requirePermission\(([^)]*)\)/g)) {
      for (const quote of (match[1] ?? '').matchAll(/'([^']+)'/g)) {
        used.add(quote[1] ?? '');
      }
    }

    const unusedSettingsLeaves = PERMISSION_LEAVES.filter(
      (leaf) => leaf.startsWith('settings.') && !used.has(leaf),
    );
    expect(unusedSettingsLeaves).toEqual([]);
  });

  it('PERMISSION_TREE do app e PERMISSION_LEAVES do server estao em paridade', () => {
    const appSource = read(appPermissionsFile);
    const appKeys = new Set(
      [...appSource.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)].map((match) => match[1] ?? ''),
    );
    const serverKeys = new Set<string>(PERMISSION_LEAVES);

    const serverOnly = [...serverKeys].filter((key) => !appKeys.has(key));
    const appOnly = [...appKeys].filter((key) => !serverKeys.has(key));

    expect(serverOnly).toEqual([]);
    expect(appOnly).toEqual([]);
  });

  it('toda secao de ALL_SECTIONS tem entrada em SECTION_PERMISSIONS', () => {
    const settingsSource = read(settingsPageFile);

    const sectionPermissions = settingsSource.match(
      /const SECTION_PERMISSIONS[^=]*=\s*\{([^}]*?)\};/s,
    );
    expect(sectionPermissions).not.toBeNull();
    const mapped = new Set(
      [...(sectionPermissions?.[1] ?? '').matchAll(/(\w+):\s*\[/g)].map(
        (match) => match[1] ?? '',
      ),
    );

    const allSections = settingsSource.match(/const ALL_SECTIONS[^=]*=\s*\[([\s\S]*?)\];/);
    expect(allSections).not.toBeNull();
    const sections = [...(allSections?.[1] ?? '').matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(sections.length).toBeGreaterThan(0);

    const unmapped = sections.filter((section) => !mapped.has(section));
    expect(unmapped).toEqual([]);
  });
});
