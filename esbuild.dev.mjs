import esbuild from "esbuild";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

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
	"responsive.css",
];

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
					// skip missing
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

const context = await esbuild.context({
	entryPoints: ["dev/preview.ts"],
	bundle: true,
	format: "iife",
	target: "es2020",
	logLevel: "info",
	sourcemap: "inline",
	outfile: "dev/dist/preview.js",
	alias: {
		obsidian: "./dev/mock-obsidian.ts",
	},
	plugins: [concatCssPlugin],
});

const { host, port } = await context.serve({
	servedir: ".",
	port: 3000,
});

console.log(`Preview server running at http://localhost:${port}/dev/index.html`);
await context.watch();
