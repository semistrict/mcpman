import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { ToolManager } from "../tool-manager.js";
import { TRACE } from "../../utils/logging.js";
import { findClaudeExecutable } from "../../utils/find-claude.js";
import { formatResultOutput } from "./eval.js";
import { validateTypeScript } from "./validation.js";

/**
 * Generate code using Agent SDK
 */
export async function generateCodeWithAgentSDK(
  functionDescription: string,
  typeDefinitions: string
): Promise<string> {
  // Validate type definitions before attempting code generation
  TRACE("Validating type definitions before code generation");
  const typeValidation = validateTypeScript("async () => { return 42; }", typeDefinitions);
  if (!typeValidation.valid) {
    throw new Error(
      `\n${"=".repeat(80)}\n` +
        `CRITICAL ERROR: Type definitions contain TypeScript errors!\n` +
        `${"=".repeat(80)}\n\n` +
        `The generated type definitions are invalid and cannot be used for code generation.\n` +
        `This is a bug in the type generation system, not the LLM.\n\n` +
        `TypeScript errors in type definitions:\n${typeValidation.errors}\n\n` +
        `Type definitions:\n${typeDefinitions}\n` +
        `${"=".repeat(80)}\n`
    );
  }

  // Check for test mode - read from file if directory is set
  if (process.env.MCPMAN_TEST_LLM_RESPONSE_DIR) {
    const crypto = await import("node:crypto");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Compute SHA1 of function description
    const hash = crypto.createHash("sha1").update(functionDescription).digest("hex");
    const responseFile = path.join(
      process.env.MCPMAN_TEST_LLM_RESPONSE_DIR,
      `response-${hash}.txt`
    );

    try {
      const response = await fs.readFile(responseFile, "utf-8");
      if (response.trim()) {
        TRACE(`Using test LLM response from ${responseFile}`);
        return response;
      }
    } catch {
      // Fail loudly with the hash for easy test writing
      throw new Error(
        `Test LLM response file not found.\n` +
          `Function description: ${functionDescription}\n` +
          `Expected file: ${responseFile}\n` +
          `SHA1: ${hash}\n` +
          `Create the file with: echo "your code here" > "${responseFile}"`
      );
    }
  }

  TRACE("Using Agent SDK to generate code");

  // Find Claude Code executable
  const claudePath = await findClaudeExecutable();
  if (!claudePath) {
    throw new Error(
      "Claude Code executable not found. Please ensure Claude Code CLI is installed and in PATH."
    );
  }

  TRACE(`Found Claude Code executable at: ${claudePath}`);

  // Variable to capture the generated code and track retries
  let generatedCode: string | null = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  // Create an SDK MCP server with a single tool to receive the generated code
  const codeServer = createSdkMcpServer({
    name: "code-generator",
    version: "1.0.0",
    tools: [
      tool(
        "set_code",
        "Set the generated code. Call this tool with the complete JavaScript code. The code will be validated with TypeScript compiler.",
        {
          code: z.string().describe("The complete JavaScript code as a string"),
        },
        async (args) => {
          // Validate the code by compiling with TypeScript
          const validation = validateTypeScript(args.code, typeDefinitions);

          if (!validation.valid) {
            retryCount++;
            console.error(
              `\n[Code Generation] Validation failed (attempt ${retryCount}/${MAX_RETRIES})`
            );
            console.error(`[Code Generation] Generated code:\n${args.code}`);
            console.error(`[Code Generation] TypeScript errors:\n${validation.errors}\n`);

            if (retryCount >= MAX_RETRIES) {
              throw new Error(
                `Code generation failed after ${MAX_RETRIES} attempts.\n\n` +
                  `Last generated code:\n${args.code}\n\n` +
                  `TypeScript errors:\n${validation.errors}`
              );
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `TypeScript compilation failed (attempt ${retryCount}/${MAX_RETRIES}). Please fix the errors and call set_code again with corrected code.\n\nCompilation errors:\n${validation.errors}`,
                },
              ],
              isError: true,
            };
          }

          // Compilation succeeded, accept the code
          if (retryCount > 0) {
            console.log(
              `[Code Generation] Code validated successfully after ${retryCount} retries`
            );
          }
          generatedCode = args.code;
          return {
            content: [{ type: "text" as const, text: "Code validated and accepted successfully." }],
          };
        }
      ),
    ],
  });

  const prompt = `You are a code generating machine that generates executable JavaScript code.

AVAILABLE TOOLS AND FUNCTIONS:
The generated code will have access to these MCP tools and utility functions:

${typeDefinitions}

REQUIRED OUTPUT FORMAT:
You MUST generate an async function expression in this exact format:
async () => { /* your code here */ }

REQUIREMENTS:
1. Return a complete async function expression (NOT a function declaration)
2. The function takes NO parameters - it must be: async () => { ... }
3. Use the available MCP tools (listed above) to accomplish the task
4. Return a value from the function using the return statement
5. The code should be executable JavaScript - no markdown, no comments outside the function

EXAMPLES:
- Simple value: async () => { return 42; }
- Using MCP tools: async () => { const servers = listServers(); return servers.length; }
- Async operations: async () => { const files = await filesystem.list_directory({ path: "." }); return files.length > 0; }

CRITICAL: You MUST call the set_code tool EXACTLY ONCE with the complete JavaScript code as a string. Pass ONLY the raw JavaScript code - no markdown code blocks, no formatting, no explanations.

USER REQUEST: ${functionDescription}

Generate the async function expression now and call set_code with it.`;

  // Run the query with the code generator server
  for await (const message of query({
    prompt,
    options: {
      model: "haiku",
      permissionMode: "bypassPermissions",
      allowedTools: ["set_code"],
      pathToClaudeCodeExecutable: claudePath,
      mcpServers: {
        "code-generator": codeServer,
      },
    },
  })) {
    // Exit immediately once set_code has been called
    if (generatedCode !== null) {
      break;
    }
    // Also break on result
    if (message.type === "result") {
      break;
    }
  }

  if (!generatedCode) {
    throw new Error("Agent did not generate code or call set_code tool");
  }

  return generatedCode;
}

