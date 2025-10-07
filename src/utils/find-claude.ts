import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRACE } from "./logging.js";

const execFilePromise = promisify(execFile);

/**
 * Find Claude Code executable path
 */
export async function findClaudeExecutable(): Promise<string | undefined> {
  try {
    // Try to find claude in PATH

    // Run which in user's default shell
    const { stdout } = await execFilePromise("which", ["claude"]);
    const whichPath = stdout.trim();

    if (!whichPath) {
      return undefined;
    }

    // Try to resolve symlinks using readlink
    try {
      const { stdout: resolvedPath } = await execFilePromise("readlink", ["-f", whichPath]);
      return resolvedPath.trim();
    } catch {
      // readlink failed, try realpath
      try {
        const { stdout: resolvedPath } = await execFilePromise("realpath", [whichPath]);
        return resolvedPath.trim();
      } catch {
        // Both failed, return the which path
        return whichPath;
      }
    }
  } catch (error) {
    TRACE("Failed to find claude executable:", error);
    return undefined;
  }
}
