import path from "node:path";

let agentDir;
export const mutationPaths = [];
export function setAgentDir(value) { agentDir = value; }
export function getAgentDir() { return agentDir; }
export async function withFileMutationQueue(filePath, operation) {
	mutationPaths.push(path.resolve(filePath));
	return await operation();
}