/**
 * Code generator abstraction - tries MCP sampling first, falls back to Agent SDK
 */
class CodeGenerator {
  constructor(
    private mcpServer: McpServer,
    private toolManager: ToolManager
  ) {}

  /**
   * Check if client supports sampling
   */
  private clientSupportsSampling(): boolean {
    const capabilities = this.mcpServer.server.getClientCapabilities();
    // Only return true if sampling capability is explicitly present
    return Boolean(capabilities?.sampling);
  }

  /**
   * Generate code using MCP sampling
   */
  private async generateWithSampling(
    functionDescription: string,
    typeDefinitions: string
  ): Promise<string> {
    TRACE("Using MCP sampling to generate code");

    const response = await this.mcpServer.server.createMessage({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are a code generating machine that generates executable JavaScript code.

AVAILABLE TOOLS AND FUNCTIONS:
The generated code will have access to these MCP tools and utility functions:

${typeDefinitions}

REQUIRED OUTPUT FORMAT:
You MUST generate an async function expression in this exact format:
async () => { /* your code here */ }

REQUIREMENTS:
1. Return a complete async function expression (NOT a function declaration)
2. The function takes NO parameters - it must be: async () => { ... }
3. Use the available MCP tools (listed above) to accomplish the task
4. Return a value from the function using the return statement
5. The code should be executable JavaScript - no markdown, no comments outside the function

EXAMPLES:
- Simple value: async () => { return 42; }
- Using MCP tools: async () => { const servers = listServers(); return servers.length; }
- Async operations: async () => { const files = await filesystem.list_directory({ path: "." }); return files.length > 0; }

IMPORTANT: Respond ONLY with the JavaScript code. No markdown code blocks, no explanations, no formatting - just the raw async function expression.

USER REQUEST: ${functionDescription}`,
          },
        },
      ],
      maxTokens: 2000,
    });

    // Extract text from response
    if (response.content.type === "text") {
      return this.extractCode(response.content.text);
    }

    throw new Error("Sampling returned non-text response");
  }

  /**
   * Extract code from markdown code blocks if present
   */
  private extractCode(text: string): string {
    // Remove markdown code blocks if present
    const codeBlockMatch = text.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }
    return text.trim();
  }

  /**
   * Generate code using best available method
   */
  async generate(functionDescription: string, servers?: string[]): Promise<string> {
    const typeDefinitions = await this.toolManager.getTypeDefinitions(servers);

    // Only try MCP sampling if client explicitly supports it
    if (this.clientSupportsSampling()) {
      TRACE("Client supports sampling, using MCP sampling");
      try {
        return await this.generateWithSampling(functionDescription, typeDefinitions);
      } catch (error) {
        console.error("MCP sampling failed, falling back to Agent SDK:", error);
        // Fall through to Agent SDK
      }
    } else {
      TRACE("Client does not support sampling, using Agent SDK");
    }

    // Use Agent SDK as fallback
    return await generateCodeWithAgentSDK(functionDescription, typeDefinitions);
  }
}

export function registerCodeTool(
  mcpServer: McpServer,
  toolManager: ToolManager,
  initializedMcpServer: Promise<McpServer>
) {
  TRACE("Registering code tool");

  const codeGenerator = new CodeGenerator(mcpServer, toolManager);

  mcpServer.registerTool(
    "code",
    {
      title: "Code Generator and Executor",
      description:
        "Generate and execute JavaScript code to achieve a goal using available MCP tools. Code is generated by an LLM and executed with access to all MCP tools. Results are stored in $results array.",
      inputSchema: {
        functionDescription: z
          .string()
          .describe(
            "Natural language description of what the code should do. The LLM will generate code to achieve this goal."
          ),
        servers: z
          .array(z.string())
          .optional()
          .describe(
            "List of MCP server names that the generated code can access. Only tools from these servers will be available. STRONGLY RECOMMENDED: Always specify this to limit the subagent's context and improve code generation quality. If not provided, all servers are available which may result in poor performance and excessive token usage."
          ),
      },
    },
    async ({ functionDescription, servers }) => {
      await initializedMcpServer; // Wait for upstream servers to be connected

      try {
        // Generate code using best available method
        const code = await codeGenerator.generate(functionDescription, servers);

        console.log("Generated code:", code);

        // Execute the generated code using ToolManager
        const result = await toolManager.executeCode(code, {});

        // Combine result and output for storage in $results
        let combinedResult: unknown;
        if (result.output) {
          // If there's output, combine it with the result
          if (typeof result.result === "string") {
            combinedResult = `${result.result}\n${result.output}`;
          } else if (typeof result.result === "object" && result.result !== null) {
            combinedResult = `${JSON.stringify(result.result)}\n${result.output}`;
          } else {
            combinedResult = `${String(result.result)}\n${result.output}`;
          }
        } else {
          combinedResult = result.result;
        }

        // Store combined result in $results using ToolManager
        const resultsIndex = await toolManager.appendResult(combinedResult);

        // Format output with $results pointer
        const formattedOutput = formatResultOutput(resultsIndex, "code", combinedResult);
        const codeOutput = `\n// Generated code:\n${code}\n\n// Execution result:\n${formattedOutput}`;

        return {
          content: [
            {
              type: "text" as const,
              text: codeOutput,
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
