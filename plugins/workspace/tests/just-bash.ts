import { Bash, MountableFs, ReadWriteFs } from "just-bash";

const root = "/home/workspace/koishi-app/data/yesimbot/workspace";
const baseFs = new ReadWriteFs({ root });
const mountableFs = new MountableFs({
  //   base: new InMemoryFs(memoryFiles),
  mounts: [{ mountPoint: "/home/workspace", filesystem: baseFs }],
});
const bash = new Bash({
  fs: mountableFs,
  cwd: "/home/workspace",
});

async function executeCommand(command: string) {
  try {
    const result = await bash.exec(command);
    console.log("Command output:", result.stdout);
  } catch (error) {
    console.error("Command error:", error);
  }
}

async function main() {
  await executeCommand("echo Hello, World!");
  await executeCommand("ls -la");
  await executeCommand("pwd");
  await executeCommand("ls -la /usr/bin");
  await executeCommand("tree -L 4 /");
  await executeCommand("help");
}

main().catch((error) => {
  console.error("Error in main:", error);
});
