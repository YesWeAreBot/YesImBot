import PGliteDriver from "@yesimbot/driver-pglite";
import * as minato from "minato";
import { Database } from "minato";
import Logger from "reggol";

const logger = new Logger("pglite-vector");

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

const database = new Database<Tables, Types>();

logger.level = 3;

await database.connect(PGliteDriver, {
    dataDir: "memory://",
});

// Define tables with vector fields
database.extend(
    "document",
    {
        id: "integer",
        title: "string",
        content: "text",
        embedding: { type: "vector", length: 3 }, // 3-dimensional vector
    },
    {
        primary: "id",
        autoInc: true,
    }
);

console.log("Creating test documents...");

// Insert test documents with embeddings
try {
    const doc1 = await database.create("document", {
        title: "First Document",
        content: "This is the first test document.",
        embedding: [0.1, 0.2, 0.3],
    });

    console.log("Created document 1:", doc1);

    const doc2 = await database.create("document", {
        title: "Second Document",
        content: "This is the second test document.",
        embedding: [0.4, 0.5, 0.6],
    });

    console.log("Created document 2:", doc2);

    // Verify documents were created
    const documents = await database.select("document", {}).execute();
    console.log("All documents:", documents);
    console.log("Total documents:", documents.length);
    console.log("First document embedding:", documents[0]?.embedding);

    if (documents.length === 2) {
        console.log("✅ Vector support test passed!");
    } else {
        console.log("❌ Vector support test failed - wrong number of documents");
    }
} catch (error) {
    console.error("❌ Error during vector test:", error);
}

await database.dropAll();
await database.stopAll();
