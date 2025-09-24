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

async function testPgVector() {
    console.log("Creating database with vector extension...");
    const database = new Database<Tables, Types>();

    try {
        // Connect to the database
        await database.connect(PGliteDriver, {
            dataDir: "memory://",
        });

        // Enable the vector extension
        console.log("Enabling vector extension...");
        const pgDriver = database.drivers[0] as any;
        if (pgDriver && pgDriver.query) {
            await pgDriver.query("CREATE EXTENSION IF NOT EXISTS vector");
        }

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
        ];

        // Insert test documents
        for (const doc of testData) {
            await database.create("document", doc);
        }

        console.log("✅ Documents inserted successfully!");

        // Test basic selection
        const allDocs = await database.select("document", {}).execute();
        console.log("All documents:", allDocs);

        // Test vector similarity operations using direct SQL execution
        console.log("Testing vector similarity search...");

        const queryVector = [0.2, 0.3, 0.4];

        // Test using driver's direct query method for L2 distance
        console.log("Testing L2 distance with direct SQL...");
        if (pgDriver && pgDriver.query) {
            const l2SQL = `
        SELECT id, title, content, embedding,
               embedding <-> '[${queryVector.join(",")}]'::vector as distance
        FROM document
        ORDER BY distance
        LIMIT 2
      `;
            const l2Results = await pgDriver.query(l2SQL);

            console.log("L2 Distance Results:");
            console.log("Raw result:", l2Results);
            if (l2Results && Array.isArray(l2Results)) {
                l2Results.forEach((doc: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${doc.title} - distance: ${doc.distance}`);
                });
            } else if (l2Results && l2Results.rows) {
                l2Results.rows.forEach((doc: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${doc.title} - distance: ${doc.distance}`);
                });
            }

            // Test cosine similarity
            console.log("Testing cosine similarity with direct SQL...");
            const cosineSQL = `
        SELECT id, title, content, embedding,
               1 - (embedding <=> '[${queryVector.join(",")}]'::vector) as similarity
        FROM document
        ORDER BY similarity DESC
        LIMIT 2
      `;
            const cosineResults = await pgDriver.query(cosineSQL);

            console.log("Cosine Similarity Results:");
            if (cosineResults && Array.isArray(cosineResults)) {
                cosineResults.forEach((doc: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${doc.title} - similarity: ${doc.similarity}`);
                });
            }

            // Test inner product similarity
            console.log("Testing inner product similarity...");
            const innerSQL = `
        SELECT id, title, content, embedding,
               (embedding <#> '[${queryVector.join(",")}]'::vector) * -1 as inner_product
        FROM document
        ORDER BY inner_product DESC
        LIMIT 2
      `;
            const innerResults = await pgDriver.query(innerSQL);

            console.log("Inner Product Results:");
            if (innerResults && Array.isArray(innerResults)) {
                innerResults.forEach((doc: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${doc.title} - inner_product: ${doc.inner_product}`);
                });
            }
        }

        console.log("✅ All vector operations completed successfully!");
    } catch (error) {
        console.log("❌ Error during vector test:", error);
    } finally {
        await database.stopAll();
    }
}

testPgVector();
