/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Copies production plugin artifacts into a local Obsidian plugin folder
 * Created: 2026-03-07
 * Last Modified: 2026-05-16
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync, cpSync } from 'fs';
import { join, relative, resolve } from 'path';

/** Local file containing the absolute destination plugin directory. */
const TARGET_FILE = '.deploy-target';
/** Built plugin files that Obsidian loads directly. */
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json'];
/** Dependency directory copied only when production runtime dependencies exist. */
const RUNTIME_DEP_ROOT = 'node_modules';

/** Enumerates production dependency directories without copying dev-only packages. */
const runtimeDependencyDirectories = () => {
	try {
		const output = execFileSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const root = resolve('.');
		return output
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && line !== root)
			.map((line) => resolve(line))
			.filter((line) => relative(root, line).startsWith(`${RUNTIME_DEP_ROOT}/`));
	} catch (error) {
		console.warn(`  WARN could not enumerate runtime dependencies: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
};

if (!existsSync(TARGET_FILE)) {
	console.error(`Missing ${TARGET_FILE}. Create it with the absolute path to your vault plugin folder:`);
	console.error(`  echo "/path/to/vault/.obsidian/plugins/vaultboard" > ${TARGET_FILE}`);
	process.exit(1);
}

const target = readFileSync(TARGET_FILE, 'utf-8').trim();
if (!target) {
	console.error(`${TARGET_FILE} is empty.`);
	process.exit(1);
}

const destinationDirectory = resolve(target);
if (!existsSync(destinationDirectory)) {
	mkdirSync(destinationDirectory, { recursive: true });
	console.log(`Created ${destinationDirectory}`);
}

for (const file of ARTIFACTS) {
	if (!existsSync(file)) {
		console.warn(`  SKIP ${file} (not found -- run build first)`);
		continue;
	}
	copyFileSync(file, join(destinationDirectory, file));
	console.log(`  COPY ${file} -> ${join(destinationDirectory, file)}`);
}

for (const sourceDirectory of runtimeDependencyDirectories()) {
	const relativeDirectory = relative(resolve('.'), sourceDirectory);
	const targetDirectory = join(destinationDirectory, relativeDirectory);
	mkdirSync(join(targetDirectory, '..'), { recursive: true });
	cpSync(sourceDirectory, targetDirectory, { recursive: true, force: true });
	console.log(`  COPY ${relativeDirectory} -> ${targetDirectory}`);
}

console.log('Deploy complete. data.json was not touched.');
