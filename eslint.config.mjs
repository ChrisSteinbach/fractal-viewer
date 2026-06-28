import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores
  { ignores: ["dist/", "dev-dist/", "node_modules/"] },

  // Base JS recommended rules
  eslint.configs.recommended,

  // TypeScript type-checked rules
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-wide rules
  {
    rules: {
      eqeqeq: ["error", "always"],
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            "Use textContent or createElement instead of innerHTML to prevent XSS.",
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message:
            "Use textContent or createElement instead of outerHTML to prevent XSS.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message:
            "Use textContent or createElement instead of insertAdjacentHTML to prevent XSS.",
        },
        {
          selector:
            "CallExpression[callee.property.name='write'][callee.object.name='document']",
          message:
            "Use textContent or createElement instead of document.write to prevent XSS.",
        },
      ],
      "no-param-reassign": "error",

      // TypeScript-specific
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },

  // Test file overrides
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
