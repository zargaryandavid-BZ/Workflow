/**
 * Node loader so `import "server-only"` is a no-op when running FedEx scripts via tsx.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export default {};",
    };
  }
  return nextResolve(specifier, context);
}
