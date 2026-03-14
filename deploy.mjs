import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';

const TARGET_FILE = '.deploy-target';
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json'];

if (!existsSync(TARGET_FILE)) {
	console.error(`Missing ${TARGET_FILE}. Create it with the absolute path to your vault plugin folder:`);
	console.error(`  echo "/path/to/vault/.obsidian/plugins/vault-dashboard" > ${TARGET_FILE}`);
	process.exit(1);
}

const target = readFileSync(TARGET_FILE, 'utf-8').trim();
if (!target) {
	console.error(`${TARGET_FILE} is empty.`);
	process.exit(1);
}

const dest = resolve(target);
if (!existsSync(dest)) {
	mkdirSync(dest, { recursive: true });
	console.log(`Created ${dest}`);
}

for (const file of ARTIFACTS) {
	if (!existsSync(file)) {
		console.warn(`  SKIP ${file} (not found -- run build first)`);
		continue;
	}
	copyFileSync(file, join(dest, file));
	console.log(`  COPY ${file} -> ${join(dest, file)}`);
}

console.log('Deploy complete. data.json was not touched.');
