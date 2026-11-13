import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  collectCoverageFrom: ["app/suppliers/api.ts", "app/incidents/api.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "html", "json-summary"],
  coverageThreshold: {
    global: { statements: 70, branches: 70, functions: 70, lines: 70 },
  },
});