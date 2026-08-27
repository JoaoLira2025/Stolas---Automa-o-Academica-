export function error(...args: any[]) {
  try {
    const env = process.env.NODE_ENV || "development";
    if (env === "production") {
      // In production, avoid leaking stack traces to stdout. Keep minimal message.
      const [first] = args;
      if (first instanceof Error) {
        console.error(first.message);
      } else {
        console.error(typeof first === "string" ? first : JSON.stringify(first));
      }
      return;
    }
  } catch {
    // ignore
  }
  // In non-production, print full details for debugging
  console.error(...args);
}

export default { error };
