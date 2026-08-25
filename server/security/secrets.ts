export interface ServerSecretProvider {
  get(reference: string): Promise<string | null>;
}

export class EnvironmentSecretProvider implements ServerSecretProvider {
  async get(reference: string): Promise<string | null> {
    if (!/^CLOSER_SECRET_[A-Z0-9_]+$/.test(reference)) return null;
    return process.env[reference] ?? null;
  }
}

export class MapSecretProvider implements ServerSecretProvider {
  constructor(private readonly secrets: ReadonlyMap<string, string>) {}

  async get(reference: string): Promise<string | null> {
    return this.secrets.get(reference) ?? null;
  }
}

