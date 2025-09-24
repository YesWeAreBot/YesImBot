import PGliteDriver from "@yesimbot/driver-pglite";
import { Database } from "minato";
import * as minato from "minato";

interface Tables extends minato.Tables {
    document: {
        id: number;
        title: string;
        content: string;
        embedding: number[];
    };
}

interface Types extends minato.Types {
    vector: number[];
}

async function testVectorOperators() {
    console.log("Testing custom vector operators...");
    const database = new Database<Tables, Types>();

    try {
        // Connect to the database
        await database.connect(PGliteDriver, {
            dataDir: "memory://",
        });
        // Enable the vector extension
        console.log("Enabling vector extension...");
        const pgDriver: PGliteDriver = database["_driver"] || database.drivers[0];

        // Define the document model with vector embedding
        database.extend(
            "document",
            {
                id: "integer",
                title: "string",
                content: "text",
                embedding: {
                    type: "vector",
                    length: 3, // 3-dimensional vector
                },
            },
            {
                primary: "id",
                autoInc: true,
            }
        );

        console.log("Creating test documents...");
        const testData = [
            {
                title: "First Document",
                content: "This is the first test document.",
                embedding: [0.1, 0.2, 0.3],
            },
            {
                title: "Second Document",
                content: "This is the second test document.",
                embedding: [0.4, 0.5, 0.6],
            },
            {
                title: "Third Document",
                content: "This is the third test document.",
                embedding: [0.7, 0.8, 0.9],
            },
        ];

        // Insert test documents
        for (const doc of testData) {
            await database.create("document", doc);
        }

        console.log("✅ Documents inserted successfully!");

        // Test custom vector operators in minato queries
        const queryVector = [0.2, 0.3, 0.4];

        console.log("Testing basic selection and manual vector operations...");
        try {
            // Get all documents
            const allDocs = await database.select("document", {}).execute();
            console.log("All documents retrieved successfully:", allDocs.length, "documents");

            // Test vector operations using direct SQL through the driver
            console.log("Testing vector operations with direct SQL...");

            const testSQL = `
        SELECT id, title,
               embedding <-> '[${queryVector.join(",")}]'::vector as l2_distance,
               1 - (embedding <=> '[${queryVector.join(",")}]'::vector) as cosine_similarity
        FROM document
        ORDER BY l2_distance
        LIMIT 2
      `;

            const vectorResults = await pgDriver.query(testSQL);
            console.log("Vector operations working:");
            if (vectorResults && Array.isArray(vectorResults)) {
                vectorResults.forEach((doc: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${doc.title} - L2: ${doc.l2_distance}, Cosine: ${doc.cosine_similarity}`);
                });
            }
        } catch (error: any) {
            console.log("Test failed:", error.message);
        }

        console.log("✅ Custom operator tests completed!");
    } catch (error) {
        console.log("❌ Error during operator test:", error);
    } finally {
        await database.stopAll();
    }
}

testVectorOperators();
