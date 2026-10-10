import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", reject);
		child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
	});
}

test("packed renderer starts from a node_modules installation", { timeout: 30_000 }, async () => {
	const temp = await mkdtemp(path.join(os.tmpdir(), "pi-work-outline-pack-"));
	let renderer;
	try {
		const packed = await run("npm", ["pack", "--silent", "--pack-destination", temp], { cwd: packageRoot });
		assert.equal(packed.code, 0, packed.stderr);
		const tarball = packed.stdout.trim().split(/\r?\n/).at(-1);
		const installRoot = path.join(temp, "node_modules", "pi-work-outline");
		await mkdir(installRoot, { recursive: true });
		const extract = await run("tar", ["-xzf", path.join(temp, tarball), "--strip-components=1", "-C", installRoot]);
		assert.equal(extract.code, 0, extract.stderr);

		const outlinePath = path.join(temp, "outline.md");
		await writeFile(outlinePath, "# GOAL\n\n- Packed install\n\n# WORK\n\n- HUMAN PACKED_RENDERER_OK\n", "utf8");
		const rendererPath = path.join(temp, "node_modules", "pi-work-outline", "bin", "tmux-renderer.mjs");
		renderer = spawn(process.execPath, [rendererPath, outlinePath], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, FORCE_COLOR: "1" },
		});
		let stdout = "";
		let stderr = "";
		renderer.stdout.on("data", (chunk) => { stdout += chunk; });
		renderer.stderr.on("data", (chunk) => { stderr += chunk; });
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.match(stdout, /PACKED_RENDERER_OK/, stderr);
		assert.match(stdout, /\u001b\[5m/, "HUMAN badge should request terminal-native blink");
		assert.match(stdout, /\u001b\[101m/, "HUMAN badge should use a bright background");
	} finally {
		renderer?.kill("SIGTERM");
		await rm(temp, { recursive: true, force: true });
	}
});
