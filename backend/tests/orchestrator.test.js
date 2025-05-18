import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/orchestrator'; // Assuming orchestrator.js exports 'app'
import { decomposeTask } from '../src/tasks/taskDecomposer'; //
import { executeWorkflow } from '../src/engine/workflowEngine'; //
import { getCollectionStats } from '../src/services/vectorDb'; //
import fs from 'node:fs';

jest.mock('../src/tasks/taskDecomposer', () => ({ //
  decomposeTask: jest.fn(),
  saveJsonToFile: jest.fn(),
}));
jest.mock('../src/engine/workflowEngine', () => ({ //
  executeWorkflow: jest.fn(),
}));
jest.mock('../src/services/vectorDb', () => ({ //
  storeTaskEmbeddings: jest.fn(),
  retrieveRelevantContext: jest.fn(),
  getCollectionStats: jest.fn(() => Promise.resolve({ tasks_collection: 0 })),
  initializeCollections: jest.fn(), // Mock if it's called during startup
}));
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'), // Import and retain default behavior
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false), // Default to file not existing
  unlinkSync: jest.fn(),
}));

// Mock an LLM response for evaluation to avoid actual LLM calls
jest.mock('../src/evaluation/evaluation.js', () => { //
    const originalModule = jest.requireActual('../src/evaluation/evaluation.js'); //
    return {
        ...originalModule,
        AgentEvaluator: jest.fn().mockImplementation(() => ({
            evaluateAgent: jest.fn().mockResolvedValue({
                agentId: 'mockAgentId',
                taskAssigned: 'mockTask',
                status: 'evaluated',
                accuracy: { rating: 8, reason: 'Mocked good accuracy' },
                completeness: { rating: 9, reason: 'Mocked good completeness' },
                coherence: { rating: 7, reason: 'Mocked good coherence' },
                efficiency: { rating: 8, reason: 'Mocked good efficiency' },
                overall: 8.0,
                feedback: 'Mocked positive feedback.',
                timestamp: new Date().toISOString()
            }),
            getSummaryStatistics: jest.fn().mockReturnValue({ accuracy: { average: 8 }})
        })),
        SystemEvaluator: jest.fn().mockImplementation(() => ({
            evaluateTaskCompletion: jest.fn().mockResolvedValue({
                taskId: 'mockTaskId',
                systemRating: 8.5,
                analysis: 'Mocked system analysis: Good performance.',
                recommendations: 'Mocked: Continue monitoring.',
                timestamp: new Date().toISOString()
            }),
            getSystemPerformanceSummary: jest.fn().mockReturnValue({ averageSystemRating: 8.5 })
        })),
    };
});


