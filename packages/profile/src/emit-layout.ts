import { writeFileSync } from "node:fs";
import { layoutJson } from "./layout.ts";

const out = process.argv[2];
const text = `${JSON.stringify(layoutJson(), null, 2)}\n`;
if (out) writeFileSync(out, text);
else process.stdout.write(text);
