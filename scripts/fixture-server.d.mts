export declare const FIXTURE_ROOT: string;
export declare function startFixtureServer(
  variant: "production" | "staging",
  port?: number,
): Promise<{ url: string; close: () => Promise<void> }>;
