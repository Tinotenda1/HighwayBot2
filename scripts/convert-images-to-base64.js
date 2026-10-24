
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputDir = path.join(__dirname, "../assets/course-images");
const outputDir = path.join(__dirname, "../assets/course-images-base64");

fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(inputDir)) {
  console.error("Image folder not found:", inputDir);
  process.exit(1);
}

const files = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith(".png"));

if (files.length === 0) {
  console.log("No PNG files found in:", inputDir);
  process.exit(0);
}

const manifest = [];
let failed = 0;

for (const file of files) {
  try {
    const inputPath = path.join(inputDir, file);
    const buffer = fs.readFileSync(inputPath);
    const base64 = buffer.toString("base64");

    const outputName = `${path.parse(file).name}.json`;
    const outputPath = path.join(outputDir, outputName);

    const record = {
      filename: file,
      mimeType: "image/png",
      base64,
      dataUri: `data:image/png;base64,${base64}`,
    };

    fs.writeFileSync(
      outputPath,
      JSON.stringify(record),
      "utf8"
    );

    manifest.push({
      filename: file,
      output: outputName,
      bytes: buffer.length,
    });

    console.log(`Converted ${file} (${buffer.length} bytes)`);
  } catch (error) {
    failed++;
    console.error(`Failed to convert ${file}:`, error.message);
  }
}

fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log("\nConversion complete.");
console.log(`Successful: ${manifest.length}`);
console.log(`Failed: ${failed}`);
console.log("Output folder:", outputDir);
