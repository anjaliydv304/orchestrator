import { jest } from '@jest/globals';
import { executeWorkflow, DynamicAgent } from '../src/engine/workflowEngine'; //
import fs from 'node:fs';
import { getAgentByType, matchAgentToTask } from '../src/agents/agentRegistry'; //

// Mock dependencies
jest.mock('node:fs');
jest.mock('../src/agents/agentRegistry'); //

// Mock DynamicAgent class itself or its execute method
jest.mock('../src/engine/workflowEngine', () => { //
  const originalModule = jest.requireActual('../src/engine/workflowEngine'); //
  return {
    ...originalModule,
    DynamicAgent: jest.fn().mockImplementation((config) => {
      return {
        ...config, // Store config
        agentId: config.agentId,
        status: 'pending',
        dependencies: config.dependencies || [],
        parallelGroup: config.parallelGroup,
        taskAssigned: config.taskAssigned,
        execute: jest.fn().mockImplementation(async function(context, updateCb) {
          this.status = 'completed'; // Simulate successful execution
          const report = {
            agentId: this.agentId,
            agentName: this.agentName || `Agent for ${this.taskAssigned}`,
            agentType: this.agentType || 'MOCK_GENERAL',
            taskAssigned: this.taskAssigned,
            status: 'completed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            executionTimeMs: 100,
            result: `Result for ${this.agentId}`,
            reasoning: 'Mocked execution completed.',
            toolsUsed: []
          };
          if (updateCb) {
            updateCb({ agentId: this.agentId, status: 'in-progress' });
            updateCb(report);
          }
          return report;
        }),
      };
    }),
  };
});


