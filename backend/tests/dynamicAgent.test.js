import { jest } from '@jest/globals';
import { DynamicAgent } from '../src/engine/workflowEngine'; //
import { ModelContextProtocol } from '../src/engine/mcp'; //
import { retrieveRelevantContext, storeExecutionResults } from '../src/services/vectorDb'; //
import { AgentMemory } from '../src/memory/memory'; //
import { executeToolCall, formatToolsForLLM } from '../src/tools/tool'; //

// Mock dependencies
jest.mock('../src/engine/mcp'); //
jest.mock('../src/services/vectorDb'); //
jest.mock('../src/memory/memory'); //
jest.mock('../src/tools/tool'); //

describe('DynamicAgent', () => {
  let mockMcpInstance;
  let mockMemoryInstance;
  let agentConfig;
  let agent;

  beforeEach(() => {
    mockMcpInstance = {
      addToContext: jest.fn(),
      generateResponse: jest.fn(),
    };
    ModelContextProtocol.mockImplementation(() => mockMcpInstance); //

    mockMemoryInstance = {
      addToShortTerm: jest.fn(),
      retrieveFromLongTerm: jest.fn().mockResolvedValue([]),
      addToLongTerm: jest.fn().mockResolvedValue(),
    };
    AgentMemory.mockImplementation(() => mockMemoryInstance); //

    retrieveRelevantContext.mockResolvedValue({}); //
    storeExecutionResults.mockResolvedValue(); //
    executeToolCall.mockResolvedValue({ result: 'Tool executed successfully' }); //
    formatToolsForLLM.mockReturnValue([]); //


    agentConfig = {
      agentId: 'agent-001',
      agentName: 'Test Agent',
      agentType: 'GENERAL',
      systemInstruction: 'You are a test agent.',
      tools: ['webSearch'], //
      taskAssigned: 'Perform a test task.',
      dependencies: [],
      parallelGroup: 'A',
      modelSettings: { temperature: 0.6 }
    };

    // Mock for genAI.getGenerativeModel if not passing globalExecutionModel
    const mockGenModel = { generateContent: jest.fn() };
    const mockGlobalExecutionModel = { getGenerativeModel: () => mockGenModel };


    agent = new DynamicAgent(agentConfig, mockGlobalExecutionModel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize correctly', () => {
    expect(agent.agentId).toBe('agent-001');
    expect(agent.status).toBe('pending');
    expect(ModelContextProtocol).toHaveBeenCalledWith( //
        expect.any(Object), // The mocked model
        {
            systemInstruction: 'You are a test agent.',
            tools: [{ functionDeclarations: [] }], // formatToolsForLLM is mocked to return []
            modelSettings: { temperature: 0.6, maxOutputTokens: 2048 }
        }
    );
    expect(formatToolsForLLM).toHaveBeenCalledWith(['webSearch']); //
  });

  it('should execute a simple task without tool calls', async () => {
    mockMcpInstance.generateResponse.mockResolvedValueOnce({
      reasoning: 'Task understood.',
      result: 'Task completed successfully.',
    });

    const updateCallback = jest.fn();
    const result = await agent.execute({}, updateCallback);

    expect(agent.status).toBe('completed');
    expect(result.status).toBe('completed');
    expect(result.result).toBe('Task completed successfully.');
    expect(result.reasoning).toContain('Task understood.');
    expect(mockMcpInstance.addToContext).toHaveBeenCalledWith('system', expect.stringContaining('Your current task is: Perform a test task.'));
    expect(mockMcpInstance.generateResponse).toHaveBeenCalledWith(expect.stringContaining('Execute the subtask'), undefined); // second arg is isToolResponseContext
    expect(storeExecutionResults).toHaveBeenCalled(); //
    expect(mockMemoryInstance.addToLongTerm).toHaveBeenCalled(); //
    expect(updateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-001', status: 'in-progress' }));
    expect(updateCallback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-001', status: 'completed' }));
  });

  it('should handle context from dependent tasks', async () => {
    mockMcpInstance.generateResponse.mockResolvedValueOnce({ result: 'Done' });
    const context = { dep1: 'Result from dependency 1' };
    await agent.execute(context, jest.fn());

    expect(mockMcpInstance.addToContext).toHaveBeenCalledWith('system', `Results from dependent tasks: ${JSON.stringify(context)}`);
  });

  it('should execute a task with a single tool call', async () => {
    mockMcpInstance.generateResponse
      .mockResolvedValueOnce({ // First call, requests tool
        toolCalls: [{ name: 'webSearch', args: { query: 'test query' } }], //
      })
      .mockResolvedValueOnce({ // Second call, after tool execution
        reasoning: 'Tool results processed.',
        result: 'Final result after tool.',
      });

    executeToolCall.mockResolvedValueOnce({ data: 'Search results' }); //

    const result = await agent.execute({}, jest.fn());

    expect(executeToolCall).toHaveBeenCalledWith('webSearch', { query: 'test query' }); //
    expect(mockMcpInstance.addToContext).toHaveBeenCalledWith('tool', JSON.stringify([{ name: 'webSearch', response: { data: 'Search results' } }])); //
    expect(mockMcpInstance.generateResponse).toHaveBeenCalledTimes(2);
    expect(result.result).toBe('Final result after tool.');
    expect(result.toolsUsed).toEqual([{ tool: 'webSearch', params: { query: 'test query' }, result: { data: 'Search results' } }]); //
    expect(agent.agentStats.toolCallsMade).toBe(1);
  });

  it('should handle multiple tool calls in a loop', async () => {
    mockMcpInstance.generateResponse
      .mockResolvedValueOnce({ toolCalls: [{ name: 'toolA', args: { p: 1 } }] })
      .mockResolvedValueOnce({ toolCalls: [{ name: 'toolB', args: { p: 2 } }] })
      .mockResolvedValueOnce({ result: 'Finished after two tools' });

    executeToolCall //
        .mockResolvedValueOnce({ resultA: 'Data A' })
        .mockResolvedValueOnce({ resultB: 'Data B' });

    const result = await agent.execute({}, jest.fn());

    expect(executeToolCall).toHaveBeenCalledTimes(2); //
    expect(executeToolCall).toHaveBeenNthCalledWith(1, 'toolA', { p: 1 }); //
    expect(executeToolCall).toHaveBeenNthCalledWith(2, 'toolB', { p: 2 }); //
    expect(mockMcpInstance.generateResponse).toHaveBeenCalledTimes(3);
    expect(result.result).toBe('Finished after two tools');
    expect(agent.agentStats.toolCallsMade).toBe(2);
  });


  it('should break from tool call loop after max iterations', async () => {
    mockMcpInstance.generateResponse.mockResolvedValue({ toolCalls: [{ name: 'loopingTool', args: {} }] }); // Always calls tool
     // Final call after loop break
    mockMcpInstance.generateResponse.mockResolvedValueOnce({ toolCalls: [{ name: 'loopingTool', args: {} }] })
                                .mockResolvedValueOnce({ toolCalls: [{ name: 'loopingTool', args: {} }] })
                                .mockResolvedValueOnce({ toolCalls: [{ name: 'loopingTool', args: {} }] })
                                .mockResolvedValueOnce({ toolCalls: [{ name: 'loopingTool', args: {} }] })
                                .mockResolvedValueOnce({ toolCalls: [{ name: 'loopingTool', args: {} }] })
                                .mockResolvedValueOnce({ result: 'Max loops reached, best effort response.' });


    executeToolCall.mockResolvedValue({ loopData: 'some data' }); //

    const result = await agent.execute({}, jest.fn());

    expect(mockMcpInstance.generateResponse).toHaveBeenCalledTimes(6); // 5 tool calls + 1 final response
    expect(executeToolCall).toHaveBeenCalledTimes(5); //
    expect(result.reasoning).toContain("Reached maximum tool call iterations.");
    expect(result.result).toBe('Max loops reached, best effort response.');
    expect(agent.agentStats.toolCallsMade).toBe(5);
     expect(mockMcpInstance.addToContext).toHaveBeenCalledWith("system", "Max tool call limit reached. Provide your best final answer without calling more tools.");
  });


  it('should handle errors during MCP response generation', async () => {
    mockMcpInstance.generateResponse.mockRejectedValueOnce(new Error('LLM failed'));

    const result = await agent.execute({}, jest.fn());

    expect(agent.status).toBe('error');
    expect(result.status).toBe('error');
    expect(result.result.error).toBe('LLM failed');
    expect(storeExecutionResults).toHaveBeenCalledWith(agent.agentId, expect.objectContaining({ status: 'error' })); //
    expect(mockMemoryInstance.addToLongTerm).toHaveBeenCalledWith( //
        expect.objectContaining({ error: 'LLM failed' }),
        expect.objectContaining({ type: 'failed_execution' })
    );
  });

  it('should handle errors during tool execution', async () => {
    mockMcpInstance.generateResponse.mockResolvedValueOnce({
      toolCalls: [{ name: 'failingTool', args: {} }],
    });
    executeToolCall.mockRejectedValueOnce(new Error('Tool exploded')); //

    // Agent catches tool error and tries to generate response again.
    // Let's assume after tool error, it generates a simple response.
    mockMcpInstance.generateResponse.mockResolvedValueOnce({
        result: "Proceeding after tool failure."
    });


    const result = await agent.execute({}, jest.fn());

    // The agent should attempt to continue. If the LLM is prompted again after the tool error,
    // it might not necessarily result in an "error" status for the agent itself,
    // but the error will be logged and part of toolsUsed.
    // The provided code structure has the agent continue by prompting the LLM again.
    // If the second LLM call succeeds, the agent status will be 'completed'.
    expect(agent.status).toBe('completed'); // because the LLM was called again and succeeded
    expect(result.status).toBe('completed');
    expect(result.toolsUsed[0].result.error).toBe('Execution failed for tool "failingTool".');
    expect(result.toolsUsed[0].result.details).toBe('Tool exploded');
    expect(result.result).toBe("Proceeding after tool failure.");
  });

  it('should retrieve and add context from VectorDB and Memory', async () => {
    retrieveRelevantContext.mockResolvedValueOnce({ similarTasks: [{id: 'task123', document: 'Old task'}] }); //
    mockMemoryInstance.retrieveFromLongTerm.mockResolvedValueOnce([{ data: 'Old memory', similarity: 0.9 }]); //
    mockMcpInstance.generateResponse.mockResolvedValueOnce({ result: 'Context used.' });

    await agent.execute({}, jest.fn());

    expect(retrieveRelevantContext).toHaveBeenCalledWith(agent.taskAssigned); //
    expect(mockMemoryInstance.retrieveFromLongTerm).toHaveBeenCalledWith(agent.taskAssigned, 5); //
    expect(mockMcpInstance.addToContext).toHaveBeenCalledWith('system', expect.stringContaining('Relevant information from knowledge base:'));
    expect(mockMcpInstance.addToContext).toHaveBeenCalledWith('system', expect.stringContaining('Relevant memories from past executions:'));
  });

  it('should correctly parse string and object responses from LLM', async () => {
    // Test with string response
    mockMcpInstance.generateResponse.mockResolvedValueOnce("Simple string response");
    let result = await agent.execute({}, jest.fn());
    expect(result.result).toBe("Simple string response");
    expect(result.reasoning).toBe("Completed.");

    // Test with object response (no tool calls)
    mockMcpInstance.generateResponse.mockResolvedValueOnce({ reasoning: "Complex object reasoning", result: { data: "Structured data" } });
    result = await agent.execute({}, jest.fn());
    expect(result.result).toEqual({ data: "Structured data" });
    expect(result.reasoning).toBe("Complex object reasoning");
  });
});