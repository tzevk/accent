import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});


// Default ignores (use the `ignores` property instead of .eslintignore)
const ignores = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
  "._*",
  "**/._*",
  "._**",
  "**/._**",
  "*.backup",
  "*.orig",
  "*.log",
  "_package-lock.json",
  "_node_modules",
];

const eslintConfig = [
  // Global ignores applied first
  { ignores },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
  },
];

export default eslintConfig;