describe('Orchestrator API', () => {
  beforeEach(() => {
    // Reset mocks before each test
    decomposeTask.mockReset();
    executeWorkflow.mockReset();
    getCollectionStats.mockReset();
    fs.writeFileSync.mockReset();
    fs.unlinkSync.mockReset();

    // Provide default mock implementations
    getCollectionStats.mockResolvedValue({
        tasks_collection: 0,
        agent_executions_collection: 0,
        knowledge_base_collection: 0,
        agent_memory_collection: 0,
    });
    decomposeTask.mockResolvedValue({ //
      taskId: expect.any(String),
      mainTask: 'Test main task',
      subtasks: [
        { subtaskId: 'sub1', subtaskName: 'Subtask 1', dependencies: [], parallelGroup: 'A', description: 'Desc 1' },
        { subtaskId: 'sub2', subtaskName: 'Subtask 2', dependencies: ['sub1'], parallelGroup: 'B', description: 'Desc 2' },
      ],
    });
    executeWorkflow.mockResolvedValue({ //
      mainTaskId: expect.any(String),
      status: 'completed_successfully',
      agentExecutionReports: {
        sub1: { agentId: 'sub1', taskAssigned: "Subtask 1", status: 'completed', result: 'Result 1', agentName: 'TestAgent', agentType: 'GENERAL' },
        sub2: { agentId: 'sub2', taskAssigned: "Subtask 2", status: 'completed', result: 'Result 2', agentName: 'TestAgent', agentType: 'GENERAL' },
      },
      completedAt: new Date().toISOString(),
    });
  });

  describe('POST /tasks', () => {
    it('should create a new task and initiate processing', async () => {
      const response = await request(app)
        .post('/tasks')
        .send({ description: 'Test new task' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('taskId');
      expect(response.body.description).toBe('Test new task');
      expect(response.body.status).toBe('pending'); // Initial status before async processing starts

      // Allow async operations to proceed
      await new Promise(resolve => setImmediate(resolve));


      expect(decomposeTask).toHaveBeenCalledWith('Test new task'); //
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('agents_'), expect.any(String), 'utf-8');
      expect(executeWorkflow).toHaveBeenCalledWith(expect.stringContaining('agents_'), expect.stringContaining('output_'), expect.any(Function)); //
    });

    it('should return 400 if description is missing', async () => {
      const response = await request(app)
        .post('/tasks')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task description is required');
    });
  });

  describe('GET /tasks', () => {
    it('should return all tasks', async () => {
      // First, create a task to ensure there's something to fetch
      await request(app).post('/tasks').send({ description: 'Task for GET test' });
      await new Promise(resolve => setImmediate(resolve)); // allow processing

      const response = await request(app).get('/tasks');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
      expect(response.body.some(task => task.description === 'Task for GET test')).toBe(true);
    });
  });

  describe('GET /tasks/:taskId', () => {
    it('should return a specific task by ID', async () => {
      const postResponse = await request(app).post('/tasks').send({ description: 'Specific task' });
      const taskId = postResponse.body.taskId;
      await new Promise(resolve => setImmediate(resolve));

      const getResponse = await request(app).get(`/tasks/${taskId}`);
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.taskId).toBe(taskId);
      expect(getResponse.body.description).toBe('Specific task');
    });

    it('should return 404 if task not found', async () => {
      const response = await request(app).get('/tasks/nonexistenttaskid');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /tasks/:taskId/agents', () => {
    it('should return agent statuses for a task after processing starts', async () => {
      const postResponse = await request(app).post('/tasks').send({ description: 'Task with agents' });
      const taskId = postResponse.body.taskId;

      // Wait for processAndEvaluateTask to run and populate agentStatusByTask
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for async ops

      const agentResponse = await request(app).get(`/tasks/${taskId}/agents`);
      expect(agentResponse.status).toBe(200);
      expect(Array.isArray(agentResponse.body)).toBe(true);
      // Based on mocked decomposeTask
      expect(agentResponse.body.length).toBe(2);
      expect(agentResponse.body[0].agentId).toBe('sub1');
      expect(agentResponse.body[0].status).toBe('pending'); // Initial status from generateAgentDefinitionsForWorkflow
    });

     it('should return 404 if agents not found for the task', async () => {
      const response = await request(app).get('/tasks/nonexistenttaskid/agents');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /system/stats', () => {
    it('should return system statistics', async () => {
      getCollectionStats.mockResolvedValueOnce({ //
        tasks_collection: 5,
        agent_executions_collection: 10,
        knowledge_base_collection: 2,
        agent_memory_collection: 3
      });
      const response = await request(app).get('/system/stats');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tasks_collection: 5,
        agent_executions_collection: 10,
        knowledge_base_collection: 2,
        agent_memory_collection: 3
      });
      expect(getCollectionStats).toHaveBeenCalled(); //
    });
  });

  describe('Error Handling in processAndEvaluateTask', () => {
    it('should handle errors during task decomposition', async () => {
      decomposeTask.mockRejectedValueOnce(new Error('Decomposition failed horribly')); //

      const response = await request(app)
        .post('/tasks')
        .send({ description: 'Task that will fail decomposition' });
      const taskId = response.body.taskId;

      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for async processing

      const taskStatusResponse = await request(app).get(`/tasks/${taskId}`);
      expect(taskStatusResponse.body.status).toBe('error');
      expect(taskStatusResponse.body.result.error).toBe('Decomposition failed horribly');
    });

    it('should handle errors during workflow execution', async () => {
      executeWorkflow.mockRejectedValueOnce(new Error('Workflow crashed')); //

      const response = await request(app)
        .post('/tasks')
        .send({ description: 'Task that will fail workflow' });
      const taskId = response.body.taskId;

      await new Promise(resolve => setTimeout(resolve, 50));

      const taskStatusResponse = await request(app).get(`/tasks/${taskId}`);
      expect(taskStatusResponse.body.status).toBe('error');
      expect(taskStatusResponse.body.result.error).toBe('Workflow crashed');
    });
  });
});