import { ChromaClient} from 'chromadb';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModelName = "embedding-001";
const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName });

let chromaClientInstance;
// Fallback for local dev
const CHROMA_DB_URL = process.env.CHROMA_DB_URL || 'http://localhost:8000';

export function getVectorDbClient() {
    if (!chromaClientInstance) {
        const params = CHROMA_DB_URL.startsWith('http') ? { path: CHROMA_DB_URL } : {};
        chromaClientInstance = new ChromaClient(params);
    }
    return chromaClientInstance;
}

export const COLLECTIONS = {
  TASKS: 'tasks_collection',
  AGENT_EXECUTIONS: 'agent_executions_collection',
  KNOWLEDGE_BASE: 'knowledge_base_collection',
  AGENT_MEMORY: 'agent_memory_collection'
};

async function initializeCollections() {
  const client = getVectorDbClient();
  try {
    for (const collectionName of Object.values(COLLECTIONS)) {
      await client.getOrCreateCollection({ name: collectionName });
      console.log(`VectorDB: Ensured collection '${collectionName}' exists.`);
    }
  } catch (error) {
    console.error("VectorDB: Error ensuring collections exist:", error.message, error);
    // Handle other specific errors if necessary, otherwise re-throw or manage.
    if (error.message && error.message.includes("got an unexpected keyword argument 'embedding_function'")) {
        console.warn("VectorDB: 'embedding_function' might not be a valid parameter for your Chroma version/setup. Check ChromaDB docs.");
    } else {
        console.error("VectorDB: Throwing unhandled error from initializeCollections (getOrCreateCollection).");
        throw error;
    }
  }
}

initializeCollections().catch(err => {
    console.error("Failed to initialize VectorDB collections on startup:", err.message, err);
});

export async function generateEmbedding(text) {
  try {
    if (!text || typeof text !== 'string' || text.trim() === "") {
        console.warn("generateEmbedding called with invalid text, returning zero vector.");
        const defaultEmbeddingDim = 768;
        return Array(defaultEmbeddingDim).fill(0);
    }
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("VectorDB: Error generating embedding for text:", text.substring(0,100)+"...", error);
    throw error;
  }
}

export async function storeTaskEmbeddings(decompositionResult) {
  const client = getVectorDbClient();
  try {
    const collection = await client.getCollection({ name: COLLECTIONS.TASKS });
    const { taskId, mainTask, subtasks } = decompositionResult;

    const taskEmbedding = await generateEmbedding(mainTask);
    const itemsToAdd = [{
      id: taskId,
      embedding: taskEmbedding,
      metadata: { type: 'main_task', description: mainTask, timestamp: new Date().toISOString(), taskId },
      document: mainTask
    }];

    if (subtasks && Array.isArray(subtasks)) {
      for (const subtask of subtasks) {
        if (!subtask.subtaskName || !subtask.subtaskId) {
            console.warn("Skipping subtask due to missing name or ID:", subtask);
            continue;
        }
        const subtaskEmbedding = await generateEmbedding(subtask.subtaskName);
        itemsToAdd.push({
          id: `${taskId}_${subtask.subtaskId}`,
          embedding: subtaskEmbedding,
          metadata: {
            type: 'sub_task', mainTaskId: taskId, subtaskId: subtask.subtaskId,
            description: subtask.subtaskName, timestamp: new Date().toISOString(),
            dependencies: JSON.stringify(subtask.dependencies || []),
            parallelGroup: subtask.parallelGroup || 'default'
          },
          document: subtask.subtaskName
        });
      }
    }
    if (itemsToAdd.length > 0) {
        await collection.add({
            ids: itemsToAdd.map(item => item.id),
            embeddings: itemsToAdd.map(item => item.embedding),
            metadatas: itemsToAdd.map(item => item.metadata),
            documents: itemsToAdd.map(item => item.document)
        });
        console.log(`VectorDB: Stored ${itemsToAdd.length} task/subtask embeddings for main task ${taskId}`);
    }

  } catch (error) {
    console.error(`VectorDB: Error storing task embeddings for ${decompositionResult.taskId}:`, error);
  }
}

