import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { HttpServerConfig } from "../config/schema.js";
import { TokenStorage } from "./token-storage.js";

export class MCPManOAuthProvider implements OAuthClientProvider {
  private tokenStorage: TokenStorage;
  private serverName: string;
  private config: HttpServerConfig;
  private onRedirect?: (url: URL) => void;

  constructor(serverName: string, config: HttpServerConfig, onRedirect?: (url: URL) => void) {
    this.serverName = serverName;
    this.config = config;
    this.tokenStorage = new TokenStorage();
    this.onRedirect = onRedirect;
  }

  get redirectUrl(): string | URL {
    return this.config.oauth?.redirectUrl || "http://localhost:8080/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.oauth?.clientName || "mcpman",
      redirect_uris: [this.redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: this.config.oauth?.scopes?.join(" ") || "mcp:tools",
    };
  }

  async state(): Promise<string> {
    // Generate a random state parameter for CSRF protection
    return crypto.randomUUID();
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Check if we have pre-configured client credentials
    if (this.config.oauth?.clientId) {
      return {
        client_id: this.config.oauth.clientId,
        client_secret: this.config.oauth.clientSecret,
      };
    }

    // Otherwise load from storage (dynamic registration)
    return await this.tokenStorage.loadClientInformation(this.serverName);
  }

  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    await this.tokenStorage.saveClientInformation(this.serverName, clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return await this.tokenStorage.loadTokens(this.serverName);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.tokenStorage.saveTokens(this.serverName, tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.onRedirect) {
      this.onRedirect(authorizationUrl);
    } else {
      // Default behavior: log the URL and prompt user
      console.error(`\n🔐 Authorization required for server '${this.serverName}'`);
      console.error(`Please open this URL in your browser:`);
      console.error(`${authorizationUrl.toString()}\n`);
      console.error(`After authorization, restart mcpman to continue.\n`);
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.tokenStorage.saveCodeVerifier(this.serverName, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.tokenStorage.loadCodeVerifier(this.serverName);
    if (!verifier) {
      throw new Error(`No code verifier found for server '${this.serverName}'`);
    }
    return verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    switch (scope) {
      case "all":
        await this.tokenStorage.deleteTokenData(this.serverName);
        break;
      case "tokens": {
        const data = await this.tokenStorage.loadTokenData(this.serverName);
        const { tokens: _tokens, ...rest } = data;
        await this.tokenStorage.saveTokenData(this.serverName, rest);
        break;
      }
      case "verifier":
        await this.tokenStorage.clearCodeVerifier(this.serverName);
        break;
      case "client": {
        const clientData = await this.tokenStorage.loadTokenData(this.serverName);
        const { clientInformation: _clientInformation, ...clientRest } = clientData;
        await this.tokenStorage.saveTokenData(this.serverName, clientRest);
        break;
      }
    }
  }
}
