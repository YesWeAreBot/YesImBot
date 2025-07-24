import { glob } from "glob";
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
  const tgzFiles = await glob("packages/**/*.tgz", { absolute: true });
  if (tgzFiles.length === 0) {
    console.log("No .tgz files found to collect.");
    return;
  }
  console.log(`Found ${tgzFiles.length} packages to collect.`);

  // 3. 移动所有文件
  for (const file of tgzFiles) {
    const fileName = path.basename(file);
    const destinationPath = path.join(destinationDir, fileName);
    try {
      await fs.rename(file, destinationPath);
      console.log(`Moved ${fileName} to ${destinationDir}/`);
    } catch (error) {
      console.error(`Failed to move ${fileName}:`, error);
    }
  }

  console.log("✅ Collection complete.");
}

main();