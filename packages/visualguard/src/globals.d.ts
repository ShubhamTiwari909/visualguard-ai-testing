/**
 * @file Declares the build-injected version constant for TypeScript; erased at runtime.
 *
 * TypeScript declarations describe data and compile-time contracts. They help editors and the
 * compiler; type-only declarations are removed from the JavaScript build and do not validate
 * runtime JSON.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

/**
 * Injected at build time from package.json (tsup/vitest).
 */
declare global {
  const __VISUALGUARD_VERSION__: string;
}
export {};
