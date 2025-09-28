import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getConfigDir } from "../config/loader.js";

export interface StoredTokenData {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
}

export class TokenStorage {
  private getTokenPath(serverName: string): string {
    const configDir = getConfigDir();
    return `${configDir}/tokens/${serverName}.json`;
  }

  private async ensureTokenDir(): Promise<void> {
    const configDir = getConfigDir();
    const tokenDir = `${configDir}/tokens`;

    try {
      await Bun.$`mkdir -p ${tokenDir}`;
    } catch (_error) {
      throw new Error(`Failed to create token directory: ${tokenDir}`);
    }
  }

  async loadTokenData(serverName: string): Promise<StoredTokenData> {
    const tokenPath = this.getTokenPath(serverName);

    try {
      const file = Bun.file(tokenPath);
      const exists = await file.exists();

      if (!exists) {
        return {};
      }

      const data = (await file.json()) as StoredTokenData;
      return data;
    } catch (error) {
      console.error(`Failed to load tokens for ${serverName}:`, error);
      return {};
    }
  }

  async saveTokenData(serverName: string, data: StoredTokenData): Promise<void> {
    await this.ensureTokenDir();
    const tokenPath = this.getTokenPath(serverName);

    try {
      await Bun.write(tokenPath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new Error(`Failed to save tokens for ${serverName}: ${error}`);
    }
  }

  async deleteTokenData(serverName: string): Promise<void> {
    const tokenPath = this.getTokenPath(serverName);

    try {
      await Bun.$`rm -f ${tokenPath}`;
    } catch (error) {
      // Ignore errors when deleting non-existent files
      console.warn(`Could not delete tokens for ${serverName}:`, error);
    }
  }

  async loadTokens(serverName: string): Promise<OAuthTokens | undefined> {
    const data = await this.loadTokenData(serverName);
    return data.tokens;
  }

  async saveTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
    const existingData = await this.loadTokenData(serverName);
    await this.saveTokenData(serverName, {
      ...existingData,
      tokens,
    });
  }

  async loadClientInformation(serverName: string): Promise<OAuthClientInformationFull | undefined> {
    const data = await this.loadTokenData(serverName);
    return data.clientInformation;
  }

  async saveClientInformation(
    serverName: string,
    clientInfo: OAuthClientInformationFull
  ): Promise<void> {
    const existingData = await this.loadTokenData(serverName);
    await this.saveTokenData(serverName, {
      ...existingData,
      clientInformation: clientInfo,
    });
  }

  async loadCodeVerifier(serverName: string): Promise<string | undefined> {
    const data = await this.loadTokenData(serverName);
    return data.codeVerifier;
  }

  async saveCodeVerifier(serverName: string, codeVerifier: string): Promise<void> {
    const existingData = await this.loadTokenData(serverName);
    await this.saveTokenData(serverName, {
      ...existingData,
      codeVerifier,
    });
  }

  async clearCodeVerifier(serverName: string): Promise<void> {
    const existingData = await this.loadTokenData(serverName);
    const { codeVerifier: _codeVerifier, ...rest } = existingData;
    await this.saveTokenData(serverName, rest);
  }
}
