// For webSearch example
import axios from 'axios';
// For documentRetrieval
import { retrieveKnowledge } from '../services/vectorDb.js';
// To avoid circular dependency if taskDecomposition tool calls taskDecomposer.js directly,


// Placeholder for actual generative model for tools like summarization, if not passed
let _toolGenAIModel;
async function getToolModel() {
    if (!_toolGenAIModel) {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        _toolGenAIModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    }
    return _toolGenAIModel;
}

const availableTools = {
  webSearch: {
    name: "webSearch",
    description: "Search the web for information based on a query.",
    // Using a schema for better validation and description for LLM
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        numResults: { type: "number", description: "Number of results to return (default 5)." }
      },
      required: ["query"]
    },
    execute: async (params) => {
      console.log("Executing webSearch tool with params:", params);
      try {
        // --- START MODIFICATION ---
        // Replace with actual search API integration (e.g., SerpApi, Google Custom Search JSON API)
        // const apiKey = process.env.SEARCH_API_KEY; // You'll need to set this environment variable
        // if (!apiKey) throw new Error("Search API key (SEARCH_API_KEY) is not configured in environment variables.");

        /*
        // Example structure for an API call:
        const response = await axios.get(`https://api.example-search.com/search`, {
          params: {
            q: params.query,
            num: params.numResults || 5, // API specific parameter for number of results
            key: apiKey // API specific parameter for API key
            // ... other parameters as required by the specific API
          },
        });

        // Process the response:
        // The structure of response.data will depend on the search API you use.
        // You need to adapt this part to extract relevant information (e.g., titles, snippets, URLs).
        if (response.data && response.data.items) { // Example: Google Custom Search API like structure
          return response.data.items.map(item => ({
            title: item.title,
            snippet: item.snippet,
            url: item.link
          }));
        } else {
          // Fallback or handle cases where the API response structure is different
          // or if results are in a different format.
          console.warn("Web search API returned unexpected data structure:", response.data);
          return {
            warning: "Could not parse results from web search API or no results found.",
            rawData: response.data // Return raw data for debugging if parsing fails
          };
        }
        */

        // For now, to demonstrate with the Google Search tool I have access to,
        // let's simulate returning data similar to what it provided.
        // In a real scenario, the axios call above would fetch this.
        // The following is a placeholder to show the *kind* of data the agent should now get.
        // Replace this ENTIRE block with the actual API call and processing logic shown in the commented section above.
        if (params.query.toLowerCase().includes("benefits of artificial intelligence")) {
            return [
                { title: "What Is Artificial Intelligence (AI)? | Google Cloud", snippet: "AI is the backbone of innovation in modern computing, unlocking value for individuals and businesses. ... Automation. AI can automate workflows and processes ... Reduce human error. ... Eliminate repetitive tasks. ... Fast and accurate. ... Infinite availability. ... Accelerated research and development.", url: "https://cloud.google.com/learn/what-is-artificial-intelligence" },
                { title: "9 Benefits of Artificial Intelligence (AI) in 2025 - University of Cincinnati Online", snippet: "Key Takeaways. #1 – Enhanced Healthcare. #2 – Boosted Economic Growth. #3 – Climate Change Mitigation. #4 – Advanced Transportation. #5 – Customer Service Excellence. #6 – Scientific Discovery. #7 – Enhanced Financial Services.", url: "https://online.uc.edu/blog/artificial-intelligence-ai-benefits/" },
                { title: "7 Benefits of Artificial Intelligence (AI) | Tableau", snippet: "Automation. Smarter decisions. Better customer service. Accurate medical diagnosis. Faster data analysis. Reducing human error. More reliable forecasting.", url: "https://www.tableau.com/en-gb/data-insights/ai/benefits" },
                { title: "What are the advantages and disadvantages of artificial intelligence (AI)? - Tableau", snippet: "Advantages of AI. Eliminates human error and risk. 24/7 availability.", url: "https://www.tableau.com/data-insights/ai/advantages-disadvantages" },
                { title: "Benefits of AI | Thomson Reuters", snippet: "Enhanced decision-making. ... AI can help you mitigate risks. ... Automation and efficiency. ... AI automation doesn't just save time — it transforms how organizations allocate their resources.", url: "https://www.thomsonreuters.com/en/insights/articles/benefits-of-artificial-intelligence-ai" }
            ];
        } else {
            return `Simulated web search results for query: "${params.query}". No specific mocked data for this query.`;
        }
        // --- END MODIFICATION ---

      } catch (error) {
        console.error("Web search tool error:", error.message, error.response ? error.response.data : '');
        let details = error.message;
        if (error.response && error.response.data) {
            details += ` | Server responded with: ${JSON.stringify(error.response.data)}`;
        }
        return { error: "Failed to execute web search.", details: details };
      }
    }
  },
  documentRetrieval: {
    name: "documentRetrieval",
    description: "Retrieve relevant documents or knowledge snippets from the internal vector database based on a query.",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The query to search for in the knowledge base." },
        filter: { type: "object", description: "(Optional) Metadata filter for the query." },
        limit: { type: "number", description: "Maximum number of documents to retrieve (default 3)." }
      },
      required: ["query"]
    },
    execute: async (params) => {
      console.log("Executing documentRetrieval tool with params:", params);
      try {
        const results = await retrieveKnowledge(params.query, params.limit || 3, params.filter);
        return results.length > 0 ? results : "No relevant documents found for your query.";
      } catch (error) {
        console.error("Document retrieval tool error:", error);
        return { error: "Failed to retrieve documents.", details: error.message };
      }
    }
  },
  summarization: {
    name: "summarization",
    description: "Summarize a given piece of text.",
    parametersSchema: {
        type: "object",
        properties: {
            text: { type: "string", description: "The text to be summarized." },
            maxLength: { type: "number", description: "Approximate maximum length of the summary in words (optional)." }
        },
        required: ["text"]
    },
    execute: async (params) => {
        console.log("Executing summarization tool with params:", params);
        try {
            const model = await getToolModel();
            const prompt = `Summarize the following text${params.maxLength ? ` to about ${params.maxLength} words` : ''}:\n\n${params.text}`;
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            return { summary: responseText };
        } catch (error) {
            console.error("Summarization tool error:", error);
            return { error: "Failed to summarize text.", details: error.message };
        }
    }
  },
};

