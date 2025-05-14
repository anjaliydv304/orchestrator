import { getVectorDbClient, generateEmbedding } from '../services/vectorDb.js';
import { COLLECTIONS } from '../services/vectorDb.js';

export class AgentMemory {
  constructor(agentId) {
    this.agentId = agentId;
    this.shortTerm = {};
    this.vectorDbClient = getVectorDbClient();
  }

  async addToShortTerm(key, value) {
    this.shortTerm[key] = value;
  }

  async retrieveFromShortTerm(key) {
    return this.shortTerm[key];
  }

  getAllShortTerm() {
    return { ...this.shortTerm };
  }

  async addToLongTerm(data, metadata) {
    try {
      const contentToEmbed = typeof data === 'string' ? data : JSON.stringify(data);
      const embedding = await generateEmbedding(contentToEmbed);

      const collection = await this.vectorDbClient.getCollection({ name: COLLECTIONS.AGENT_MEMORY });
      await collection.add({
        ids: [`${this.agentId}-${Date.now()}`],
        embeddings: [embedding],
        metadatas: [{ agentId: this.agentId, timestamp: new Date().toISOString(), ...metadata }],
        documents: [JSON.stringify(data)]
      });
      console.log(`Added to long-term memory for agent ${this.agentId}`);
    } catch (error) {
      console.error(`Error adding to long-term memory for agent ${this.agentId}:`, error);
    }
  }
async retrieveFromLongTerm(query, limit = 5) {
    try {
      const queryEmbedding = await generateEmbedding(query);

      const collection = await this.vectorDbClient.getCollection({ name: COLLECTIONS.AGENT_MEMORY });
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        where: { agentId: this.agentId },
        nResults: limit,
        include: ["metadatas", "documents", "distances"]
      });

      console.log(`Retrieved ${results?.documents?.[0]?.length || 0} items from long-term memory for agent ${this.agentId}`);

      if (results && results.documents && results.documents[0]) {
        return results.documents[0].map((doc, i) => ({
          data: JSON.parse(doc),
          metadata: results.metadatas[0][i],
          similarity: results.distances[0][i]
          // Note on similarity: ChromaDB returns distances.
          // For L2 distance, smaller is more similar.
          // For cosine distance, distance = 1 - similarity (so similarity = 1 - distance).
        }));
      }
      return [];
    } catch (error) {
      console.error(`Error retrieving from long-term memory for agent ${this.agentId}:`, error);
      return [];
    }
  }
}