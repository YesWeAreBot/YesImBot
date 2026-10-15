import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const destinationDir = "artifacts";

async function main() {
    // 1. 确保目标文件夹存在
    try {
        await fs.mkdir(destinationDir, { recursive: true });
        console.log(`Ensured directory exists: ${destinationDir}`);
    } catch (error) {
        console.error(`Error creating directory ${destinationDir}:`, error);
        process.exit(1);
    }

    // 2. 查找所有 .tgz 文件
    const tgzFiles = [];
    for (const workspace of await fs.readdir("packages", { withFileTypes: true })) {
        if (!workspace.isDirectory()) continue;
        const directory = path.join("packages", workspace.name);
        for (const file of await fs.readdir(directory, { withFileTypes: true })) {
            if (file.isFile() && file.name.endsWith(".tgz")) tgzFiles.push(path.join(directory, file.name));
        }
    }
    if (tgzFiles.length === 0) {
        throw new Error("No .tgz files found to collect. Run the package build and pack steps first.");
    }
    console.log(`Found ${tgzFiles.length} packages to collect.`);

    // 3. 移动所有文件
    for (const file of tgzFiles) {
        const fileName = path.basename(file);
        const destinationPath = path.join(destinationDir, fileName);
        try {
            await fs.copyFile(file, destinationPath, constants.COPYFILE_EXCL);
            await fs.unlink(file);
            console.log(`Moved ${fileName} to ${destinationDir}/`);
        } catch (error) {
            console.error(`Failed to move ${fileName}:`, error);
            process.exitCode = 1;
        }
    }

    if (!process.exitCode) console.log("✅ Collection complete.");
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