describe('WorkflowEngine - executeWorkflow', () => {
  const mockAgentsFilePath = 'mockAgents.json';
  const mockOutputFilePath = 'mockOutput.json';
  let mockUpdateCallback;

  beforeEach(() => {
    fs.readFileSync.mockReset();
    fs.writeFileSync.mockReset();
    DynamicAgent.mockClear(); // Clear mock constructor calls
    // Clear all instances and calls to constructor and all methods:
    DynamicAgent.mock.instances.forEach(instance => {
        Object.getOwnPropertyNames(instance.constructor.prototype).forEach(methodName => {
            if (methodName !== 'constructor' && typeof instance[methodName] === 'function') {
                instance[methodName].mockClear();
            }
        });
         if(instance.execute && typeof instance.execute.mockClear === 'function') {
            instance.execute.mockClear();
        }
    });


    getAgentByType.mockImplementation(type => ({ //
      type: type,
      systemInstruction: `Instruction for ${type}`,
      tools: type === 'RESEARCHER' ? ['webSearch'] : [], //
    }));
    matchAgentToTask.mockImplementation(taskDesc => { //
      if (taskDesc.toLowerCase().includes('research')) return 'RESEARCHER';
      return 'GENERAL';
    });
    mockUpdateCallback = jest.fn();
  });

  const createMockAgentInputData = (agents) => ({
    mainTask: 'main-task-01',
    agents: agents,
  });

  it('should execute a simple workflow with one agent', async () => {
    const agentInput = createMockAgentInputData([
      { agentId: 'agent1', taskAssigned: 'Task 1', dependencies: [], parallelGroup: 'A' },
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));

    const result = await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    expect(fs.readFileSync).toHaveBeenCalledWith(mockAgentsFilePath, 'utf-8');
    expect(DynamicAgent).toHaveBeenCalledTimes(1);
    const agentInstance = DynamicAgent.mock.instances[0];
    expect(agentInstance.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed_successfully');
    expect(result.agentExecutionReports.agent1.status).toBe('completed');
    expect(fs.writeFileSync).toHaveBeenCalledWith(mockOutputFilePath, JSON.stringify(result, null, 2), 'utf-8');
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', status: 'pending' }));
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', status: 'ready_to_execute'}));
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', status: 'in-progress'}));
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', status: 'completed'}));
  });

  it('should execute a workflow with dependencies', async () => {
    const agentInput = createMockAgentInputData([
      { agentId: 'agent1', taskAssigned: 'Task 1 research', dependencies: [], parallelGroup: 'A' },
      { agentId: 'agent2', taskAssigned: 'Task 2', dependencies: ['agent1'], parallelGroup: 'B' },
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));

    await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    expect(DynamicAgent).toHaveBeenCalledTimes(2);
    const agent1Instance = DynamicAgent.mock.instances.find(inst => inst.agentId === 'agent1');
    const agent2Instance = DynamicAgent.mock.instances.find(inst => inst.agentId === 'agent2');

    expect(agent1Instance.execute).toHaveBeenCalledTimes(1);
    // agent2 depends on agent1, so context should include agent1's result
    expect(agent2Instance.execute).toHaveBeenCalledWith(
        expect.objectContaining({ agent1: 'Result for agent1' }),
        mockUpdateCallback
    );
    expect(agent2Instance.execute).toHaveBeenCalledTimes(1);
  });

  it('should execute agents in parallel groups if dependencies are met', async () => {
    const agentInput = createMockAgentInputData([
      { agentId: 'agentA1', taskAssigned: 'Task A1', dependencies: [], parallelGroup: 'A' },
      { agentId: 'agentA2', taskAssigned: 'Task A2 research', dependencies: [], parallelGroup: 'A' },
      { agentId: 'agentB1', taskAssigned: 'Task B1', dependencies: ['agentA1', 'agentA2'], parallelGroup: 'B' },
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));

    await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    const agentA1 = DynamicAgent.mock.instances.find(i => i.agentId === 'agentA1');
    const agentA2 = DynamicAgent.mock.instances.find(i => i.agentId === 'agentA2');
    const agentB1 = DynamicAgent.mock.instances.find(i => i.agentId === 'agentB1');

    // A1 and A2 should be called (their order within the group isn't strictly defined here)
    expect(agentA1.execute).toHaveBeenCalledTimes(1);
    expect(agentA2.execute).toHaveBeenCalledTimes(1);
    // B1 should be called with results from A1 and A2
    expect(agentB1.execute).toHaveBeenCalledWith(
      expect.objectContaining({ agentA1: 'Result for agentA1', agentA2: 'Result for agentA2' }),
      mockUpdateCallback
    );
  });

  it('should handle agent execution errors and mark workflow as completed_with_errors', async () => {
    const agentInput = createMockAgentInputData([
      { agentId: 'agent1', taskAssigned: 'Task 1', dependencies: [], parallelGroup: 'A' },
      { agentId: 'agent2', taskAssigned: 'Task 2 (will fail)', dependencies: ['agent1'], parallelGroup: 'B' },
      { agentId: 'agent3', taskAssigned: 'Task 3', dependencies: ['agent2'], parallelGroup: 'C' }, // Will be blocked
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));

    const agent2Instance = {
      agentId: 'agent2',
      taskAssigned: 'Task 2 (will fail)',
      dependencies: ['agent1'],
      parallelGroup: 'B',
      status: 'pending',
      execute: jest.fn().mockImplementation(async function(context, updateCb) {
        this.status = 'error';
        const report = { agentId: this.agentId, status: 'error', result: {error: 'Agent 2 failed'}, taskAssigned: this.taskAssigned };
        if(updateCb) {
            updateCb({ agentId: this.agentId, status: 'in-progress'});
            updateCb(report);
        }
        return report;
      })
    };

     DynamicAgent.mockImplementation(config => {
        if (config.agentId === 'agent2') return agent2Instance;
        return { // Default mock for other agents
            ...config,
            agentId: config.agentId, status: 'pending',
            execute: jest.fn().mockImplementation(async function(ctx, cb) {
                this.status = 'completed';
                const rep = { agentId: this.agentId, status: 'completed', result: `Result for ${this.agentId}`, taskAssigned: this.taskAssigned};
                if(cb) {
                    cb({agentId: this.agentId, status: 'in-progress'});
                    cb(rep);
                }
                return rep;
            })
        };
     });


    const result = await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    expect(result.status).toBe('completed_with_errors');
    expect(result.agentExecutionReports.agent1.status).toBe('completed');
    expect(result.agentExecutionReports.agent2.status).toBe('error');
    expect(result.agentExecutionReports.agent3.status).toBe('blocked_error'); // Blocked due to agent2 error
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent3', status: 'blocked_error'}));
  });

   it('should handle workflow deadlock/stalled if dependencies cannot be met', async () => {
    const agentInput = createMockAgentInputData([
      { agentId: 'agent1', taskAssigned: 'Task 1', dependencies: ['nonExistentAgent'], parallelGroup: 'A' },
      { agentId: 'agent2', taskAssigned: 'Task 2', dependencies: ['agent1'], parallelGroup: 'B' },
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console.error for this test

    const result = await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    expect(DynamicAgent).toHaveBeenCalledTimes(2); // Agents are created
    const agent1Instance = DynamicAgent.mock.instances.find(inst => inst.agentId === 'agent1');
    const agent2Instance = DynamicAgent.mock.instances.find(inst => inst.agentId === 'agent2');

    expect(agent1Instance.execute).not.toHaveBeenCalled(); // agent1 cannot run
    expect(agent2Instance.execute).not.toHaveBeenCalled(); // agent2 depends on agent1

    expect(result.agentExecutionReports.agent1.status).toBe('stalled');
    expect(result.agentExecutionReports.agent2.status).toBe('stalled');
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', status: 'stalled'}));
    expect(mockUpdateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent2', status: 'stalled'}));

    consoleErrorSpy.mockRestore();
  });


  it('should throw error if agents file cannot be read', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('File read error');
    });
    await expect(executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback)) //
      .rejects.toThrow('File read error');
  });

  it('should log error if output file cannot be written', async () => {
     const agentInput = createMockAgentInputData([
      { agentId: 'agent1', taskAssigned: 'Task 1', dependencies: [], parallelGroup: 'A' },
    ]);
    fs.readFileSync.mockReturnValue(JSON.stringify(agentInput));
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('File write error');
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await executeWorkflow(mockAgentsFilePath, mockOutputFilePath, mockUpdateCallback); //

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error writing workflow output file:', 'File write error');
    consoleErrorSpy.mockRestore();
  });
});