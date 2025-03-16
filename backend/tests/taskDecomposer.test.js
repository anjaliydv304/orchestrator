import { jest } from "@jest/globals";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.isolateModules(() => {
  describe("Task Decomposer Unit Tests", () => {
    beforeEach(() => {
      delete process.env.GOOGLE_API_KEY;
      jest.resetModules();
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should decompose a task and return JSON", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockResolvedValue({
              response: {
                text: () =>
                  '```json\n{"mainTask": "Test Task", "subtasks": [{"subtaskId": 1, "subtaskName": "Subtask 1", "dependencies": [], "parallelGroup": 1}]}\n```',
              },
            }),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");
      const result = await decomposeTask("Test Task");

      expect(result).toEqual({
        mainTask: "Test Task",
        subtasks: [
          {
            subtaskId: 1,
            subtaskName: "Subtask 1",
            dependencies: [],
            parallelGroup: 1,
          },
        ],
      });
    });

    it("should handle invalid JSON from AI", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockResolvedValue({
              response: {
                text: () => "This is not valid JSON",
              },
            }),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");

      await expect(async () => {
        await decomposeTask("Test Task");
      }).rejects.toThrow("Received invalid JSON from AI.");
    });

    it("should save JSON to file", async () => {
      const { saveJsonToFile } = await import("../src/taskDecomposer.js");
      const jsonData = { test: "data" };
      const filePath = path.join(__dirname, "test.json");

      saveJsonToFile(jsonData, filePath);
      expect(fs.existsSync(filePath)).toBe(true);
      fs.unlinkSync(filePath);
    });

    it("should handle API errors gracefully", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockRejectedValue(
              new Error("API quota exceeded")
            ),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");

      await expect(decomposeTask("Test Task")).rejects.toThrow(
        "Failed to decompose the task."
      );
    });

    it("should handle responses with direct JSON without markdown", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockResolvedValue({
              response: {
                text: () =>
                  '{"mainTask": "Test Task", "subtasks": [{"subtaskId": 1, "subtaskName": "Subtask 1", "dependencies": [], "parallelGroup": 1}]}',
              },
            }),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");
      const result = await decomposeTask("Test Task");

      expect(result).toHaveProperty("mainTask", "Test Task");
    });

    it("should handle responses with JSON embedded in text", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockResolvedValue({
              response: {
                text: () =>
                  'Here is the task decomposition: {"mainTask": "Test Task", "subtasks": [{"subtaskId": 1, "subtaskName": "Subtask 1", "dependencies": [], "parallelGroup": 1}]} Hope this helps!',
              },
            }),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");
      const result = await decomposeTask("Test Task");

      expect(result).toHaveProperty("mainTask", "Test Task");
    });

    it("should handle file writing errors", async () => {
      const originalWriteFileSync = fs.writeFileSync;
      fs.writeFileSync = jest.fn().mockImplementation(() => {
        throw new Error("Disk full");
      });

      const { saveJsonToFile } = await import("../src/taskDecomposer.js");
      const jsonData = { test: "data" };
      const filePath = "/non/existent/path/file.json";

      expect(() => saveJsonToFile(jsonData, filePath)).not.toThrow();
      expect(console.error).toHaveBeenCalled();

      fs.writeFileSync = originalWriteFileSync;
    });

    it("should handle completely unparseable responses", async () => {
      await jest.unstable_mockModule("@google/generative-ai", () => ({
        GoogleGenerativeAI: jest.fn(() => ({
          getGenerativeModel: jest.fn(() => ({
            generateContent: jest.fn().mockResolvedValue({
              response: {
                text: () =>
                  "No JSON here whatsoever, not even a curly brace to be found",
              },
            }),
          })),
        })),
      }));

      const { decomposeTask } = await import("../src/taskDecomposer.js");

      await expect(decomposeTask("Test Task")).rejects.toThrow(
        "Received invalid JSON from AI."
      );
    });
  });
});
