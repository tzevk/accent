import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});


import fs from "fs";

// Default ignores
let ignores = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
  "._*",
  "**/._*",
  "._**",
  "**/._**",
];

// Migrate ignores from .eslintignore
try {
  const ignoreFile = fs.readFileSync(".eslintignore", "utf-8");
  const migrated = ignoreFile.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  ignores = [...ignores, ...migrated];
} catch (e) {
  // .eslintignore not found, ignore
}

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    ignores,
  },
];

export default eslintConfig;
