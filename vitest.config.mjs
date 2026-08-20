import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.js", "test/integrity/*.test.js"],
    environment: "node",
  },
});