export async function storeExecutionResults(agentId, agentReport) {
  const client = getVectorDbClient();
  try {
    const collection = await client.getCollection({ name: COLLECTIONS.AGENT_EXECUTIONS });
    const { taskAssigned, result, reasoning, status, executionTimeMs, agentName, agentType } = agentReport;

    const contentToEmbed = `Agent: ${agentName} (${agentType}), Task: ${taskAssigned}, Status: ${status}, Result: ${JSON.stringify(result || "").substring(0, 200)}, Reasoning: ${JSON.stringify(reasoning || "").substring(0, 300)}`;
    const embedding = await generateEmbedding(contentToEmbed);

    await collection.add({
      ids: [`exec_${agentId}_${Date.now()}`],
      embeddings: [embedding],
      metadatas: [{
        agentId, agentName, agentType, taskAssigned, status, executionTimeMs,
        timestamp: new Date().toISOString(),
      }],
      documents: [JSON.stringify(agentReport)]
    });
    console.log(`VectorDB: Stored execution result for agent ${agentId}`);
  } catch (error) {
    console.error(`VectorDB: Error storing execution result for agent ${agentId}:`, error);
  }
}

export async function retrieveRelevantContext(taskDescription, limit = 3) {
  const client = getVectorDbClient();
  try {
    const queryEmbedding = await generateEmbedding(taskDescription);
    const results = { similarTasks: [], similarExecutions: [] };

    const tasksCollection = await client.getCollection({ name: COLLECTIONS.TASKS });
    const taskResults = await tasksCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      include: ["metadatas", "documents", "distances"]
    });
    if (taskResults.ids && taskResults.ids[0]) {
        results.similarTasks = taskResults.ids[0].map((id, i) => ({
            id,
            document: taskResults.documents[0][i],
            metadata: taskResults.metadatas[0][i],
            similarity: 1 - taskResults.distances[0][i]
        }));
    }

    const executionsCollection = await client.getCollection({ name: COLLECTIONS.AGENT_EXECUTIONS });
    const execResults = await executionsCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      include: ["metadatas", "documents", "distances"]
    });
     if (execResults.ids && execResults.ids[0]) {
        results.similarExecutions = execResults.ids[0].map((id, i) => ({
            id,
            document: JSON.parse(execResults.documents[0][i]),
            metadata: execResults.metadatas[0][i],
            similarity: 1 - execResults.distances[0][i]
        }));
    }

    console.log(`VectorDB: Retrieved context for "${taskDescription.substring(0,50)}...": ${results.similarTasks.length} tasks, ${results.similarExecutions.length} executions.`);
    return results;
  } catch (error) {
    console.error(`VectorDB: Error retrieving relevant context for "${taskDescription.substring(0,50)}...":`, error);
    return { similarTasks: [], similarExecutions: [] };
  }
}

export async function storeKnowledgeItem(itemId, content, metadata = {}) {
  const client = getVectorDbClient();
  try {
    const collection = await client.getCollection({ name: COLLECTIONS.KNOWLEDGE_BASE });
    const embedding = await generateEmbedding(typeof content === 'string' ? content : JSON.stringify(content));

    await collection.add({
      ids: [itemId || `kb_${Date.now()}`],
      embeddings: [embedding],
      metadatas: [{ ...metadata, timestamp: new Date().toISOString(), source: metadata.source || 'manual' }],
      documents: [typeof content === 'string' ? content : JSON.stringify(content)]
    });
    console.log(`VectorDB: Stored knowledge item "${itemId}"`);
  } catch (error) {
    console.error(`VectorDB: Error storing knowledge item "${itemId}":`, error);
  }
}

export async function retrieveKnowledge(query, limit = 5, filter = undefined) {
  const client = getVectorDbClient();
  try {
    const collection = await client.getCollection({ name: COLLECTIONS.KNOWLEDGE_BASE });
    const queryEmbedding = await generateEmbedding(query);

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: filter,
      include: ["metadatas", "documents", "distances"]
    });

    if (results.ids && results.ids[0]) {
        return results.ids[0].map((id, i) => ({
            id,
            document: results.documents[0][i],
            metadata: results.metadatas[0][i],
            similarity: 1 - results.distances[0][i]
        }));
    }
    return [];
  } catch (error) {
    console.error(`VectorDB: Error retrieving knowledge for query "${query.substring(0,50)}...":`, error);
    return [];
  }
}

export async function getCollectionStats() {
  const client = getVectorDbClient();
  const stats = { timestamp: new Date().toISOString() };
  try {
    for (const key in COLLECTIONS) {
      const collectionName = COLLECTIONS[key];
      try {
        const collection = await client.getCollection({ name: collectionName });
        stats[collectionName] = await collection.count();
      } catch (e) {
        stats[collectionName] = 0;
        console.warn(`VectorDB: Could not get count for collection ${collectionName}: ${e.message}`);
      }
    }
    return stats;
  } catch (error) {
    console.error("VectorDB: Error getting collection stats:", error);
    return { error: error.message, ...stats };
  }
}