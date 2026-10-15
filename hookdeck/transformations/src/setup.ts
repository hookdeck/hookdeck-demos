/**
 * Upserts every example's transformation, source and connection. Run it after
 * editing a transformation in transformations/ to push the new code. The UI
 * runs the same setup when it starts.
 *
 * Usage: npm run setup
 */
import { requireApiKey, setup } from "./lib.js";
import { examples } from "./examples.js";

requireApiKey();
for (const example of examples) {
  const r = await setup(example);
  console.log(`${example.id.padEnd(16)} ${r.sourceUrl}`);
}
