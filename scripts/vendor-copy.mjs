import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const vendor = path.join(root, "public", "vendor");

const pairs = [
  [
    path.join(root, "node_modules", "@mapbox", "mapbox-gl-draw", "dist", "mapbox-gl-draw.css"),
    path.join(vendor, "mapbox-gl-draw.css"),
  ],
  [
    path.join(root, "node_modules", "@mapbox", "mapbox-gl-draw", "dist", "mapbox-gl-draw.js"),
    path.join(vendor, "mapbox-gl-draw.js"),
  ],
  [
    path.join(root, "node_modules", "@turf", "turf", "turf.min.js"),
    path.join(vendor, "turf.min.js"),
  ],
];

fs.mkdirSync(vendor, { recursive: true });
for (const [src, dest] of pairs) {
  if (!fs.existsSync(src)) {
    console.error("vendor-copy: falta origen:", src);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
}
console.log("vendor-copy: OK → public/vendor/");
