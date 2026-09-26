// Next aliases this marker to an empty module in server builds. Match that alias
// when running route handlers directly in the local integration test process.
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
} });
