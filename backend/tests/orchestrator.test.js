import { jest } from "@jest/globals";
import { v4 as uuidv4 } from "uuid";
import request from "supertest";
import http from "http";

jest.unstable_mockModule("../src/workflowEngine.js", () => ({
  executeWorkflow: jest.fn().mockResolvedValue({ status: "completed" }),
}));

jest.unstable_mockModule("../src/taskDecomposer.js", () => ({
  decomposeTask: jest.fn().mockResolvedValue({
    mainTask: "Mocked Task",
    subtasks: [],
  }),
  saveJsonToFile: jest.fn(),
}));

describe("Orchestrator API Unit Tests", () => {
  let taskId;
  let mockDecomposeTask;
  let app;
  let server;
  let sseClients = [];

  beforeEach(async () => {
    taskId = uuidv4();
    process.env.GEMINI_API_KEY = "test-api-key";

    jest.resetModules();

    mockDecomposeTask = (await import("../src/taskDecomposer.js")).decomposeTask;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    const orchestrator = await import("../src/orchestrator.js");
    app = orchestrator.default;
    server = orchestrator.server;
    
    if (app._router && app._router.stack) {
      const eventsRoute = app._router.stack.find(
        layer => layer.route && layer.route.path === '/events'
      );
      
      if (eventsRoute && eventsRoute.route.stack && eventsRoute.route.stack[0]) {
        const originalHandler = eventsRoute.route.stack[0].handle;
        eventsRoute.route.stack[0].handle = function(req, res, next) {
          sseClients.push(res);
          return originalHandler(req, res, next);
        };
      }
    }
  });

  afterEach((done) => {
    console.log.mockRestore();
    console.error.mockRestore();

    sseClients.forEach(client => {
      if (client.connection && !client.connection.destroyed) {
        client.end();
      }
    });
    sseClients = [];

    if (server && server.close) {
      server.close(() => {
        delete process.env.GEMINI_API_KEY;
        done();
      });
    } else {
      delete process.env.GEMINI_API_KEY;
      done();
    }
  }, 10000);

  it("should create a new task", async () => {
    const response = await request(app)
      .post("/tasks")
      .send({ description: "Test task" });

    expect(response.statusCode).toBe(201);
    expect(response.body.description).toBe("Test task");
    expect(response.body.status).toBe("pending");
    expect(response.body.taskId).toBeDefined();
    expect(mockDecomposeTask).toHaveBeenCalledWith("Test task");
  });

  it("should get all tasks", async () => {
    await request(app).post("/tasks").send({ description: "Task 1" });
    await request(app).post("/tasks").send({ description: "Task 2" });

    const response = await request(app).get("/tasks");

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(2);
  });

  it("should update task status", async () => {
    const createTaskResponse = await request(app)
      .post("/tasks")
      .send({ description: "Update task status" });
    const taskId = createTaskResponse.body.taskId;

    const updateResponse = await request(app)
      .put(`/tasks/${taskId}/status`)
      .send({ status: "in-progress" });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.body.status).toBe("in-progress");
  });

  it("should update task priority", async () => {
    const createTaskResponse = await request(app)
      .post("/tasks")
      .send({ description: "Update task priority" });
    const taskId = createTaskResponse.body.taskId;

    const updateResponse = await request(app)
      .put(`/tasks/${taskId}/priority`)
      .send({ priority: "high" });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.body.priority).toBe("high");
  });

  it("should handle invalid task priority", async () => {
    const createTaskResponse = await request(app)
      .post("/tasks")
      .send({ description: "Invalid priority task" });
    const taskId = createTaskResponse.body.taskId;

    const updateResponse = await request(app)
      .put(`/tasks/${taskId}/priority`)
      .send({ priority: "invalid-priority" });

    expect(updateResponse.statusCode).toBe(400);
  });

  it("should delete a task", async () => {
    const createTaskResponse = await request(app)
      .post("/tasks")
      .send({ description: "Delete this task" });
    const taskId = createTaskResponse.body.taskId;

    const deleteResponse = await request(app).delete(`/tasks/${taskId}`);

    expect(deleteResponse.statusCode).toBe(200);

    const getResponse = await request(app).get("/tasks");
    const foundTask = getResponse.body.find((task) => task.taskId === taskId);
    expect(foundTask).toBeUndefined();
  });

  it("should return 404 if task not found for update/delete", async () => {
    const nonExistentId = uuidv4();
    
    const updateStatusResponse = await request(app)
      .put(`/tasks/${nonExistentId}/status`)
      .send({ status: "in-progress" });
    expect(updateStatusResponse.statusCode).toBe(404);
    
    const updatePriorityResponse = await request(app)
      .put(`/tasks/${nonExistentId}/priority`)
      .send({ priority: "high" });
    expect(updatePriorityResponse.statusCode).toBe(404);
    
    const deleteResponse = await request(app).delete(`/tasks/${nonExistentId}`);
    expect(deleteResponse.statusCode).toBe(404);
  });

  it("should handle SSE connections with proper response headers", async () => {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${server.address().port}/events`, (res) => {
        try {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toContain("text/event-stream");

         
          res.on("data", (chunk) => {
            
            res.destroy();
            req.destroy();
            resolve();
          });

          setTimeout(() => {
            res.destroy();
            req.destroy();
            resolve();
          }, 500);
        } catch (error) {
          res.destroy();
          req.destroy();
          reject(error);
        }
      });

      req.on("error", (err) => {
        reject(err);
      });
    });
  }, 3000);

  it("should handle missing fields in task creation", async () => {
    const response = await request(app)
      .post("/tasks")
      .send({}); 

    expect(response.statusCode).toBe(400);
  });

  it("should handle invalid task status updates", async () => {
    const createTaskResponse = await request(app)
      .post("/tasks")
      .send({ description: "Invalid status task" });
    const taskId = createTaskResponse.body.taskId;

    const updateResponse = await request(app)
      .put(`/tasks/${taskId}/status`)
      .send({ status: "invalid-status" });

    expect(updateResponse.statusCode).toBe(400);
  });

});