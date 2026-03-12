import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../../..');

function readPkg(pkgPath) {
    return JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'));
}

function getPackageDirs(category) {
    const dir = join(ROOT, 'packages', category);
    return readdirSync(dir)
        .map(name => join(dir, name))
        .filter(p => statSync(p).isDirectory());
}

// ─── Rule 1: @bark/core has no external dependencies ───────────────────────

describe('@bark/core has no external dependencies', () => {
    it('has no dependencies field or empty dependencies', () => {
        const pkg = readPkg(join(ROOT, 'packages', 'core'));
        const deps = Object.keys(pkg.dependencies || {});
        expect(deps).toEqual([]);
    });
});

// ─── Rule 2: Adapters and drivers only depend on @bark/core ────────────────

const BARK_SCOPE = /^@bark\//;

function getAllowedExternalDeps(pkgName) {
    // Platform-specific libs are allowed per package
    const ALLOWED = {
        '@bark/adapter-whatsapp': ['qrcode', 'qrcode-terminal', 'whatsapp-web.js'],
    };
    return ALLOWED[pkgName] || [];
}

describe('adapters only depend on @bark/core (+ allowed platform libs)', () => {
    for (const dir of getPackageDirs('adapters')) {
        const pkg = readPkg(dir);
        it(pkg.name, () => {
            const allowed = getAllowedExternalDeps(pkg.name);
            const deps = Object.keys(pkg.dependencies || {});
            for (const dep of deps) {
                const isBark = BARK_SCOPE.test(dep);
                const isAllowed = allowed.includes(dep);
                expect(
                    isBark || isAllowed,
                    `${pkg.name} has unexpected dependency: "${dep}"`
                ).toBe(true);
            }
        });
    }
});

describe('drivers only depend on @bark/core (+ allowed platform libs)', () => {
    for (const dir of getPackageDirs('drivers')) {
        const pkg = readPkg(dir);
        if (pkg.private) continue; // skip qa harness

        it(pkg.name, () => {
            const allowed = getAllowedExternalDeps(pkg.name);
            const deps = Object.keys(pkg.dependencies || {});
            for (const dep of deps) {
                const isBark = BARK_SCOPE.test(dep);
                const isAllowed = allowed.includes(dep);
                expect(
                    isBark || isAllowed,
                    `${pkg.name} has unexpected dependency: "${dep}"`
                ).toBe(true);
            }
        });
    }
});
