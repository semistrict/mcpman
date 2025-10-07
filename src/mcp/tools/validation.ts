import ts from "typescript";

/**
 * Validate JavaScript code with TypeScript compiler
 * @param code - The code to validate (must be a function expression)
 * @param typeDefinitions - TypeScript type definitions to include in compilation
 * @returns Validation result with errors if invalid
 */
export function validateTypeScript(
  code: string,
  typeDefinitions: string
): { valid: boolean; errors?: string } {
  // Prepare the full code with type definitions
  const fullCode = `${typeDefinitions}\n\nconst generatedFunction = ${code};\n`;

  // Create a virtual source file and compile it
  const compilerOptions: any = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    lib: ["lib.es2020.d.ts"],
    noEmit: true,
    strict: false,
    skipLibCheck: true,
  };

  // Create a program with the virtual file
  const sourceFile = ts.createSourceFile("generated.ts", fullCode, ts.ScriptTarget.ES2020, true);

  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion) => {
    if (fileName === "generated.ts") {
      return sourceFile;
    }
    return originalGetSourceFile(fileName, languageVersion);
  };

  const program = ts.createProgram(["generated.ts"], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length > 0) {
    // Compilation failed, format errors
    const errorMessages = diagnostics
      .map((diagnostic) => {
        if (diagnostic.file) {
          const { line, character } = ts.getLineAndCharacterOfPosition(
            diagnostic.file,
            diagnostic.start!
          );
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
          return `Line ${line + 1}, Column ${character + 1}: ${message}`;
        }
        return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      })
      .join("\n");

    return { valid: false, errors: errorMessages };
  }

  return { valid: true };
}