export function getToolByName(name) {
  const tool = availableTools[name];
  return tool;
}

export async function executeToolCall(toolName, params) {
  const tool = getToolByName(toolName);
  if (!tool) {
    console.error(`Tool "${toolName}" not found during execution.`);
    return { error: `Tool "${toolName}" not found.`, status: "error" };
  }
  try {
    if (tool.parametersSchema && tool.parametersSchema.required) {
      for (const requiredParam of tool.parametersSchema.required) {
        if (!(requiredParam in params)) {
          throw new Error(`Missing required parameter "${requiredParam}" for tool "${toolName}".`);
        }
      }
    }
    const executionResult = await tool.execute(params);
    if (typeof executionResult === 'string') {
        return { result: executionResult };
    }
    return executionResult;

  } catch (error) {
    console.error(`Error executing tool "${toolName}" with params ${JSON.stringify(params)}:`, error);
    return { error: `Execution failed for tool "${toolName}".`, details: error.message, status: "error" };
  }
}

/**
 * Formats tool schemas for LLM function calling.
 * The output of this function is an array of FunctionDeclaration objects.
 * This array should be used as the value for the `functionDeclarations` (camelCase) key
 * within a `Tool` object when making a request to the Google Generative AI API.
 *
 * Example of how the calling code should use this:
 * const functionDeclarationsArray = formatToolsForLLM(toolNames);
 * const toolsForApi = [{
 * functionDeclarations: functionDeclarationsArray // Note: camelCase
 * }];
 * // then pass toolsForApi to the model.generateContent({ tools: toolsForApi, ... })
 *
 * The error "Unknown name 'function_declarations'" usually means the API received
 * 'function_declarations' (snake_case) instead of 'functionDeclarations' (camelCase)
 * for this key in the request payload.
 */
export function formatToolsForLLM(toolNames) {
    const llmToolDeclarations = [];
    for (const name of toolNames) {
        const tool = getToolByName(name);
        if (tool) {
            llmToolDeclarations.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.parametersSchema && Object.keys(tool.parametersSchema.properties || {}).length > 0
                            ? tool.parametersSchema
                            : { type: "object", properties: {}, required: [] }
            });
        }
    }
    return llmToolDeclarations;
}

export function getAllAvailableTools() {
    return Object.keys(availableTools).map(name => ({
        name: availableTools[name].name,
        description: availableTools[name].description,
        parametersSchema: availableTools[name].parametersSchema
    }));
}