import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

export interface OAuthCallbackResult {
  code?: string;
  error?: string;
  error_description?: string;
  state?: string;
}

export class OAuthCallbackServer {
  private server?: Server;
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        // Handle favicon requests
        if (req.url === "/favicon.ico") {
          res.writeHead(404);
          res.end();
          return;
        }

        // Parse callback URL
        const url = new URL(req.url || "", `http://localhost:${this.port}`);

        if (url.pathname === "/oauth/callback") {
          this.handleCallback(req, res, url);
        } else {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
              <body>
                <h1>MCPMan OAuth Callback</h1>
                <p>This endpoint is only for OAuth callbacks.</p>
              </body>
            </html>
          `);
        }
      });

      this.server.listen(this.port, () => {
        const callbackUrl = `http://localhost:${this.port}/oauth/callback`;
        resolve(callbackUrl);
      });

      this.server.on("error", (error) => {
        reject(error);
      });
    });
  }

  private handleCallback(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const state = url.searchParams.get("state");

    if (code) {
      console.log(`✅ OAuth authorization successful`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head>
            <title>Authorization Successful</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .success { color: #28a745; }
              .container { max-width: 500px; margin: 0 auto; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="success">✅ Authorization Successful!</h1>
              <p>MCPMan has received the authorization code.</p>
              <p>You can close this window and return to the terminal.</p>
              <script>
                // Auto-close window after 3 seconds
                setTimeout(() => {
                  window.close();
                }, 3000);
              </script>
            </div>
          </body>
        </html>
      `);

      // Store the authorization code for retrieval
      this.authorizationCode = code || undefined;
      this.authorizationState = state || undefined;
    } else if (error) {
      console.error(`❌ OAuth authorization failed: ${error}`);
      if (errorDescription) {
        console.error(`   Description: ${errorDescription}`);
      }

      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head>
            <title>Authorization Failed</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc3545; }
              .container { max-width: 500px; margin: 0 auto; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="error">❌ Authorization Failed</h1>
              <p><strong>Error:</strong> ${error}</p>
              ${errorDescription ? `<p><strong>Description:</strong> ${errorDescription}</p>` : ""}
              <p>Please close this window and check the terminal for instructions.</p>
            </div>
          </body>
        </html>
      `);

      this.authorizationError = error || undefined;
      this.authorizationErrorDescription = errorDescription || undefined;
    } else {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <body>
            <h1>Invalid OAuth Callback</h1>
            <p>No authorization code or error received.</p>
          </body>
        </html>
      `);
    }
  }

  // Storage for authorization results
  private authorizationCode?: string;
  private authorizationState?: string;
  private authorizationError?: string;
  private authorizationErrorDescription?: string;

  async waitForCallback(timeoutMs: number = 300000): Promise<OAuthCallbackResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkResult = () => {
        if (this.authorizationCode) {
          resolve({
            code: this.authorizationCode,
            state: this.authorizationState,
          });
          return;
        }

        if (this.authorizationError) {
          resolve({
            error: this.authorizationError,
            error_description: this.authorizationErrorDescription,
          });
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error("OAuth callback timeout"));
          return;
        }

        // Check again in 100ms
        setTimeout(checkResult, 100);
      };

      checkResult();
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  reset(): void {
    this.authorizationCode = undefined;
    this.authorizationState = undefined;
    this.authorizationError = undefined;
    this.authorizationErrorDescription = undefined;
  }
}
