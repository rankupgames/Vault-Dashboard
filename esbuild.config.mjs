/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Bundles the Obsidian plugin entry point and concatenates scoped CSS
 * Created: 2026-03-07
 * Last Modified: 2026-05-16
 */

import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

/** True when building release artifacts without inline source maps. */
const prod = process.argv[2] === "production";

/** CSS files concatenated in dependency order before appending any extras. */
const CSS_ORDER = [
	"root.css",
	"timer.css",
	"heatmap.css",
	"tasks.css",
	"git-tree.css",
	"subtasks.css",
	"modules.css",
	"reports.css",
	"documents.css",
	"modal.css",
	"drag-drop.css",
	"tooltip.css",
	"board.css",
	"responsive.css",
];

/** Esbuild plugin that writes Obsidian's single styles.css artifact. */
const concatCssPlugin = {
	name: "concat-css",
	setup(build) {
		build.onEnd(async () => {
			const stylesDir = join("src", "styles");
			const parts = [];

			for (const file of CSS_ORDER) {
				try {
					const content = await readFile(join(stylesDir, file), "utf-8");
					parts.push(content);
				} catch {
					console.warn(`concat-css: missing ${file}, skipping`);
				}
			}

			const extra = (await readdir(stylesDir))
				.filter((f) => f.endsWith(".css") && !CSS_ORDER.includes(f))
				.sort();

			for (const file of extra) {
				const content = await readFile(join(stylesDir, file), "utf-8");
				parts.push(content);
			}

			await writeFile("styles.css", parts.join("\n"), "utf-8");
		});
	},
};

/** Shared esbuild options for watch and production builds. */
const buildOptions = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@electron/remote",
		"@cursor/sdk",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	plugins: [concatCssPlugin],
};

if (prod) {
	await esbuild.build(buildOptions);
} else {
	const context = await esbuild.context(buildOptions);
	await context.watch();
}
