import { registerHooks } from "node:module";

const host = new URL("./pi-host.mjs", import.meta.url).href;
const tui = new URL("./pi-tui.mjs", import.meta.url).href;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-coding-agent") return { url: host, shortCircuit: true };
		if (specifier === "@earendil-works/pi-tui") return { url: tui, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
